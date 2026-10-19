import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { submitCommitReview, prepareGitHubArgs } from '../.github/lights-on/runner/github-io.mjs';
import { validateReleaseArtifacts, uploadReleaseArtifacts } from '../.github/lights-on/runner/release-artifacts.mjs';
import { reserveAgentRun, settleAgentRun } from '../.github/lights-on/runner/run-budget.mjs';
import { allowAgentEvent } from '../.github/lights-on/runner/event-policy.mjs';
import { loadConfig, parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';
import { createProviderCompletion } from '../.github/lights-on/runner/provider-completion.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { archive, artifactManifest } from './package-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'owner/repo';
const sha = 'a'.repeat(40);
const env = { GITHUB_REPOSITORY: repo, GH_HOST: 'external.invalid' };
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-mitigations-'));
const config = loadConfig(ROOT, {});
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };

describe('Commit-bound independent reviews', () => {
  it('sends a literal review body and explicit commit_id even if a push races the POST', () => {
    const calls = [];
    const result = submitCommitReview({ prNumber: 17, headSha: sha, verdict: 'APPROVE',
      body: 'Review of A\n[link](https://github.com/upstream/repo/issues/1)', env,
      execFileImpl: (_cmd, args, options) => {
        calls.push(args);
        assert.equal(options.env.GH_HOST, 'github.com');
        assert.ok(args.includes('github.com'));
        if (!args.includes('POST')) return JSON.stringify({ state: 'open', head: { sha },
          base: { repo: { full_name: repo } }, user: { login: 'external-user' } });
        const payload = JSON.parse(options.input);
        assert.equal(payload.commit_id, sha);
        assert.equal(payload.event, 'APPROVE');
        assert.match(payload.body, /^```text/);
        // A new head exists at submission time; the request still names A.
        return JSON.stringify({ commit_id: payload.commit_id, html_url: 'https://github.com/owner/repo/pull/17#review' });
      } });
    assert.equal(calls.length, 2);
    assert.equal(result.commit_id, sha);
  });

  it('never posts an approval for a stale, closed or foreign PR, and does not fall back after errors', () => {
    for (const current of [
      { state: 'open', head: { sha: 'b'.repeat(40) }, base: { repo: { full_name: repo } } },
      { state: 'closed', head: { sha }, base: { repo: { full_name: repo } } },
      { state: 'open', head: { sha }, base: { repo: { full_name: 'upstream/repo' } } }
    ]) {
      let count = 0;
      assert.throws(() => submitCommitReview({ prNumber: 17, headSha: sha, verdict: 'APPROVE', body: 'ok', env,
        execFileImpl: () => { count++; return JSON.stringify(current); } }), /stale review/);
      assert.equal(count, 1);
    }
    assert.throws(() => prepareGitHubArgs(['pr', 'review', '17', '--repo', repo, '--approve'], env), /submitCommitReview/);
    let posts = 0;
    assert.throws(() => submitCommitReview({ prNumber: 17, headSha: sha, verdict: 'APPROVE', body: 'ok', env,
      execFileImpl: (_cmd, args) => {
        if (args.includes('POST')) { posts++; throw new Error('permission denied'); }
        return JSON.stringify({ state: 'open', head: { sha }, base: { repo: { full_name: repo } } });
      } }), /permission denied/);
    assert.equal(posts, 1);
  });

  it('records a commit-bound COMMENT for self-authored Actions PRs instead of an unbound fallback', () => {
    const result = submitCommitReview({ prNumber: 17, headSha: sha, verdict: 'APPROVE', body: 'ok', env,
      execFileImpl: (_cmd, args, options) => {
        if (!args.includes('POST')) return JSON.stringify({ state: 'open', head: { sha },
          base: { repo: { full_name: repo } }, user: { login: 'github-actions[bot]' } });
        const payload = JSON.parse(options.input);
        assert.equal(payload.event, 'COMMENT');
        return JSON.stringify({ commit_id: payload.commit_id });
      } });
    assert.equal(result.event, 'COMMENT');
  });
});

describe('Release distribution identity binding', () => {
  const cases = [
    { ecosystem: 'npm', manifest: 'package.json', source: '{"name":"demo","version":"1.0.0"}',
      file: 'demo-1.0.0.tgz', kind: 'tar', entry: 'package/package.json',
      meta: (name, version) => JSON.stringify({ name, version }) },
    { ecosystem: 'pypi', manifest: 'pyproject.toml', source: '[project]\nname="demo"\nversion="1.0.0"\n',
      file: 'demo-1.0.0-py3-none-any.whl', kind: 'zip', entry: 'demo-1.0.0.dist-info/METADATA',
      meta: (name, version) => `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n\n` },
    { ecosystem: 'pypi', manifest: 'pyproject.toml', source: '[project]\nname="demo"\nversion="1.0.0"\n',
      file: 'demo-1.0.0.tar.gz', kind: 'tar', entry: 'demo-1.0.0/PKG-INFO',
      meta: (name, version) => `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n\n` },
    { ecosystem: 'nuget', manifest: 'Demo.csproj', source: '<Project><PropertyGroup><PackageId>demo</PackageId></PropertyGroup></Project>',
      file: 'demo.1.0.0.nupkg', kind: 'zip', entry: 'demo.nuspec',
      meta: (name, version) => `<package><metadata><id>${name}</id><version>${version}</version></metadata></package>` },
    { ecosystem: 'rubygems', manifest: 'demo.gemspec', source: 'Gem::Specification.new do |s|\n s.name = "demo"\n s.version = "1.0.0"\nend\n',
      file: 'demo-1.0.0.gem', kind: 'gem', entry: 'metadata.gz',
      meta: (name, version) => `--- !ruby/object:Gem::Specification\nname: ${name}\nversion: !ruby/object:Gem::Version\n  version: ${version}\n` },
    { ecosystem: 'crates', manifest: 'Cargo.toml', source: '[package]\nname="demo"\nversion="1.0.0"\n',
      file: 'demo-1.0.0.crate', kind: 'tar', entry: 'demo-1.0.0/Cargo.toml',
      meta: (name, version) => `[package]\nname="${name}"\nversion="${version}"\n` }
  ];
  for (const spec of cases) {
    it(`checks internal identity for ${spec.file}, not just attacker-supplied hashes`, async () => {
      const root = temp();
      const directory = path.join(root, 'artifacts'); fs.mkdirSync(directory);
      try {
        fs.writeFileSync(path.join(root, spec.manifest), spec.source);
        const options = { directory, repoRoot: root, ecosystem: spec.ecosystem, version: '1.0.0' };
        for (const [name, version, valid] of [['demo', '1.0.0', true], ['victim', '1.0.0', false], ['demo', '2.0.0', false]]) {
          archive(path.join(directory, spec.file), spec.kind, [[spec.entry, spec.meta(name, version)]]);
          artifactManifest(directory, spec.ecosystem, '1.0.0', [spec.file]);
          if (valid) assert.equal(validateReleaseArtifacts(options).length, 1);
          else {
            assert.throws(() => validateReleaseArtifacts(options), /identity verification failed/);
            await assert.rejects(uploadReleaseArtifacts({ ...options, env: { REGISTRY_TOKEN: 'broad-credential' },
              execFileImpl: () => assert.fail('Must not upload mismatched identities'),
              fetchImpl: () => assert.fail('Must not make a publishing request') }), /identity verification failed/);
          }
        }
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    });
  }

  it('rejects duplicate/traversing archive identities and untrusted extra distributions', () => {
    const root = temp(); const directory = path.join(root, 'artifacts'); fs.mkdirSync(directory);
    try {
      fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo","version":"1.0.0"}');
      const good = '{"name":"demo","version":"1.0.0"}';
      for (const entries of [
        [['package/package.json', good], ['package/package.json', '{"name":"victim","version":"1.0.0"}']],
        [['package/package.json', good], ['package/./package.json', '{"name":"victim","version":"1.0.0"}']],
        [['../package.json', good]]
      ]) {
        archive(path.join(directory, 'demo.tgz'), 'tar', entries);
        artifactManifest(directory, 'npm', '1.0.0', ['demo.tgz']);
        assert.throws(() => validateReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm' }), /identity verification failed/);
      }
      archive(path.join(directory, 'demo.tgz'), 'tar', [['package/package.json', good]]);
      archive(path.join(directory, 'extra.tgz'), 'tar', [['package/package.json', '{"name":"victim","version":"1.0.0"}']]);
      artifactManifest(directory, 'npm', '1.0.0', ['demo.tgz', 'extra.tgz']);
      assert.throws(() => validateReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm' }), /identity verification failed/);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('requires explicit trusted names for dynamic sources and still checks the distribution', () => {
    const root = temp(); const directory = path.join(root, 'artifacts'); fs.mkdirSync(directory);
    try {
      fs.writeFileSync(path.join(root, 'setup.py'), 'raise RuntimeError("must never execute")');
      archive(path.join(directory, 'demo-1.0.0-py3-none-any.whl'), 'zip', [['demo-1.0.0.dist-info/METADATA', 'Name: demo\nVersion: 1.0.0\n']]);
      artifactManifest(directory, 'pypi', '1.0.0', ['demo-1.0.0-py3-none-any.whl']);
      const options = { repoRoot: root, directory, version: '1.0.0', ecosystem: 'pypi' };
      assert.throws(() => validateReleaseArtifacts(options), /identity verification failed/);
      fs.mkdirSync(path.join(root, '.github'));
      fs.writeFileSync(path.join(root, '.github', 'lights-on.yml'), 'release:\n  package_names:\n    pypi: [demo]\n');
      assert.equal(validateReleaseArtifacts(options).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});

describe('Event-driven cost abuse mitigation', () => {
  it('requires maintainer authorization by default for external paid work', () => {
    const external = { user: { login: 'attacker' }, author_association: 'NONE', labels: [] };
    assert.equal(allowAgentEvent({ eventName: 'issues', event: { issue: external }, config }).allowed, false);
    assert.equal(allowAgentEvent({ eventName: 'issue_comment', event: { comment: { author_association: 'NONE' } }, config }).allowed, false);
    assert.equal(allowAgentEvent({ eventName: 'pull_request_target', event: { pull_request: external }, config }).allowed, false);
    assert.equal(allowAgentEvent({ eventName: 'issues', event: { issue: { ...external, labels: ['lights-on:actionable'] } }, config }).allowed, true);
    assert.equal(allowAgentEvent({ eventName: 'pull_request_target', event: { pull_request: { ...external, labels: ['lights-on:re-review'] } }, config }).allowed, true);
    assert.equal(allowAgentEvent({ eventName: 'issues', event: { issue: external },
      config: { events: { allow_external_triggers: true } } }).allowed, true);
    assert.equal(allowAgentEvent({ eventName: 'issue_comment', event: { comment: { author_association: 'OWNER' } }, config }).allowed, true);
  });

  it('reserves before inference so simultaneous local runs cannot exceed the shared run limit', async () => {
    const root = temp();
    try {
      const stateFile = path.join(root, 'state.json');
      const cfg = { ...config, limits: { ...config.limits, max_agent_runs_per_day: 1 } };
      const reservations = await Promise.all(Array.from({ length: 5 }, () =>
        reserveAgentRun({ stateFile, config: cfg, task: 'docs-clarifier', itemKey: null })));
      assert.equal(reservations.filter((r) => r.allowed).length, 1);
      assert.equal(JSON.parse(fs.readFileSync(stateFile)).usage_history.length, 1);
      const allowed = reservations.find((r) => r.allowed);
      await settleAgentRun({ stateFile, id: allowed.id, task: 'docs-clarifier',
        usage: { total_tokens: 12, cost_usd: null }, outcome: 'failed' });
      const state = JSON.parse(fs.readFileSync(stateFile));
      assert.equal(state.usage_history[0].outcome, 'failed');
      assert.equal(state.usage_history[0].reserved_cost_usd, 2);
      assert.equal((await reserveAgentRun({ stateFile, config: cfg, task: 'docs-clarifier' })).allowed, false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('keeps unknown/interrupted spend reserved and refuses corrupt accounting', async () => {
    const root = temp();
    try {
      const stateFile = path.join(root, 'state.json');
      const cfg = { ...config, limits: { ...config.limits, max_daily_budget_usd: 2 } };
      const first = await reserveAgentRun({ stateFile, config: cfg, task: 'docs-clarifier', itemKey: 'issue:1' });
      assert.equal(first.allowed, true);
      assert.equal((await reserveAgentRun({ stateFile, config: cfg, task: 'docs-clarifier', itemKey: 'issue:2' })).allowed, false);
      await settleAgentRun({ stateFile, id: first.id, task: 'docs-clarifier', usage: { total_tokens: 50, cost_usd: 0.5 }, outcome: 'completed' });
      const state = JSON.parse(fs.readFileSync(stateFile));
      assert.equal(state.processed_items['issue:1'].attempts, 1);
      assert.equal(state.usage_history.length, 1);
      fs.writeFileSync(stateFile, 'invalid');
      await assert.rejects(reserveAgentRun({ stateFile, config: cfg, task: 'docs-clarifier' }));
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('coordinates reservations across separate Node processes sharing a state file', async () => {
    const root = temp();
    try {
      const file = path.join(root, 'state.json');
      const source = `import { reserveAgentRun } from ${JSON.stringify(new URL('../.github/lights-on/runner/run-budget.mjs', import.meta.url).href)};
        const result = await reserveAgentRun({stateFile:${JSON.stringify(file)}, task:'docs-clarifier',
          config:{limits:{max_agent_runs_per_day:1,max_cost_per_run_usd:1,max_daily_budget_usd:10}}});
        console.log(JSON.stringify(result));`;
      const run = () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
        let output = ''; let errors = '';
        child.stdout.on('data', (chunk) => { output += chunk; });
        child.stderr.on('data', (chunk) => { errors += chunk; });
        child.on('error', reject);
        child.on('close', (status) => status === 0 ? resolve(JSON.parse(output)) : reject(new Error(errors)));
      });
      const results = await Promise.all([run(), run(), run()]);
      assert.equal(results.filter((result) => result.allowed).length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('rejects oversized requests before model calls and explicitly caps API output', async () => {
    let calls = 0;
    const complete = createProviderCompletion({ provider: 'openrouter', model: 'test', env: {},
      maxInputBytes: 200, maxOutputTokens: 37,
      beforeModelCall: () => { calls++; },
      fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).max_tokens, 37);
        return { ok: true, json: async () => ({}) };
      } });
    await assert.rejects(complete({ messages: [{ content: 'x'.repeat(201) }] }), /max_input_bytes/);
    assert.equal(calls, 0);
    await complete({ messages: [] });
    assert.equal(calls, 1);
  });

  it('gates a real external issue invocation before any provider call or budget reservation', async () => {
    const root = temp();
    try {
      const stateFile = path.join(root, 'state.json');
      const result = await runAgent({ task: 'issue-responder', repoRoot: ROOT, workingDir: root,
        stateFile, outputPath: path.join(root, 'result.json'),
        env: { GITHUB_EVENT_NAME: 'issues' },
        eventPayload: { issue: { number: 7, user: { login: 'attacker' }, author_association: 'NONE', labels: [] } },
        spawnImpl: () => assert.fail('Must not invoke a provider for unapproved events'),
        fetchImpl: () => assert.fail('Must not invoke a provider for unapproved events') });
      assert.equal(result.status, 'skipped');
      assert.equal(result.action_taken, 'event_gated');
      assert.equal(fs.existsSync(stateFile), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('applies provider output limits to both Anthropic and OpenAI', async () => {
    for (const [provider, property] of [['claude', 'max_tokens'], ['codex', 'max_output_tokens']]) {
      const complete = createProviderCompletion({ provider, model: 'test', env: {}, maxOutputTokens: 79,
        fetchImpl: async (_url, options) => {
          assert.equal(JSON.parse(options.body)[property], 79);
          return { ok: true, json: async () => ({ content: [], output: [] }) };
        } });
      await complete({ messages: [], tools: [] });
    }
  });

  it('enforces external-event admission in both workflow entry points', () => {
    for (const name of ['lights-on-events.yml', 'lights-on-pr.yml']) {
      const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8');
      assert.ok(text.includes('allowAgentEvent('));
      assert.ok(text.indexOf('allowAgentEvent(') < text.indexOf('uses: $/.github/actions/lights-on-agent'));
    }
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lights-on-pr.yml'), 'utf8');
    assert.ok(workflow.includes('submitCommitReview({ prNumber, headSha, verdict, body: fullBody })'));
    assert.ok(!workflow.includes("['pr', 'review'"));
    assert.ok(!workflow.includes('reviewFlag'));
  });

  it('bounds retry/fallback inference calls and counts failed attempts against item/run limits', async () => {
    const root = temp();
    try {
      fs.writeFileSync(path.join(root, 'config.yml'), 'limits:\n  max_model_calls_per_run: 1\nengine:\n  fallback_providers: [claude]\n');
      let calls = 0;
      const stateFile = path.join(root, 'state.json');
      await assert.rejects(runAgent({ task: 'docs-clarifier', repoRoot: ROOT, workingDir: root, configPath: path.join(root, 'config.yml'),
        outputPath: path.join(root, 'out.json'), stateFile, itemKey: 'issue:1', provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake' },
        spawnImpl: () => { calls++; return { status: 0, stdout: '<invoke/>' }; },
        fetchImpl: () => assert.fail('Fallback must not exceed shared model-call ceiling') }), /Model-call limit/);
      assert.equal(calls, 1);
      const state = JSON.parse(fs.readFileSync(stateFile));
      assert.equal(state.processed_items['issue:1'].attempts, 1);
      assert.equal(state.usage_history.length, 1);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('shares one concurrency group and state cache across agent-bearing workflows', () => {
    for (const file of ['lights-on-events.yml', 'lights-on-pr.yml', 'lights-on-schedule.yml']) {
      const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', file), 'utf8');
      assert.ok(text.includes('group: lights-on-maintenance-budget-${{ github.repository }}'));
      assert.ok(text.includes('cancel-in-progress: false'));
      assert.ok(text.includes('uses: actions/cache/save@'));
      assert.ok(text.indexOf('uses: actions/cache/save@') > text.lastIndexOf('uses: $/.github/actions/lights-on-agent'));
      assert.ok(text.includes('if: always()'));
    }
    for (const file of ['.github/actions/lights-on-agent/action.yml', '.github/workflows/lights-on-schedule.yml']) {
      assert.ok(fs.readFileSync(path.join(ROOT, file), 'utf8').includes('lights-on-state-v2-${{ github.repository }}-'));
    }
  });
});
