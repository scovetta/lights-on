import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { compareSemver, readCurrentManifestVersion, updateManifestVersions } from '../.github/lights-on/runner/prepare-release.mjs';
import { detectPublishTargets } from '../.github/lights-on/runner/publish-release.mjs';
import { resolveProvider, loadConfig, PROVIDER_DEFAULT_MODELS } from '../.github/lights-on/runner/load-config.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { scanRepositoryDependencies, evaluateDependencyHealth } from '../.github/lights-on/runner/scan-dependencies.mjs';
import { saveState, loadState, createInitialState } from '../.github/lights-on/runner/state-store.mjs';
import { selectUnsyncedUpstreamItems, syncUpstream, fetchUpstreamContext } from '../.github/lights-on/runner/sync-upstream.mjs';
import { normalizeTask, TASKS, validatePolicy, operationCredentials, readSecrets, NODE_IMAGE } from '../local/policy.mjs';
import { Runtime } from '../local/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-review-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  return { root, repo, cleanup: () => fs.rmSync(root, { recursive: true }) };
}
const write = (dir, file, value) => fs.writeFileSync(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value));
const json = (value) => ({ ok: true, json: async () => value });

describe('Release metadata correctness', () => {
  it('orders numeric prerelease identifiers according to SemVer', () => {
    const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.2', '1.0.0-alpha.10',
      '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0'];
    for (let i = 1; i < ordered.length; i++) {
      assert.equal(compareSemver(ordered[i - 1], ordered[i]), -1);
      assert.equal(compareSemver(ordered[i], ordered[i - 1]), 1);
    }
    assert.equal(compareSemver('1.0.0+first', '1.0.0+second'), 0);
  });

  for (const [file, table, ecosystem] of [['Cargo.toml', 'package', 'crates'], ['pyproject.toml', 'project', 'pypi']]) {
    it(`keeps ${file} edits and identity reads inside its package table`, () => {
      const f = fixture();
      const source = `[tool.example]\nname = "not-the-package"\nversion = "9.0.0"\n[${table}]\nname = "demo"\nversion = "1.2.3"\n[dependencies.helper]\nversion = "4.0.0"\n`;
      try {
        write(f.repo, file, source);
        assert.equal(readCurrentManifestVersion(f.repo), '1.2.3');
        assert.equal(detectPublishTargets(f.repo).find((target) => target.ecosystem === ecosystem).name, 'demo');
        assert.deepEqual(updateManifestVersions(f.repo, '1.2.3'), []);
        assert.equal(fs.readFileSync(path.join(f.repo, file), 'utf8'), source);
        assert.deepEqual(updateManifestVersions(f.repo, '1.2.4'), [file]);
        assert.equal(fs.readFileSync(path.join(f.repo, file), 'utf8'), source.replace('"1.2.3"', '"1.2.4"'));
        write(f.repo, file, `[${table}]\nname="demo"\n[[bin]]\nversion="9.0.0"\n`);
        assert.throws(() => updateManifestVersions(f.repo, '1.2.4'), /literal package version/);
      } finally { f.cleanup(); }
    });
  }

  it('rejects malformed lockfiles before writing any release version changes', () => {
    const f = fixture();
    try {
      write(f.repo, 'package.json', { name: 'demo', version: '1.0.0' });
      write(f.repo, 'package-lock.json', '{broken');
      const before = fs.readFileSync(path.join(f.repo, 'package.json'), 'utf8');
      assert.throws(() => updateManifestVersions(f.repo, '1.0.1'));
      assert.equal(fs.readFileSync(path.join(f.repo, 'package.json'), 'utf8'), before);
    } finally { f.cleanup(); }
  });
});

describe('Provider routing and explicit configuration', () => {
  it('normalizes and deduplicates fallback providers and rejects unknown names', () => {
    const config = { engine: { provider: 'copilot', fallback_providers: [' CLAUDE ', 'claude', 'copilot'] } };
    assert.deepEqual(resolveProvider(config, {}).fallbackProviders, ['claude']);
    assert.throws(() => resolveProvider({ engine: { provider: 'unknown' } }, {}), /Unsupported provider/);
    assert.throws(() => resolveProvider({ engine: { provider: 'copilot', fallback_providers: ['unknown'] } }, {}), /fallback provider/);
  });

  it('resolves the model for an explicit provider rather than the auto-selected credential', async () => {
    const f = fixture();
    try {
      let model;
      const result = await runAgent({ task: 'docs-clarifier', repoRoot: f.repo, provider: 'CODEX',
        outputPath: path.join(f.root, 'result.json'), stateFile: path.join(f.root, 'state.json'),
        env: { COPILOT_GITHUB_TOKEN: 'fake', OPENAI_API_KEY: 'fake' },
        spawnImpl: () => assert.fail('Must not launch Copilot'),
        fetchImpl: async (_url, options) => {
          model = JSON.parse(options.body).model;
          return json({ usage: { input_tokens: 1, output_tokens: 1 }, output: [
            { type: 'function_call', call_id: 'done', name: 'finish_task', arguments: '{"summary":"done","action_taken":"none"}' }
          ] });
        } });
      assert.equal(result.provider, 'codex');
      assert.equal(model, PROVIDER_DEFAULT_MODELS.codex);
      assert.equal(resolveProvider(loadConfig({ repoRoot: f.repo, env: {} }), { GITHUB_TOKEN: 'not-a-copilot-token' }).isConfigured, false);
    } finally { f.cleanup(); }
  });

  it('uses a fallback provider model without carrying a custom primary model across APIs', async () => {
    const f = fixture();
    try {
      const configPath = path.join(f.root, 'config.yml');
      write(f.root, 'config.yml', 'engine:\n  models:\n    default: copilot-only-model\n  fallback_providers: [claude]\n');
      const result = await runAgent({ task: 'docs-clarifier', repoRoot: f.repo, configPath,
        outputPath: path.join(f.root, 'result.json'), stateFile: path.join(f.root, 'state.json'),
        env: { COPILOT_GITHUB_TOKEN: 'fake', ANTHROPIC_API_KEY: 'fake' },
        spawnImpl: () => ({ status: 1, stderr: 'Synthetic CLI failure' }),
        fetchImpl: async (_url, options) => {
          assert.equal(JSON.parse(options.body).model, PROVIDER_DEFAULT_MODELS.claude);
          return json({ usage: { input_tokens: 1, output_tokens: 1 },
            content: [{ type: 'tool_use', id: 'done', name: 'finish_task', input: { summary: 'done', action_taken: 'none' } }] });
        } });
      assert.equal(result.provider, 'claude');
    } finally { f.cleanup(); }
  });

  it('rejects zero per-run token/cost caps rather than replacing them with paid defaults', async () => {
    const f = fixture();
    try {
      for (const name of ['max_tokens_per_run', 'max_cost_per_run_usd']) {
        write(f.root, 'config.yml', `limits:\n  ${name}: 0\n`);
        await assert.rejects(runAgent({ repoRoot: f.repo, configPath: path.join(f.root, 'config.yml'),
          env: {}, fetchImpl: () => assert.fail('No inference'), spawnImpl: () => assert.fail('No inference') }),
        new RegExp(`Invalid ${name}`));
      }
    } finally { f.cleanup(); }
  });
});

describe('Bounded dependency discovery', () => {
  it('deduplicates requests, bounds concurrency and expands OSV batch identifiers', async () => {
    const f = fixture();
    try {
      const dependencies = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`dep-${i}`, '1.0.0']));
      write(f.repo, 'package.json', { name: 'demo', version: '1.0.0', dependencies, devDependencies: { 'dep-0': '1.0.0' } });
      fs.mkdirSync(path.join(f.repo, 'nested'));
      write(path.join(f.repo, 'nested'), 'package.json', { dependencies: { 'dep-0': '1.0.0' } });
      const calls = new Map();
      let active = 0, peak = 0;
      const report = await scanRepositoryDependencies({ repoRoot: f.repo, fetchImpl: async (url, options = {}) => {
        const key = url + (options.body || '');
        calls.set(key, (calls.get(key) || 0) + 1);
        active++; peak = Math.max(peak, active);
        await delay(5);
        active--;
        if (url.endsWith('/querybatch')) return json({ results: JSON.parse(options.body).queries.map((query) =>
          query.package.name === 'dep-0' ? { vulns: [{ id: 'OSV-example' }] } : {}) });
        if (url.endsWith('/query')) return json({ vulns: [{ id: 'OSV-example',
          affected: [{ ranges: [{ events: [{ introduced: '0' }, { fixed: '1.0.1' }] }] }] }] });
        return json(url.includes('/dependent_packages') ? [] : { latest_release_number: '1.0.1' });
      } });
      assert.equal(peak, 4);
      assert.ok([...calls.values()].every((count) => count === 1));
      assert.equal(report.dependencies.filter((dep) => dep.name === 'dep-0').length, 3);
      for (const dep of report.dependencies.filter((dep) => dep.name === 'dep-0')) {
        assert.equal(dep.cves[0].fixedVersion, '1.0.1');
        assert.equal(dep.recommendedAction, 'security-bump');
        assert.equal(dep.evidence.advisory_checked, true);
      }
      const unknown = evaluateDependencyHealth({ name: 'demo', resolvedVersion: '1.0.0' },
        { latest_release_number: '1.1.0' }, [{ id: 'OSV-incomplete' }]);
      assert.equal(unknown.cves[0].fixedVersion, null);
    } finally { f.cleanup(); }
  });

  it('does not report a corrupt npm manifest as an empty successful scan', async () => {
    const f = fixture();
    try {
      write(f.repo, 'package.json', '{broken');
      await assert.rejects(scanRepositoryDependencies({ repoRoot: f.repo, offline: true }), /npm manifest/);
    } finally { f.cleanup(); }
  });
});

describe('Persistence and upstream failure handling', () => {
  it('preserves the previous ledger when atomic replacement fails', (t) => {
    const f = fixture();
    try {
      const stateFile = path.join(f.root, 'state.json');
      saveState(createInitialState(), { stateFile });
      const before = fs.readFileSync(stateFile, 'utf8');
      t.mock.method(fs, 'renameSync', () => { throw new Error('Synthetic replacement failure'); });
      assert.throws(() => saveState({ ...createInitialState(), updated_at: 'changed' }, { stateFile }), /replacement failure/);
      assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
      assert.deepEqual(fs.readdirSync(f.root).sort(), ['repo', 'state.json']);
    } finally { f.cleanup(); }
  });

  it('honors a zero mirror limit and refuses incomplete remote data or duplicate inventories', async () => {
    const upstreamContext = { upstreamRepo: 'upstream/repo', openIssues: [{ number: 1 }] };
    assert.deepEqual(selectUnsyncedUpstreamItems({ upstreamContext, maxItems: 0 }), []);
    await assert.rejects(fetchUpstreamContext({ upstreamRepo: 'upstream/repo', installedRepo: 'owner/repo',
      fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
    const f = fixture();
    try {
      await assert.rejects(syncUpstream({ repoRoot: f.repo, contextOutput: path.join(f.root, 'context.json'),
        itemsOutput: path.join(f.root, 'items.json'), stateFile: path.join(f.root, 'state.json'), createLocalIssues: true,
        env: { GITHUB_REPOSITORY: 'owner/repo', LIGHTS_ON_UPSTREAM_REPO: 'upstream/repo' },
        fetchImpl: async (url) => json(url.endsWith('/upstream/repo') ? { full_name: 'upstream/repo' } : []),
        execFileImpl: () => { throw new Error('Inventory unavailable'); } }), /Inventory unavailable/);
    } finally { f.cleanup(); }
  });

  it('records confirmed mirrors and fails the operation if a later publication fails', async () => {
    const f = fixture();
    try {
      const stateFile = path.join(f.root, 'state.json');
      await assert.rejects(syncUpstream({ repoRoot: f.repo, contextOutput: path.join(f.root, 'context.json'),
        itemsOutput: path.join(f.root, 'items.json'), stateFile, createLocalIssues: true,
        env: { GITHUB_REPOSITORY: 'owner/repo', LIGHTS_ON_UPSTREAM_REPO: 'upstream/repo' },
        fetchImpl: async (url) => json(url.endsWith('/upstream/repo') ? { full_name: 'upstream/repo' } :
          url.includes('/issues?state=open') ? [{ number: 1, title: 'one' }, { number: 2, title: 'two' }] : []),
        execFileImpl: (_cmd, args) => {
          if (args[0] === 'issue' && args[1] === 'list') return '[]';
          if (args[0] === 'issue' && args[1] === 'create') {
            if (args[args.indexOf('--title') + 1].includes('#2')) throw new Error('Synthetic publish failure');
            return 'https://github.com/owner/repo/issues/10';
          }
          return '';
        } }), /confirmed successes remain recorded/);
      assert.equal(loadState({ stateFile }).processed_items['upstream:upstream/repo#1'].local_issue_number, 10);
      assert.equal(loadState({ stateFile }).processed_items['upstream:upstream/repo#2'], undefined);
    } finally { f.cleanup(); }
  });
});

describe('Local routing and prerequisites', () => {
  it('keeps POSIX installer line endings executable', () => {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'install.sh'), 'utf8'), /\r/);
  });

  it('installs with POSIX sh while preserving existing configuration', {
    skip: process.platform === 'win32'
  }, () => {
    const f = fixture();
    try {
      fs.mkdirSync(path.join(f.repo, '.github'));
      write(path.join(f.repo, '.github'), 'lights-on.yml', 'enabled: false\n');
      const result = spawnSync('sh', [path.join(ROOT, 'install.sh'), f.repo, '--skip-labels'],
        { cwd: ROOT, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(fs.readFileSync(path.join(f.repo, '.github', 'lights-on.yml'), 'utf8'), 'enabled: false\n');
      assert.ok(fs.existsSync(path.join(f.repo, '.github', 'lights-on', 'runner', 'package-identity.py')));
      assert.ok(fs.existsSync(path.join(f.repo, '.github', 'workflows', 'lights-on-release.yml')));
    } finally { f.cleanup(); }
  });

  it('rejects an invalid explicit installer source without copying another checkout', {
    skip: process.platform !== 'win32'
  }, () => {
    const f = fixture();
    try {
      const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', path.join(ROOT, 'install.ps1'), '-TargetDir', f.repo, '-SourceDir', path.join(f.root, 'missing-source')],
      { encoding: 'utf8', timeout: 15000 });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Explicit source directory/);
      assert.equal(fs.existsSync(path.join(f.repo, '.github')), false);
    } finally { f.cleanup(); }
  });

  it('selects only credentials used by the requested operation', () => {
    const policy = validatePolicy({ version: 1, repository: 'owner/repo', provider: 'codex',
      credentials: { PROVIDER: { env: 'PROVIDER' }, FEED: { env: 'FEED' }, GITHUB_WRITE: { env: 'GITHUB_WRITE' } },
      rules: [
        { id: 'inference', host: 'api.openai.com', path: '/v1/responses', methods: ['POST'], roles: ['analysis'],
          credential: 'PROVIDER', header: 'Authorization' },
        { id: 'feed', host: 'feed.example.com', path: '/', methods: ['GET'], roles: ['prepare'],
          credential: 'FEED', header: 'Authorization' },
        { id: 'write', host: 'api.github.com', path: '/repos/owner/repo/', methods: ['GET', 'POST'], roles: ['publisher'],
          credential: 'GITHUB_WRITE', header: 'Authorization' }
      ] });
    assert.deepEqual(readSecrets(policy, { FEED: 'synthetic' }, operationCredentials(policy, 'prepare')), { FEED: 'synthetic' });
    assert.deepEqual(operationCredentials(policy, 'publish'), ['GITHUB_WRITE']);
    assert.throws(() => readSecrets(policy, {}, operationCredentials(policy, 'prepare')), /Missing.*FEED/);
    assert.equal(normalizeTask('security-fixer'), 'security-remediator');
    assert.ok(TASKS.includes('security-remediator'));
    assert.ok(fs.existsSync(path.join(ROOT, '.github', 'lights-on', 'prompts', `${normalizeTask('security-fixer')}.md`)));
  });

  it('reuses immutable image verification while retaining cancellation/deadline checks', () => {
    const cached = { verifiedImages: new Set([NODE_IMAGE]), deadline: Date.now() + 10000 };
    Runtime.prototype.requireImage.call(cached, NODE_IMAGE);
    cached.cancelled = true;
    assert.throws(() => Runtime.prototype.requireImage.call(cached, NODE_IMAGE), /cancelled/);
  });

  it('threat-model CLI fails for missing sections and succeeds for a complete numbered structure', () => {
    const f = fixture();
    try {
      const check = () => spawnSync(process.execPath, [path.join(ROOT, '.github', 'lights-on', 'runner', 'ensure-threat-model.mjs'),
        '--check', '--repo-root', f.repo], { encoding: 'utf8' });
      write(f.repo, 'THREAT_MODEL.md', '# Model\n## 1.1 Header\n');
      assert.equal(check().status, 1);
      write(f.repo, 'THREAT_MODEL.md', Array.from({ length: 19 }, (_, i) => `## 1.${i + 1} Section\nContent`).join('\n'));
      assert.equal(check().status, 0);
    } finally { f.cleanup(); }
  });
});
