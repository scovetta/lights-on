import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoveryApi, discoverRequiredChecks, planDiscoveryEdits, applyDiscoveryEdits } from '../.github/lights-on/runner/discover-required-checks.mjs';
import { parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';

const sha = 'a'.repeat(40);
function fixture({ rules, protection, checks, statuses, runs } = {}) {
  const calls = [];
  const api = (endpoint) => {
    calls.push(endpoint);
    if (!endpoint) return { full_name: 'owner/repo', default_branch: 'main' };
    if (endpoint === '/branches/main') return { name: 'main', commit: { sha } };
    if (endpoint.startsWith('/rules/')) return rules ?? [
      { type: 'required_status_checks', ruleset_id: 9, parameters: { required_status_checks: [{ context: 'test (24)', integration_id: 15368 }] } }
    ];
    if (endpoint.endsWith('/protection')) return protection === undefined ? {
      required_status_checks: { checks: [{ context: 'lint', app_id: 15368 }], contexts: ['lint'] }
    } : protection;
    if (endpoint.startsWith('/commits?')) return [{ sha }];
    if (endpoint.includes('/check-runs')) return checks ?? [
      { name: 'test (24)', head_sha: sha, app: { id: 15368 }, check_suite: { id: 42 }, conclusion: 'failure' },
      { name: 'lint', head_sha: sha, app: { id: 15368 }, check_suite: { id: 42 }, conclusion: 'success' },
      { name: '4-Gate Review & Auto-Merge Verification', head_sha: sha, app: { id: 15368 } }
    ];
    if (endpoint.endsWith('statuses?per_page=100')) return statuses || [];
    if (endpoint.startsWith('/actions/runs?')) return runs ?? [
      { name: 'Project CI', head_sha: sha, head_branch: 'main', head_repository: { full_name: 'owner/repo' },
        event: 'push', check_suite_id: 42 }
    ];
    throw new Error(`Unexpected endpoint ${endpoint}`);
  };
  return { calls, api, discover: () => discoverRequiredChecks({ repo: 'owner/repo', api }) };
}

test('discovery unions enforced policies, including failed and currently absent required checks', () => {
  const f = fixture({ protection: { required_status_checks: {
    checks: [{ context: 'not running yet', app_id: 123 }], contexts: ['not running yet']
  } } });
  const result = f.discover();
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.required_checks, [{ context: 'not running yet', app_id: 123 }, { context: 'test (24)', app_id: 15368 }]);
  assert.deepEqual(result.workflow_names, ['Project CI']);
  assert.ok(f.calls.every((call) => !/pulls|upstream/.test(call)));
});

test('unbound publisher resolution distinguishes legacy statuses from checks and blocks ambiguity', () => {
  const rules = [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'test (24)' }] } }];
  const result = fixture({ rules, protection: null }).discover();
  assert.equal(result.required_checks[0].app_id, 15368);
  const ambiguous = fixture({ rules, protection: null, statuses: [{ id: 1, context: 'test (24)' }] }).discover();
  assert.equal(ambiguous.status, 'blocked');
  assert.equal(ambiguous.unresolved.length, 1);
  assert.throws(() => planDiscoveryEdits({ root: '.', discovery: ambiguous }), /not authoritative/);
  const legacy = fixture({ rules, protection: null, checks: [], statuses: [{ id: 1, context: 'test (24)' }] }).discover();
  assert.equal(legacy.required_checks[0].app_id, null);
  const missing = fixture({ rules, protection: null, checks: [] }).discover();
  assert.equal(missing.status, 'blocked');
});

test('observations without enforced policy are only candidates, never an automatic acceptance policy', () => {
  const result = fixture({ rules: [], protection: null }).discover();
  assert.equal(result.status, 'needs-selection');
  assert.equal(result.required_checks.length, 0);
  assert.equal(result.candidates.length, 2);
  assert.throws(() => planDiscoveryEdits({ root: '.', discovery: result }), /not authoritative/);
});

test('discovery rejects self-dependencies, malformed evidence and branch movement', () => {
  assert.throws(() => fixture({ rules: [{ type: 'required_status_checks', parameters: {
    required_status_checks: [{ context: '4-Gate Review & Auto-Merge Verification', integration_id: 15368 }]
  } }] }).discover(), /circular/);
  assert.throws(() => fixture({ rules: [{ type: 'required_status_checks' }] }).discover(), /inventory/);
  assert.throws(() => fixture({ protection: {} }).discover(), /Incomplete/);
  assert.throws(() => fixture({ checks: [{ name: 'test', app: { id: 15368 }, head_sha: 'b'.repeat(40) }] }).discover(), /identity/);
  const f = fixture();
  assert.throws(() => discoverRequiredChecks({ repo: 'owner/repo',
    api: (url) => url.startsWith('/commits?') ? [{ sha: 'b'.repeat(40) }] : f.api(url) }), /moved/);
});

test('GitHub discovery is read-only, repository-bound, paginated and never treats permission errors as no policy', () => {
  assert.throws(() => discoveryApi('upstream/repo', { GITHUB_REPOSITORY: 'owner/repo' }), /installed/);
  const api = discoveryApi('owner/repo', { GH_REPO: 'upstream/repo' }, (_cmd, args, options) => {
    assert.ok(args.includes('GET'));
    assert.ok(args.includes('--paginate'));
    assert.ok(args.includes('--slurp'));
    assert.equal(options.env.GH_REPO, undefined);
    assert.equal(options.env.GITHUB_REPOSITORY, 'owner/repo');
    return JSON.stringify([[{ type: 'pull_request' }], [{ type: 'required_status_checks' }]]);
  });
  assert.equal(api('/rules/branches/main', { paginate: true }).length, 2);
  const incomplete = discoveryApi('owner/repo', {}, (_command, args) => {
    assert.ok(args.includes('--jq'));
    assert.ok(!args.includes('--slurp'));
    return JSON.stringify({ total_count: 2, check_runs: [{ name: 'only one returned' }] });
  });
  assert.throws(() => incomplete('/commits/sha/check-runs', { paginate: true, field: 'check_runs' }), /Incomplete/);
  const denied = discoveryApi('owner/repo', {}, () => { throw Object.assign(new Error(), {
    stdout: '{"message":"Not Found","status":"404"}', stderr: 'HTTP 404'
  }); });
  assert.throws(() => denied('/branches/main/protection', { allowUnprotected: true }), /Cannot read/);
  const absent = discoveryApi('owner/repo', {}, () => { throw Object.assign(new Error(), {
    stdout: '{"message":"Branch not protected","status":"404"}'
  }); });
  assert.equal(absent('/branches/main/protection', { allowUnprotected: true }), null);
  assert.equal(fixture({ rules: [], protection: { enforce_admins: { enabled: false } } }).discover().status, 'needs-selection');
});

function local() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-check-setup-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  const config = path.join(root, '.github', 'lights-on.yml');
  const workflow = path.join(root, '.github', 'workflows', 'lights-on-pr.yml');
  fs.writeFileSync(config, 'enabled: true\nautonomy:\n  required_checks: []\n  require_ci_pass: true\n');
  fs.writeFileSync(workflow, 'name: Gate\non:\n  workflow_run:\n    workflows: ["Existing CI"]\n    types: [completed]\npermissions:\n  contents: write\n');
  return { root, config, workflow, close: () => fs.rmSync(root, { recursive: true }) };
}

test('preview does not mutate files; apply fills an empty list and adds workflow triggers without dropping custom entries', () => {
  const f = local();
  try {
    const before = fs.readFileSync(f.config, 'utf8');
    const edits = planDiscoveryEdits({ root: f.root, discovery: fixture().discover(), updateWorkflows: true });
    assert.equal(fs.readFileSync(f.config, 'utf8'), before);
    assert.equal(edits.length, 2);
    applyDiscoveryEdits(f.root, edits);
    assert.equal(parseSimpleYaml(fs.readFileSync(f.config, 'utf8')).autonomy.required_checks.length, 2);
    const workflow = fs.readFileSync(f.workflow, 'utf8');
    assert.deepEqual(parseSimpleYaml(workflow).on.workflow_run.workflows, ['Existing CI', 'Project CI']);
    assert.ok(workflow.endsWith('permissions:\n  contents: write\n'));
    assert.equal(planDiscoveryEdits({ root: f.root, discovery: fixture().discover(), updateWorkflows: true }).length, 0);
  } finally { f.close(); }
});

test('setup refuses explicit policy changes, duplicate keys and stale files before writing anything', () => {
  const f = local();
  try {
    const discovery = fixture().discover();
    const edits = planDiscoveryEdits({ root: f.root, discovery, updateWorkflows: true });
    fs.appendFileSync(f.workflow, '# concurrent edit\n');
    assert.throws(() => applyDiscoveryEdits(f.root, edits), /changed/);
    assert.match(fs.readFileSync(f.config, 'utf8'), /required_checks: \[\]/);
    fs.writeFileSync(f.config, 'autonomy:\n  required_checks: [{ context: "custom", app_id: 42 }]\n');
    assert.throws(() => planDiscoveryEdits({ root: f.root, discovery }), /explicit policy/);
    fs.writeFileSync(f.config, 'autonomy:\n  required_checks: []\n  required_checks: []\n');
    assert.throws(() => planDiscoveryEdits({ root: f.root, discovery }), /one literal/);
  } finally { f.close(); }
});

test('setup refuses symlink destinations', { skip: process.platform === 'win32' }, () => {
  const f = local();
  try {
    fs.unlinkSync(f.config);
    fs.symlinkSync(path.join(f.root, 'absent'), f.config);
    assert.throws(() => planDiscoveryEdits({ root: f.root, discovery: fixture().discover() }), /Unsafe/);
    assert.equal(fs.existsSync(path.join(f.root, 'absent')), false);
  } finally { f.close(); }
});
