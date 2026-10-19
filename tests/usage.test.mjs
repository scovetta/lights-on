import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { normalizeCopilotUsage, normalizeUsage, createUsageAccumulator, usageSummary } from '../.github/lights-on/runner/usage.mjs';
import { createProviderCompletion } from '../.github/lights-on/runner/provider-completion.mjs';
import { OPENROUTER_TOOLS, runOpenRouterAgent } from '../.github/lights-on/runner/openrouter-agent.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { recordUsage, checkBudgetAndRateLimits, loadState } from '../.github/lights-on/runner/state-store.mjs';
import { loadConfig } from '../.github/lights-on/runner/load-config.mjs';

globalThis.fetch = async () => { throw new Error('Unexpected live network call'); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const request = { messages: [{ role: 'user', content: 'task' }], tools: OPENROUTER_TOOLS };
const finish = JSON.stringify({ name: 'finish_task', arguments: { summary: 'done', action_taken: 'none' } });
function report(input = 120, output = 30) {
  return {
    totalPremiumRequestCost: 3, totalUserRequests: 1, totalNanoAiu: 8000000000, aiCreditsStatus: 'available',
    modelMetrics: {
      'claude-sonnet-5.5': { requests: { count: 1, cost: 3 }, usage: { inputTokens: input, outputTokens: output,
        cacheReadTokens: 20, cacheWriteTokens: 0 } }
    },
    // Duplicated representations must not inflate usage.
    agentMetrics: { main: { modelMetrics: { 'claude-sonnet-5.5': { usage: { inputTokens: input, outputTokens: output } } } } },
    providerModelMetrics: [{ metrics: { usage: { inputTokens: input, outputTokens: output } } }],
    lastCallInputTokens: input, lastCallOutputTokens: output
  };
}
function writeUsage(args, value) {
  const file = args[args.indexOf('--usage-output-file') + 1];
  assert.ok(file, 'Must request CLI usage output');
  fs.writeFileSync(file, JSON.stringify(value));
}

describe('Copilot usage accounting', () => {
  it('collects token totals once, retaining billing units separately from unknown USD', () => {
    const usage = normalizeCopilotUsage(report());
    assert.equal(usage.total_tokens, 150);
    assert.equal(usage.tokens_status, 'reported');
    assert.equal(usage.cost_usd, null);
    assert.equal(usage.cost_source, 'unavailable');
    assert.equal(usage.premium_requests, 3);
    assert.equal(usage.copilot_nano_aiu, 8000000000);
    assert.equal(usage.copilot_ai_credits_status, 'available');
    assert.equal(usage.copilot_usage_reports, 1);
    const multi = report();
    multi.modelMetrics.other = { usage: { inputTokens: 10, outputTokens: 5 } };
    assert.equal(normalizeCopilotUsage(multi).total_tokens, 165);
    const zero = normalizeCopilotUsage(report(0, 0));
    assert.equal(zero.total_tokens, 0);
    assert.equal(zero.cost_usd, null);
  });

  it('includes rejected-format attempts and removes stale usage files between CLI invocations', async () => {
    let calls = 0;
    let home;
    const complete = createProviderCompletion({ provider: 'copilot', model: 'test', env: {}, spawnImpl: (_cmd, args, options) => {
      home = options.cwd;
      assert.ok(!fs.existsSync(args[args.indexOf('--usage-output-file') + 1]));
      writeUsage(args, report(40, 10));
      return { status: 0, stdout: ++calls === 1 ? '<invoke name="read_file"/>' : finish };
    } });
    const result = await complete(request);
    assert.equal(result.usage.total_tokens, 100);
    assert.equal(result.usage.premium_requests, 6);
    assert.equal(result.usage.copilot_cli_invocations, 2);
    assert.equal(result.usage.copilot_usage_reports, 2);
    assert.equal(result.usage.cost_usd, null);
    assert.equal(fs.existsSync(home), false);
  });

  it('represents missing, malformed, or partial reports as unknown rather than zero', async () => {
    for (const kind of ['missing', 'malformed', 'partial']) {
      let calls = 0;
      const complete = createProviderCompletion({ provider: 'copilot', model: 'test', env: {}, spawnImpl: (_cmd, args) => {
        calls++;
        if (kind === 'partial' && calls === 1) writeUsage(args, report(40, 10));
        if (kind === 'malformed') fs.writeFileSync(args[args.indexOf('--usage-output-file') + 1], 'not JSON');
        return { status: 0, stdout: kind === 'partial' && calls === 1 ? '<invoke/>' : finish };
      } });
      const result = await complete(request);
      assert.equal(result.usage.total_tokens, null);
      assert.equal(result.usage.cost_usd, null);
      assert.equal(result.usage.tokens_status, kind === 'partial' ? 'partial' : 'unavailable');
      assert.equal(result.usage.known_total_tokens, kind === 'partial' ? 50 : 0);
      assert.equal(result.usage.copilot_usage_reports, kind === 'partial' ? 1 : 0);
    }
  });

  it('attaches observed usage to process and format-exhaustion errors', async () => {
    for (const kind of ['process', 'format']) {
      const complete = createProviderCompletion({ provider: 'copilot', model: 'test', env: {}, spawnImpl: (_cmd, args) => {
        writeUsage(args, report(40, 10));
        return { status: kind === 'process' ? 1 : 0, stderr: 'failed', stdout: '<invoke/>' };
      } });
      await assert.rejects(complete(request), (err) => {
        assert.equal(err.usage.total_tokens, kind === 'process' ? 50 : 150);
        assert.equal(err.usage.cost_usd, null);
        return true;
      });
    }
  });
});

describe('Usage aggregation, budgets and persistence', () => {
  it('preserves API cost estimates but never estimates explicit Copilot unknown cost', () => {
    assert.equal(normalizeUsage({ total_tokens: 100000 }).cost_usd, 0.5);
    assert.equal(normalizeUsage({ total_tokens: 100000 }).cost_source, 'estimated');
    assert.equal(normalizeUsage({ total_tokens: 100000, cost: 0 }).cost_source, 'reported');
    assert.equal(normalizeUsage().cost_usd, null);
    const totals = createUsageAccumulator();
    totals.add(normalizeCopilotUsage(report()));
    totals.add({ total_tokens: 50, cost: 0.02 });
    const mixed = totals.snapshot();
    assert.equal(mixed.total_tokens, 200);
    assert.equal(mixed.cost_usd, null);
    assert.equal(mixed.known_cost_usd, 0.02);
    assert.equal(mixed.cost_source, 'partial');
    assert.match(usageSummary(mixed)['USD cost'], /Unavailable/);
  });

  it('enforces token limits using CLI reports while leaving Copilot dollar cost unknown', async () => {
    let calls = 0;
    const complete = createProviderCompletion({ provider: 'copilot', model: 'test', env: {}, spawnImpl: (_cmd, args) => {
      calls++;
      writeUsage(args, report());
      return { status: 0, stdout: JSON.stringify({ name: 'read_file', arguments: { path: 'README.md' } }) };
    } });
    const result = await runOpenRouterAgent({ prompt: 'task', workingDir: ROOT, apiKey: 'mock', complete,
      runCommand: () => assert.fail('No commands expected'), maxTokensPerRun: 100, maxTurns: 5, env: {} });
    assert.equal(calls, 1);
    assert.equal(result.usage.total_tokens, 150);
    assert.equal(result.usage.cost_usd, null);
    assert.equal(result.details.cost_usd, null);
    assert.equal(result.status, 'failed');
    assert.equal(result.execution.stop_reason, 'max_tokens');
    assert.equal(result.execution.turns_used, 1);
    assert.equal(result.details.max_turns_reached, false);
  });

  it('stores unknown costs and exposes incomplete daily accounting without inventing free usage', () => {
    const state = { usage_history: [] };
    recordUsage(state, { task: 'docs-clarifier', usage: normalizeCopilotUsage(report()) });
    assert.equal(state.usage_history[0].tokens_used, 150);
    assert.equal(state.usage_history[0].cost_usd, null);
    assert.equal(state.usage_history[0].premium_requests, 3);
    const config = loadConfig(ROOT, {});
    const check = checkBudgetAndRateLimits(state, config);
    assert.equal(check.details.costTrackingComplete, false);
    assert.equal(check.details.dailySpendUsd, null);
    assert.equal(check.details.knownDailySpendUsd, 0);
    recordUsage(state, { costUsd: 20, tokensUsed: 1000 });
    assert.equal(checkBudgetAndRateLimits(state, config).allowed, false);
  });

  it('returns nonzero docs-task usage and persists retries instead of trusting model claims', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-usage-run-'));
    const workingDir = path.join(root, 'repo');
    fs.mkdirSync(workingDir);
    try {
      let calls = 0;
      const stateFile = path.join(root, 'state.json');
      const result = await runAgent({
        task: 'docs-clarifier', repoRoot: ROOT, workingDir, stateFile, provider: 'copilot',
        outputPath: path.join(root, 'result.json'), env: { COPILOT_GITHUB_TOKEN: 'mock' },
        spawnImpl: (_cmd, args) => {
          calls++;
          writeUsage(args, report(40, 10));
          return { status: 0, stdout: calls === 1 ? '<invoke/>'
            : calls === 2 ? JSON.stringify({ name: 'write_file', arguments: { path: 'README.md', content: 'docs' } })
              : JSON.stringify({ name: 'finish_task', arguments: { summary: 'done', action_taken: 'opened_pr',
                details: { tokens_used: 0, cost_usd: 0 } } }) };
        }
      });
      assert.equal(result.usage.total_tokens, 150);
      assert.equal(result.usage.cost_usd, null);
      assert.equal(result.usage.copilot_cli_invocations, 3);
      assert.equal(result.files_changed[0], 'README.md');
      const record = loadState({ stateFile }).usage_history[0];
      assert.equal(record.tokens_used, 150);
      assert.equal(record.cost_usd, null);
      assert.equal(record.premium_requests, 9);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('accounts for failed Copilot attempts before a successful provider fallback', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-usage-fallback-'));
    const workingDir = path.join(root, 'repo');
    fs.mkdirSync(workingDir);
    try {
      fs.writeFileSync(path.join(root, 'config.yml'), 'engine:\n  fallback_providers: [claude]\n');
      const stateFile = path.join(root, 'state.json');
      const result = await runAgent({
        task: 'docs-clarifier', repoRoot: ROOT, workingDir, stateFile, provider: 'copilot',
        configPath: path.join(root, 'config.yml'), outputPath: path.join(root, 'out.json'),
        env: { COPILOT_GITHUB_TOKEN: 'mock', ANTHROPIC_API_KEY: 'mock' },
        spawnImpl: (_cmd, args) => { writeUsage(args, report(40, 10)); return { status: 1, stderr: 'failure' }; },
        fetchImpl: async () => ({ ok: true, json: async () => ({
          usage: { input_tokens: 30, output_tokens: 20 },
          content: [{ type: 'tool_use', id: 'finish', name: 'finish_task', input: { summary: 'done', action_taken: 'none' } }]
        }) })
      });
      assert.equal(result.provider, 'claude');
      assert.equal(result.usage.total_tokens, 100);
      assert.equal(result.usage.cost_usd, null);
      assert.equal(result.usage.cost_source, 'partial');
      assert.equal(loadState({ stateFile }).usage_history.length, 1);
      assert.equal(loadState({ stateFile }).usage_history[0].tokens_used, 100);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('persists measured usage even when all configured providers fail', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-usage-failed-'));
    const workingDir = path.join(root, 'repo');
    fs.mkdirSync(workingDir);
    try {
      const stateFile = path.join(root, 'state.json');
      await assert.rejects(runAgent({
        task: 'docs-clarifier', repoRoot: ROOT, workingDir, stateFile, provider: 'copilot',
        outputPath: path.join(root, 'out.json'), env: { COPILOT_GITHUB_TOKEN: 'mock' },
        spawnImpl: (_cmd, args) => { writeUsage(args, report(40, 10)); return { status: 1, stderr: 'failed' }; }
      }), (err) => {
        assert.equal(err.usage.total_tokens, 50);
        assert.equal(err.usage.cost_usd, null);
        return true;
      });
      const record = loadState({ stateFile }).usage_history[0];
      assert.equal(record.outcome, 'failed');
      assert.equal(record.tokens_used, 50);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it('persists non-dependency usage through the default state-store path without an explicit runner stateFile', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-default-usage-'));
    const workingDir = path.join(root, 'repo');
    const previous = process.env.LIGHTS_ON_STATE_FILE;
    fs.mkdirSync(workingDir);
    // Redirect the default state-store path without setting runAgent's stateFile/env override.
    process.env.LIGHTS_ON_STATE_FILE = path.join(root, 'default-state.json');
    try {
      await runAgent({ task: 'docs-clarifier', repoRoot: ROOT, workingDir, provider: 'copilot',
        outputPath: path.join(root, 'out.json'), env: { COPILOT_GITHUB_TOKEN: 'mock' },
        spawnImpl: (_cmd, args) => { writeUsage(args, report()); return { status: 0, stdout: finish }; } });
      assert.equal(loadState().usage_history[0].tokens_used, 150);
      assert.equal(loadState().usage_history[0].cost_usd, null);
    } finally {
      if (previous === undefined) delete process.env.LIGHTS_ON_STATE_FILE;
      else process.env.LIGHTS_ON_STATE_FILE = previous;
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
