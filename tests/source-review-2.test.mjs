import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig, parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';
import { runAgent, assemblePrompt, buildEngineCommand } from '../.github/lights-on/runner/run-agent.mjs';
import { executeToolCall, runOpenRouterAgent } from '../.github/lights-on/runner/openrouter-agent.mjs';
import { createInitialState, recordUsage, loadState, saveState } from '../.github/lights-on/runner/state-store.mjs';
import { normalizeUsage } from '../.github/lights-on/runner/usage.mjs';
import { evaluatePrSafety } from '../.github/lights-on/runner/verify-pr-safety.mjs';
import { classifyVersionBump, detectManifestsAndDeps, evaluateDependencyHealth, fetchDownstreamDependents, scanRepositoryDependencies } from '../.github/lights-on/runner/scan-dependencies.mjs';
import { prepareRelease } from '../.github/lights-on/runner/prepare-release.mjs';
import { dependencyFileHash } from '../.github/lights-on/runner/dependency-work.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-review-2-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  return { root, repo, stateFile: path.join(root, 'state.json'),
    write(name, value) { fs.writeFileSync(path.join(repo, name), value); },
    close() { fs.rmSync(root, { recursive: true }); } };
}

test('configuration rejects missing explicit files, invalid overrides, wrong types and ambiguous YAML', () => {
  const f = fixture();
  try {
    assert.throws(() => loadConfig({ configPath: path.join(f.root, 'missing.yml'), env: {} }), /Cannot read/);
    for (const env of [{ LIGHTS_ON_ENABLED: 'maybe' }, { LIGHTS_ON_MAX_TOKENS_PER_RUN: 'oops' },
      { LIGHTS_ON_MAX_COST_PER_RUN_USD: '-1' }]) {
      assert.throws(() => loadConfig({ repoRoot: f.repo, env }), /Invalid/);
    }
    for (const source of ['release:\n  auto_publish: "false"\n', 'release: null\n',
      'enabled: false\nenabled: true\n', 'autonomy:\n  required_checks:\n    - context: build\n      app_id: 15368\n']) {
      f.write('.github/lights-on.yml', source);
      assert.throws(() => loadConfig({ repoRoot: f.repo, env: {} }), /must be|Duplicate|inline YAML/);
    }
    f.write('.github/lights-on.yml', '\uFEFFenabled: false\nrelease:\n  enabled: false\n');
    const config = loadConfig({ repoRoot: f.repo, env: {} });
    assert.equal(config.enabled, false);
    assert.equal(config.release.enabled, false);
  } finally { f.close(); }
});

test('quoted configuration values round-trip escaped backslashes, hashes and single quotes', () => {
  const expected = ['C:\\folder\\', 'a "quoted" # value', 'test \\ native'];
  const parsed = parseSimpleYaml(`values: ${JSON.stringify(expected)} # comment\nsingle: 'it''s literal'\n`, { strict: true });
  assert.deepEqual(parsed.values, expected);
  assert.equal(parsed.single, "it's literal");
});

test('controller command specifications retain SDK setup and explicit prompts without leaking other provider credentials', () => {
  const command = buildEngineCommand({ provider: 'copilot', promptFile: 'task.md',
    env: { COPILOT_GITHUB_TOKEN: 'selected', GITHUB_TOKEN: 'publisher', OPENAI_API_KEY: 'other',
      LIGHTS_ON_COPILOT_BACKEND: 'sdk', LIGHTS_ON_COPILOT_SDK_DIR: '/opt/sdk',
      LIGHTS_ON_MAX_TOKENS_PER_RUN: '500', LIGHTS_ON_ENABLED: 'false' } });
  assert.ok(command.args.includes('--prompt-file'));
  assert.equal(command.env.LIGHTS_ON_COPILOT_BACKEND, 'sdk');
  assert.equal(command.env.LIGHTS_ON_COPILOT_SDK_DIR, '/opt/sdk');
  assert.equal(command.env.LIGHTS_ON_ENABLED, 'false');
  assert.equal(command.env.LIGHTS_ON_MAX_TOKENS_PER_RUN, '500');
  assert.equal(command.env.GITHUB_TOKEN, undefined);
  assert.equal(command.env.OPENAI_API_KEY, undefined);
});

test('explicit inputs are not silently dropped and the configured threat-model path is used', async () => {
  const f = fixture();
  try {
    f.write('THREAT_MODEL.md', 'WRONG_CONTRACT');
    f.write('contract.md', 'CUSTOM_CONTRACT');
    const prompt = assemblePrompt({ repoRoot: f.repo, threatModelPath: 'contract.md' });
    assert.match(prompt, /CUSTOM_CONTRACT/);
    assert.doesNotMatch(prompt, /WRONG_CONTRACT/);
    assert.throws(() => assemblePrompt({ repoRoot: f.repo, contextFiles: ['absent.txt'] }), /Context file/);
    assert.throws(() => assemblePrompt({ repoRoot: f.repo, promptFile: 'absent.md' }), /Explicit task prompt/);
    await assert.rejects(runAgent({ repoRoot: f.repo, provider: 'openrouter', eventFile: 'absent.json',
      stateFile: f.stateFile, env: { OPENROUTER_API_KEY: 'fixture' }, fetchImpl: () => assert.fail('No inference') }), /Event file/);
  } finally { f.close(); }
});

test('ranged file reads can reach beyond the initial byte cap without unbounded output', () => {
  const f = fixture();
  try {
    f.write('large.txt', 'x'.repeat(120000) + '\r\nsecond \u2603\r\nthird\n');
    const read = (args) => executeToolCall('read_file', { path: 'large.txt', ...args }, { workingDir: f.repo });
    assert.equal(read({ start_line: 2, end_line: 3 }).content, 'second \u2603\nthird');
    assert.equal(read({ start_line: 20 }).content, '');
    assert.equal(read({ start_line: 0 }).ok, false);
    const large = read({ start_line: 1, end_line: 1 });
    assert.match(large.content, /\[truncated\]$/);
    assert.ok(Buffer.byteLength(large.content) < 100050);
  } finally { f.close(); }
});

test('all providers receive tool argument validation before writes or completion', () => {
  const f = fixture();
  try {
    for (const args of [{ path: 'README.md' }, { path: 'README.md', content: null }]) {
      assert.equal(executeToolCall('write_file', args, { workingDir: f.repo }).ok, false);
      assert.equal(fs.readFileSync(path.join(f.repo, 'README.md'), 'utf8'), 'fixture\n');
    }
    const invalid = executeToolCall('finish_task', { summary: 'missing action' }, { workingDir: f.repo });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.finished, undefined);
  } finally { f.close(); }
});

test('the tool loop awaits asynchronous command completion before requesting another model response', async () => {
  const f = fixture();
  let done = false, calls = 0;
  try {
    const result = await runOpenRouterAgent({ prompt: 'fixture', apiKey: 'fixture', workingDir: f.repo,
      complete: async (request) => {
        const first = calls++ === 0;
        if (!first) {
          assert.equal(done, true);
          assert.equal(JSON.parse(request.messages.at(-1).content).exit_code, 0);
        }
        return { usage: { total_tokens: 1, cost: 0 }, choices: [{ message: { tool_calls: [{
          id: `c${calls}`, function: { name: first ? 'run_command' : 'finish_task',
            arguments: JSON.stringify(first ? { command: 'fixture-command' } : { summary: 'done', action_taken: 'none' }) }
        }] } }] };
      },
      runCommand: async () => { await new Promise((resolve) => setTimeout(resolve, 10)); done = true; return { exit_code: 0 }; }
    });
    assert.equal(result.status, 'completed');
  } finally { f.close(); }
});

for (const [limit, settings] of [
  ['max_tokens', 'max_tokens_per_run: 100'],
  ['max_cost', 'max_cost_per_run_usd: 0.0005'],
  ['max_turns', 'max_turns_per_run: 3']
]) {
  test(limit === 'max_turns' ? 'fallback retains the documented per-provider turn allowance' :
    `provider fallback shares the ${limit} allowance across the entire run`, async () => {
    const f = fixture();
    let primaryCalls = 0, fallbackCalls = 0;
    try {
      f.write('.github/lights-on.yml', `engine:\n  fallback_providers: [codex]\nlimits:\n  ${settings}\n`);
      const result = await runAgent({ task: 'docs-clarifier', repoRoot: f.repo, provider: 'claude', stateFile: f.stateFile,
        outputPath: path.join(f.root, 'out.json'), env: { ANTHROPIC_API_KEY: 'fixture', OPENAI_API_KEY: 'fixture' },
        fetchImpl: async (url) => {
          if (url.includes('anthropic')) {
            if (++primaryCalls > 1) throw new Error('Synthetic provider failure');
            return { ok: true, json: async () => ({ usage: { input_tokens: 80, output_tokens: 0 },
              content: [{ type: 'tool_use', id: 'a', name: 'read_file', input: { path: 'README.md' } }] }) };
          }
          fallbackCalls++;
          return { ok: true, json: async () => ({ usage: { input_tokens: 25, output_tokens: 0 }, output: [{
            type: 'function_call', call_id: 'b', name: fallbackCalls === 1 ? 'read_file' : 'finish_task',
            arguments: JSON.stringify(fallbackCalls === 1 ? { path: 'README.md' } : { summary: 'done', action_taken: 'none' })
          }] }) };
        } });
      const turnCase = limit === 'max_turns';
      assert.equal(result.status, turnCase ? 'completed' : 'failed');
      assert.equal(result.execution.stop_reason, turnCase ? 'finish_task' : limit);
      assert.equal(fallbackCalls, turnCase ? 2 : 1);
      assert.equal(result.execution.turns_used, turnCase ? 2 : 1);
      assert.equal(result.usage.known_total_tokens, turnCase ? 130 : 105);
      assert.equal(loadState({ stateFile: f.stateFile }).usage_history[0].outcome, turnCase ? 'completed' : 'failed');
    } finally { f.close(); }
  });
}

test('SDK counts persist and explicit unknown USD cannot be replaced by another cost field', () => {
  const f = fixture();
  try {
    const usage = normalizeUsage({ total_tokens: 150, cost_usd: null, cost: 7, copilot_sdk_requests: 1, premium_requests: 7 });
    assert.equal(usage.cost_usd, null);
    const state = createInitialState();
    recordUsage(state, { usage });
    saveState(state, { stateFile: f.stateFile });
    assert.equal(loadState({ stateFile: f.stateFile }).usage_history[0].copilot_sdk_requests, 1);
  } finally { f.close(); }
});

test('draft PRs and synthetic, missing-status or failed review results cannot authorize merging', () => {
  const pr = { number: 1, changed_files: 1, user: { login: 'github-actions[bot]' }, labels: [] };
  const review = { status: 'completed', verdict: 'APPROVE',
    gate_results: { threat_model: 'PASS', intended_use: 'PASS', dependent_packages: 'PASS', tests: 'PASS' } };
  const decide = (p, r) => evaluatePrSafety({ pr: p, changedFiles: ['README.md'], reviewResult: r,
    ciStatus: 'success', config: { enabled: true } });
  assert.equal(decide(pr, review).allowAutoMerge, true);
  assert.ok(decide({ ...pr, draft: true }, review).reasons.includes('draft-pr'));
  for (const state of [{ dry_run: true }, { status: 'failed' }, { status: 'skipped' }, { status: undefined }]) {
    const decision = decide(pr, { ...review, ...state });
    assert.equal(decision.allowAutoMerge, false);
    assert.ok(decision.reasons.includes('review-not-completed'));
  }
});

test('dependency scanning includes npm optional overrides and Python extras without mixing TOML tables', () => {
  const f = fixture();
  try {
    f.write('package.json', JSON.stringify({ dependencies: { optional: '1.0.0' },
      optionalDependencies: { optional: '2.0.0', extra: '3.0.0' } }));
    f.write('pyproject.toml', '[tool.other]\nname="wrong"\nversion="9.9.9"\n[project]\nname="right"\nversion="1.2.3"\n' +
      'dependencies = ["requests[security]>=2.31.0", # "not-a-package"\n \'other>=1.0.0\']\n');
    const report = detectManifestsAndDeps(f.repo);
    assert.deepEqual(report.dependencies.filter((d) => d.ecosystem === 'npm').map((d) => [d.name, d.resolvedVersion]),
      [['optional', '2.0.0'], ['extra', '3.0.0']]);
    assert.deepEqual(report.dependencies.filter((d) => d.ecosystem === 'pypi').map((d) => d.name), ['requests', 'other']);
    assert.equal(report.packageInfo.find((p) => p.ecosystem === 'pypi').name, 'right');
    assert.equal(classifyVersionBump('1.0.0-alpha.10', '1.0.0-alpha.2'), null);
    assert.equal(classifyVersionBump('1.0.0-alpha.2', '1.0.0-alpha.10'), 'patch');
  } finally { f.close(); }
});

test('OSV pagination includes later unpatched findings and rejects repeated continuation tokens', async () => {
  const f = fixture();
  try {
    f.write('package.json', '{"dependencies":{"dep":"1.0.0"}}');
    for (const repeat of [false, true]) {
      let queries = 0;
      const report = await scanRepositoryDependencies({ repoRoot: f.repo, fetchImpl: async (url, options) => {
        let data;
        if (url.endsWith('/querybatch')) data = { results: [{ vulns: [{ id: 'first' }] }] };
        else if (url.endsWith('/query')) {
          const next = JSON.parse(options.body).page_token;
          queries++;
          data = !next ? { vulns: [{ id: 'first', affected: [{ ranges: [{ events: [{ fixed: '1.0.1' }] }] }] }], next_page_token: 'next' } :
            { vulns: [{ id: 'second', affected: [{ ranges: [{ events: [{ introduced: '0' }] }] }] }],
              ...(repeat ? { next_page_token: 'next' } : {}) };
        } else data = { latest_release_number: '1.0.1', maintainers_count: 2 };
        return { ok: true, json: async () => data };
      } });
      assert.equal(queries, 2);
      assert.equal(report.dependencies[0].evidence.advisory_checked, !repeat);
      if (!repeat) {
        assert.equal(report.dependencies[0].cves.length, 2);
        assert.equal(report.dependencies[0].recommendedAction, 'migrate');
      }
    }
  } finally { f.close(); }
});

test('patch evidence must belong to the selected package and must not predate its affected SemVer', () => {
  const result = evaluateDependencyHealth({ name: 'dep', osvEcosystem: 'npm', resolvedVersion: '2.1.0' }, {},
    [{ id: 'CVE', affected: [
      { package: { name: 'unrelated', ecosystem: 'npm' }, ranges: [{ events: [{ fixed: '9.0.0' }] }] },
      { package: { name: 'dep', ecosystem: 'npm' }, ranges: [{ type: 'SEMVER',
        events: [{ introduced: '0' }, { fixed: '1.0.0' }, { introduced: '2.0.0' }] }] }
    ] }]);
  assert.equal(result.cves[0].fixedVersion, null);
  assert.equal(result.recommendedAction, 'migrate');
});

test('downstream lookup failures stay unknown and duplicate package identities are not counted twice', async () => {
  const pkg = { name: 'demo', registry: 'npmjs.org' };
  const unavailable = await fetchDownstreamDependents(pkg, { fetchImpl: async () => ({ ok: false }) });
  assert.equal(unavailable.dependentPackagesCount, null);
  assert.equal(unavailable.downloads, null);
  const data = await fetchDownstreamDependents([pkg, pkg], { fetchImpl: async (url) => ({
    ok: true, json: async () => url.includes('dependent_packages?') ? [] : { dependent_packages_count: 12, downloads: 100 }
  }) });
  assert.equal(data.dependentPackagesCount, 12);
  assert.equal(data.downloads, 100);
});

test('release analysis reads commit bodies and does not hide unavailable git history', () => {
  const f = fixture();
  try {
    f.write('package.json', '{"name":"fixture","version":"1.0.0"}');
    assert.throws(() => prepareRelease({ repoRoot: f.repo, tags: [], dryRun: true }), /Cannot read release commit/);
    const git = (args) => execFileSync('git', args, { cwd: f.repo, stdio: 'pipe' });
    git(['init', '-b', 'main']);
    git(['add', '.']);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fix: adjust API',
      '-m', 'BREAKING CHANGE: callers must change their arguments']);
    const result = prepareRelease({ repoRoot: f.repo, tags: [], dryRun: true });
    assert.equal(result.analysis.blockedMajor, true);
    assert.equal(result.analysis.hasBreakingChange, true);
  } finally { f.close(); }
});

test('dependency verification refuses dangling links rather than reading outside the worker', { skip: process.platform === 'win32' }, () => {
  const f = fixture();
  try {
    fs.symlinkSync(path.join(f.root, 'outside'), path.join(f.repo, 'unsafe'));
    assert.throws(() => dependencyFileHash(f.repo, 'unsafe/file.json'), /Symlink/);
  } finally { f.close(); }
});
