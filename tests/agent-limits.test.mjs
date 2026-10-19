import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runOpenRouterAgent } from '../.github/lights-on/runner/openrouter-agent.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { publishDependencyStage } from '../.github/lights-on/runner/dependency-stage.mjs';
import { loadConfig } from '../.github/lights-on/runner/load-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = { name: 'read_file', arguments: { path: 'README.md' } };
const finish = { name: 'finish_task', arguments: { summary: 'Done', action_taken: 'none' } };
const response = (call, usage = { total_tokens: 10, cost: 0 }) => ({
  usage, choices: [{ message: { tool_calls: [{ id: 'call', type: 'function',
    function: { name: call.name, arguments: JSON.stringify(call.arguments) } }] } }]
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-limits-'));
  const repo = path.join(root, 'repo');
  fs.mkdirSync(repo);
  fs.writeFileSync(path.join(repo, 'README.md'), 'Original\n');
  return { root, repo, cleanup: () => fs.rmSync(root, { recursive: true }) };
}
function cliUsage(args, tokens = 10) {
  fs.writeFileSync(args[args.indexOf('--usage-output-file') + 1], JSON.stringify({
    totalPremiumRequestCost: 15, aiCreditsStatus: 'complete',
    modelMetrics: { test: { usage: { inputTokens: tokens, outputTokens: 0 } } }
  }));
}

describe('Agent completion and limit semantics', () => {
  for (const [reason, settings, usage, expectedCalls] of [
    ['max_turns', { maxTurns: 2 }, { total_tokens: 10, cost: 0 }, 2],
    ['max_tokens', { maxTurns: 25, maxTokensPerRun: 100 }, { total_tokens: 60, cost: 0 }, 2],
    ['max_cost', { maxTurns: 25, maxCostPerRunUsd: 1 }, { total_tokens: 10, cost: 0.6 }, 2]
  ]) {
    it(`reports ${reason} as failure, not successful completion`, async () => {
      const f = fixture();
      let calls = 0;
      try {
        const result = await runOpenRouterAgent({ prompt: 'Task', apiKey: 'fake', workingDir: f.repo,
          runCommand: () => assert.fail('No shell expected'), ...settings,
          complete: async () => { calls++; return response(read, usage); } });
        assert.equal(calls, expectedCalls);
        assert.equal(result.status, 'failed');
        assert.equal(result.execution.stop_reason, reason);
        assert.equal(result.execution.turns_used, calls);
        assert.equal(result.details.max_turns_reached, reason === 'max_turns');
        assert.deepEqual(result.files_changed, []);
        assert.match(result.summary, /without finish_task/);
      } finally { f.cleanup(); }
    });
  }

  it('requires finish_task rather than treating prose as success, but allows a bounded correction', async () => {
    const f = fixture();
    try {
      let calls = 0;
      const options = { prompt: 'Task', apiKey: 'fake', workingDir: f.repo, maxTurns: 2,
        runCommand: () => assert.fail('No shell expected') };
      const completed = await runOpenRouterAgent({ ...options, complete: async (request) => {
        if (++calls === 1) return { usage: { total_tokens: 10, cost: 0 }, choices: [{ message: { content: 'Done.' } }] };
        assert.match(request.messages.at(-1).content, /finish_task/);
        return response(finish);
      } });
      assert.equal(completed.status, 'completed');
      assert.equal(completed.execution.stop_reason, 'finish_task');
      assert.equal(completed.execution.turns_used, 2);
      const incomplete = await runOpenRouterAgent({ ...options, complete: async () => ({
        usage: { total_tokens: 10, cost: 0 }, choices: [{ message: { content: '{"summary":"done","status":"completed"}' } }]
      }) });
      assert.equal(incomplete.status, 'failed');
    } finally { f.cleanup(); }
  });

  it('standalone sandbox discards unfinished file edits instead of exporting them', async () => {
    const f = fixture();
    try {
      const outputPath = path.join(f.root, 'result.json');
      const result = await runOpenRouterAgent({ prompt: 'Task', apiKey: 'fake', workingDir: f.repo,
        maxTurns: 1, outputPath, complete: async () => response({
          name: 'write_file', arguments: { path: 'README.md', content: 'Unfinished changes' }
        }) });
      assert.equal(result.status, 'failed');
      assert.equal(fs.readFileSync(path.join(f.repo, 'README.md'), 'utf8'), 'Original\n');
      assert.equal(JSON.parse(fs.readFileSync(outputPath)).status, 'failed');
    } finally { f.cleanup(); }
  });

  it('honors a configured non-dependency turn limit above 25 without changing defaults', async () => {
    const f = fixture();
    try {
      const configPath = path.join(f.root, 'config.yml');
      fs.writeFileSync(configPath, 'limits:\n  max_turns_per_run: 26\n');
      let calls = 0;
      const result = await runAgent({ task: 'docs-clarifier', repoRoot: f.repo, configPath,
        stateFile: path.join(f.root, 'state.json'), outputPath: path.join(f.root, 'result.json'),
        provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake' },
        spawnImpl: (_cmd, args) => {
          cliUsage(args);
          return { status: 0, stdout: JSON.stringify(++calls === 26 ? finish : read) };
        } });
      assert.equal(calls, 26);
      assert.equal(result.status, 'completed');
      assert.equal(result.execution.limits.max_turns_per_run, 26);
      const defaults = loadConfig({ repoRoot: f.repo, env: {} });
      assert.equal(defaults.limits.max_turns_per_run, 25);
      assert.equal(defaults.limits.max_tokens_per_run, 100000);
      assert.equal(defaults.limits.max_model_calls_per_run, 30);
    } finally { f.cleanup(); }
  });
});

describe('CLI and publication failure propagation', () => {
  it('reproduces five Copilot calls and 130820 tokens: nonzero exit, error annotation, no export, failed accounting', () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.repo, 'THREAT_MODEL.md'), 'Original contract\n');
      const preload = path.join(f.root, 'provider.mjs');
      fs.writeFileSync(preload, `
        import fs from 'node:fs';
        import childProcess from 'node:child_process';
        import { syncBuiltinESMExports } from 'node:module';
        let calls = 0;
        childProcess.spawnSync = (command, args) => {
          if (command !== 'copilot') throw new Error('Unexpected subprocess: ' + command);
          calls++;
          fs.writeFileSync(args[args.indexOf('--usage-output-file') + 1], JSON.stringify({
            totalPremiumRequestCost: 15, aiCreditsStatus: 'complete',
            modelMetrics: { test: { usage: { inputTokens: [20000, 22000, 24000, 26000, 38820][calls - 1], outputTokens: 0 } } }
          }));
          return { status: 0, stdout: JSON.stringify(calls === 1
            ? { name: 'write_file', arguments: { path: 'THREAT_MODEL.md', content: 'Incomplete contract' } }
            : { name: 'read_file', arguments: { path: 'THREAT_MODEL.md' } }) };
        };
        globalThis.fetch = async () => { throw new Error('No fallback/network permitted'); };
        syncBuiltinESMExports();
      `);
      const output = path.join(f.root, 'result.json'), state = path.join(f.root, 'state.json');
      const githubOutput = path.join(f.root, 'github-output'), summary = path.join(f.root, 'summary.md');
      const child = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
        path.join(ROOT, '.github', 'lights-on', 'runner', 'run-agent.mjs'),
        '--repo-root', f.repo, '--task', 'bootstrap-threat-model', '--provider', 'copilot', '--output', output],
      { encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        COPILOT_GITHUB_TOKEN: 'fake', ANTHROPIC_API_KEY: 'fake-fallback', LIGHTS_ON_STATE_FILE: state,
        GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'owner/repo', GITHUB_OUTPUT: githubOutput, GITHUB_STEP_SUMMARY: summary } });
      assert.equal(child.status, 1, child.stderr);
      const result = JSON.parse(fs.readFileSync(output, 'utf8'));
      assert.equal(result.status, 'failed');
      assert.equal(result.execution.stop_reason, 'max_tokens');
      assert.equal(result.execution.turns_used, 5);
      assert.equal(result.execution.limits.max_turns_per_run, 25);
      assert.equal(result.usage.total_tokens, 130820);
      assert.equal(result.usage.copilot_cli_invocations, 5);
      assert.equal(result.usage.premium_requests, 75);
      assert.equal(result.usage.cost_usd, null);
      assert.equal(result.details.max_turns_reached, false);
      assert.deepEqual(result.files_changed, []);
      assert.equal(fs.readFileSync(path.join(f.repo, 'THREAT_MODEL.md'), 'utf8'), 'Original contract\n');
      assert.match(child.stderr, /::error title=Agent task failed/);
      assert.match(child.stderr, /token limit \(100000; 130820 known tokens used\)/);
      assert.match(fs.readFileSync(githubOutput, 'utf8'), /status=failed/);
      assert.match(fs.readFileSync(summary, 'utf8'), /max\\?_tokens/);
      const record = JSON.parse(fs.readFileSync(state, 'utf8')).usage_history[0];
      assert.equal(record.outcome, 'failed');
      assert.equal(record.tokens_used, 130820);
      assert.equal(record.cost_usd, null);
      assert.equal(record.reserved_cost_usd, 2);
    } finally { f.cleanup(); }
  });

  it('standalone CLI exits nonzero when the agent never finishes', () => {
    const f = fixture();
    try {
      const preload = path.join(f.root, 'provider.mjs');
      fs.writeFileSync(preload, `globalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify(response(read))}) });`);
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(preload).href,
        path.join(ROOT, '.github', 'lights-on', 'runner', 'openrouter-agent.mjs'),
        '--prompt', 'Task', '--working-dir', f.repo, '--max-turns', '2'],
      { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        OPENROUTER_API_KEY: 'fake' } });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).execution.stop_reason, 'max_turns');
    } finally { f.cleanup(); }
  });

  it('publishing refuses failed dependency results and composite diagnostics are emitted before execution', () => {
    assert.throws(() => publishDependencyStage({ result: { status: 'failed' },
      execFileImpl: () => assert.fail('Failed results must not publish') }), /execution failed/);
    const action = fs.readFileSync(path.join(ROOT, '.github', 'actions', 'lights-on-agent', 'action.yml'), 'utf8');
    const run = action.slice(action.indexOf('args=(--task'));
    assert.ok(run.indexOf('echo "result_file=') < run.indexOf('node .github/lights-on/runner/run-agent.mjs'));
    assert.doesNotMatch(action, /continue-on-error/);
  });
});
