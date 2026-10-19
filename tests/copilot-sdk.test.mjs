import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createProviderCompletion } from '../.github/lights-on/runner/provider-completion.mjs';
import { COPILOT_SDK_VERSION, createCopilotSdkCompletion, loadCopilotSdk, sdkRuntimeEnvironment } from '../.github/lights-on/runner/copilot-sdk-completion.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { loadConfig } from '../.github/lights-on/runner/load-config.mjs';
import { createUsageAccumulator, usageSummary } from '../.github/lights-on/runner/usage.mjs';
import { OPENROUTER_TOOLS } from '../.github/lights-on/runner/openrouter-agent.mjs';

const finish = { name: 'finish_task', arguments_json: '{"summary":"fixture","action_taken":"none"}' };
const request = () => ({ messages: [{ role: 'user', content: 'controller task' }], tools: OPENROUTER_TOOLS });

test('SDK preparation and the controller image share an integrity-locked version without fixed registry URLs', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const [manifest, lock] of [
    ['.github/lights-on/runner/copilot-sdk.package.json', '.github/lights-on/runner/copilot-sdk.package-lock.json'],
    ['local/containers/package.json', 'local/containers/package-lock.json']
  ]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, manifest), 'utf8'));
    const locked = JSON.parse(fs.readFileSync(path.join(root, lock), 'utf8'));
    assert.equal(pkg.dependencies['@github/copilot-sdk'], COPILOT_SDK_VERSION);
    assert.equal(locked.packages['node_modules/@github/copilot-sdk'].version, COPILOT_SDK_VERSION);
    for (const [name, entry] of Object.entries(locked.packages)) {
      if (!name) continue;
      assert.ok(entry.integrity, `Missing integrity for ${name}`);
      assert.equal(entry.resolved, undefined, `Fixed registry URL for ${name}`);
    }
  }
});

function mockSdk({ reply, stopErrors = [], metricsError = false, extraCall = false, partialMetrics = false, abortError = false, lateEvent } = {}) {
  const instances = [], sessions = [];
  let aborts = 0, stops = 0, forced = 0, sends = 0;
  const report = { modelMetrics: { fixture: { requests: { count: extraCall ? 2 : 1 },
    usage: partialMetrics ? {} : { inputTokens: 120, outputTokens: 30 } } }, totalPremiumRequestCost: 7, totalNanoAiu: 42,
    aiCreditsStatus: 'available', agentMetrics: { main: { usage: { inputTokens: 120, outputTokens: 30 } } } };
  return { instances, sessions, get aborts() { return aborts; }, get stops() { return stops; },
    get forced() { return forced; }, get sends() { return sends; },
    loader: async () => ({
      RuntimeConnection: { forStdio: (options) => ({ kind: 'stdio', ...options }) },
      CopilotClient: class {
        constructor(options) { instances.push(options); }
        async createSession(options) {
          const listeners = new Set();
          const emit = (type, data = {}) => { for (const handler of listeners) handler({ type, id: `${type}-id`, data }); };
          const session = {
            options, disconnected: false,
            on(handler) { listeners.add(handler); return () => listeners.delete(handler); },
            async sendAndWait(options) {
              sends++;
              emit('model.model_call_started');
              if (extraCall) emit('model.model_call_started');
              emit('assistant.usage', { inputTokens: 120, outputTokens: 30, cost: 7, accounting: { usageId: 'one' } });
              const result = reply ? await reply({ index: sends, options, emit }) : finish;
              return { data: { content: typeof result === 'string' ? result : JSON.stringify(result) } };
            },
            async abort() { aborts++; if (abortError) throw new Error('abort failed'); },
            async disconnect() { session.disconnected = true; },
            rpc: { usage: { async getMetrics() {
              if (lateEvent) emit(lateEvent);
              if (metricsError) throw new Error('metrics unavailable');
              return report;
            } } }
          };
          sessions.push(session);
          return session;
        }
        async stop() { stops++; return stopErrors; }
        async forceStop() { forced++; }
      }
    })
  };
}
const completion = (mock, options = {}) => createProviderCompletion({
  provider: 'copilot', copilotBackend: 'sdk', model: 'fixture',
  env: { COPILOT_GITHUB_TOKEN: 'ghu_private-token', GITHUB_TOKEN: 'publisher-token', OPENAI_API_KEY: 'other-secret',
    LIGHTS_ON_COPILOT_SDK_DIR: 'not-used-by-mock' },
  copilotSdkLoader: mock.loader, ...options
});

test('SDK reuses one isolated stdio runtime, exposes no tools, and keeps billing units out of USD', async () => {
  const mock = mockSdk();
  let calls = 0;
  const complete = completion(mock, { beforeModelCall: () => calls++ });
  try {
    const usage = createUsageAccumulator();
    for (let i = 0; i < 2; i++) {
      const result = await complete(request());
      assert.equal(result.choices[0].message.tool_calls[0].function.name, 'finish_task');
      usage.add(result.usage);
    }
    assert.equal(mock.instances.length, 1);
    assert.equal(mock.sessions.length, 2);
    assert.equal(calls, 2);
    const client = mock.instances[0];
    assert.equal(client.mode, 'empty');
    assert.equal(client.connection.kind, 'stdio');
    assert.equal(client.useLoggedInUser, false);
    assert.equal(client.gitHubToken, 'ghu_private-token');
    assert.equal(client.connection.env.GITHUB_TOKEN, undefined);
    assert.equal(client.connection.env.OPENAI_API_KEY, undefined);
    assert.equal(client.connection.env.COPILOT_GITHUB_TOKEN, undefined);
    assert.equal(client.connection.env.COPILOT_CLI_PATH, undefined);
    for (const session of mock.sessions) {
      assert.deepEqual(session.options.availableTools, []);
      assert.deepEqual(session.options.excludedTools, ['builtin:*', 'mcp:*', 'custom:*']);
      assert.deepEqual(session.options.disabledMcpServers, ['github']);
      assert.equal(session.options.remoteSession, 'off');
      assert.equal(session.options.onPermissionRequest({}).kind, 'reject');
      assert.equal(session.options.infiniteSessions.enabled, false);
      assert.equal(session.options.skipCustomInstructions, true);
      assert.equal(session.options.enableConfigDiscovery, false);
      assert.equal(session.options.enableSkills, false);
      assert.equal(session.disconnected, true);
    }
    const total = usage.snapshot();
    assert.equal(total.total_tokens, 300);
    assert.equal(total.cost_usd, null);
    assert.equal(total.premium_requests, 14);
    assert.equal(total.copilot_nano_aiu, 84);
    assert.equal(total.copilot_cli_invocations, 0);
    assert.equal(total.copilot_sdk_requests, 2);
    assert.equal(usageSummary(total)['Copilot SDK requests'], 2);
  } finally { await complete.dispose(); }
  assert.equal(mock.stops, 1);
  assert.equal(fs.existsSync(mock.instances[0].baseDirectory), false);
  await assert.rejects(complete(request()), /closed/);
});

test('SDK selection retries share the host model-call limit and retain failed usage', async () => {
  const mock = mockSdk({ reply: () => ({ name: 'write_file', arguments_json: '{"path":4}' }) });
  let calls = 0;
  const complete = completion(mock, { beforeModelCall: () => { if (++calls > 2) throw new Error('Model-call budget exhausted'); } });
  try {
    await assert.rejects(complete(request()), (error) => {
      assert.match(error.message, /budget exhausted/);
      assert.equal(error.usage.total_tokens, 300);
      assert.equal(error.usage.copilot_sdk_requests, 2);
      return true;
    });
    assert.equal(mock.sends, 2);
  } finally { await complete.dispose(); }
});

test('SDK rejects uncontrolled native loops and tools rather than returning a usable selection', async () => {
  for (const options of [
    { extraCall: true },
    { reply: ({ emit }) => { emit('tool.execution_start'); return finish; } },
    { reply: ({ emit }) => { emit('session.compaction_start'); return finish; } }
  ]) {
    const mock = mockSdk(options);
    const complete = completion(mock);
    try {
      await assert.rejects(complete(request()), (error) => {
        assert.match(error.message, /uncontrolled|Forbidden/);
        assert.equal(error.usage.total_tokens, 150);
        return true;
      });
      assert.equal(mock.aborts, 1);
    } finally { await complete.dispose(); }
  }
});

test('SDK errors redact credentials, and unavailable metrics preserve event usage without estimating dollars', async () => {
  for (const options of [
    { reply: () => { throw new Error('ghu_private-token publisher-token other-secret http://user:proxy-password@proxy.invalid'); } },
    { metricsError: true }
  ]) {
    const mock = mockSdk(options), complete = completion(mock);
    try {
      await assert.rejects(complete(request()), (error) => {
        assert.doesNotMatch(error.message, /ghu_private-token|publisher-token|other-secret|proxy-password/);
        assert.equal(error.usage.known_total_tokens, 150);
        assert.equal(error.usage.cost_usd, null);
        assert.equal(error.usage.premium_requests, 7);
        return true;
      });
    } finally { await complete.dispose(); }
  }
});

test('SDK incomplete aggregates retain observed tokens and failed aborts force runtime shutdown', async () => {
  for (const options of [{ partialMetrics: true }, { abortError: true, reply: () => { throw new Error('provider failed'); } }]) {
    const mock = mockSdk(options), complete = completion(mock);
    try {
      await assert.rejects(complete(request()), (error) => {
        assert.equal(error.usage.known_total_tokens, 150);
        assert.equal(error.usage.cost_usd, null);
        return true;
      });

      if (options.abortError) assert.equal(mock.forced, 1);
    } finally { await complete.dispose(); }
  }
});

test('SDK violations after idle still invalidate the selection', async () => {
  const complete = completion(mockSdk({ lateEvent: 'session.compaction_start' }));
  try { await assert.rejects(complete(request()), /Forbidden Copilot SDK activity/); }
  finally { await complete.dispose(); }
});

test('SDK event-only accounting is partial when aggregate retrieval fails', async () => {
  const complete = completion(mockSdk({ metricsError: true }));
  try {
    await assert.rejects(complete(request()), (error) => {
      assert.equal(error.usage.total_tokens, null);
      assert.equal(error.usage.known_total_tokens, 150);
      assert.equal(error.usage.tokens_status, 'partial');
      return true;
    });
  } finally { await complete.dispose(); }
});

test('SDK timeouts abort in-flight work, clean up, and oversized inputs never start a runtime', async () => {
  const mock = mockSdk({ reply: () => new Promise(() => {}) });
  const complete = createCopilotSdkCompletion({ model: 'fixture', env: {}, maxInputBytes: 262144,
    maxOutputTokens: 8192, beforeModelCall() {}, sdkLoader: mock.loader, timeoutMs: 25 });
  try { await assert.rejects(complete(request()), /timed out/); }
  finally { await complete.dispose(); }
  assert.equal(mock.aborts, 1);
  const small = completion(mock, { maxInputBytes: 10 });
  try { await assert.rejects(small(request()), /max_input_bytes/); }
  finally { await small.dispose(); }
  assert.equal(mock.instances.length, 1);
});

test('SDK environment forwards only selected proxy settings, never parent runtime overrides', () => {
  const env = sdkRuntimeEnvironment('/private', { HTTP_PROXY: 'http://127.0.0.1:1234', NODE_EXTRA_CA_CERTS: '/egress/ca.pem',
    NODE_USE_ENV_PROXY: '1', NODE_OPTIONS: '--require=untrusted', COPILOT_CLI_PATH: '/untrusted', COPILOT_SDK_DEFAULT_CONNECTION: 'inprocess' });
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:1234');
  assert.equal(env.NODE_EXTRA_CA_CERTS, '/egress/ca.pem');
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.COPILOT_CLI_PATH, undefined);
  assert.equal(env.COPILOT_SDK_DEFAULT_CONNECTION, undefined);
});

test('SDK settings reject unknown backends and refuse unpinned package versions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-sdk-version-'));
  try {
    assert.throws(() => loadConfig({ repoRoot: root, env: { LIGHTS_ON_COPILOT_BACKEND: 'automatic' } }), /cli or sdk/);
    assert.equal(loadConfig({ repoRoot: root, env: { LIGHTS_ON_COPILOT_BACKEND: 'sdk' } }).engine.copilot_backend, 'sdk');
    const pkg = path.join(root, 'node_modules', '@github', 'copilot-sdk');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"0.0.0"}');
    await assert.rejects(loadCopilotSdk({ LIGHTS_ON_COPILOT_SDK_DIR: root }), /1.0.22 is required/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('SDK token exhaustion and shutdown errors do not export a candidate; usage survives cleanup errors', async () => {
  for (const cleanupFailure of [false, true]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-sdk-controller-'));
    const repo = path.join(root, 'repo'), candidate = path.join(root, 'candidate');
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.mkdirSync(candidate);
    fs.writeFileSync(path.join(repo, 'README.md'), 'original\n');
    fs.writeFileSync(path.join(repo, '.github', 'lights-on.yml'), 'engine:\n  copilot_backend: sdk\nlimits:\n  max_tokens_per_run: 100\n');
    let applied = false, disposed = false;
    const mock = mockSdk({ stopErrors: cleanupFailure ? [new Error('shutdown')] : [],
      reply: () => ({ name: 'write_file', arguments_json: '{"path":"README.md","content":"candidate"}' }) });
    try {
      const run = runAgent({ task: 'docs-clarifier', repoRoot: repo, provider: 'copilot',
        env: { COPILOT_GITHUB_TOKEN: 'fixture', LIGHTS_ON_STATE_FILE: path.join(root, 'state.json') },
        outputPath: path.join(root, 'result.json'), copilotSdkLoader: mock.loader,
        sandboxFactory: () => ({ workspace: candidate, run() { assert.fail('No commands expected'); },
          apply() { applied = true; return []; }, dispose() { disposed = true; } }) });
      if (cleanupFailure) {
        await assert.rejects(run, (error) => { assert.equal(error.usage.total_tokens, 150); return true; });
        assert.equal(mock.forced, 1);
      } else {
        const result = await run;
        assert.equal(result.status, 'failed');
        assert.equal(result.execution.stop_reason, 'max_tokens');
        assert.equal(result.usage.total_tokens, 150);
      }
      assert.equal(applied, false);
      assert.equal(disposed, true);
      assert.equal(fs.readFileSync(path.join(repo, 'README.md'), 'utf8'), 'original\n');
    } finally { fs.rmSync(root, { recursive: true }); }
  }
});

test('SDK cleanup failure stops provider fallback and preserves accounting', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-sdk-cleanup-'));
  try {
    fs.mkdirSync(path.join(root, '.github'));
    fs.writeFileSync(path.join(root, '.github', 'lights-on.yml'), 'engine:\n  copilot_backend: sdk\n  fallback_providers: [claude]\n');
    await assert.rejects(runAgent({ task: 'docs-clarifier', repoRoot: root, provider: 'copilot',
      stateFile: path.join(root, 'state.json'), outputPath: path.join(root, 'out.json'),
      env: { COPILOT_GITHUB_TOKEN: 'fixture', ANTHROPIC_API_KEY: 'fixture' },
      copilotSdkLoader: mockSdk({ stopErrors: [new Error('cleanup failed')] }).loader,
      fetchImpl: () => assert.fail('Cleanup failure must not start another provider'),
      sandboxFactory: () => ({ workspace: root, run() {}, dispose() {}, apply() { assert.fail('No export'); } })
    }), (error) => {
      assert.match(error.message, /cleanup failed/);
      assert.equal(error.usage.known_total_tokens, 150);
      return true;
    });
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'state.json'), 'utf8')).usage_history[0].copilot_sdk_requests, 1);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('actual SDK uses its pinned runtime for bounded structured inference with zero native tools', {
  skip: process.env.LIGHTS_ON_TEST_COPILOT_SDK !== 'true', timeout: 60000
}, async () => {
  const requests = [], clients = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (!body) { res.writeHead(404).end(); return; }
    const input = JSON.parse(body);
    requests.push(input);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: JSON.stringify(finish) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const sdk = await loadCopilotSdk(process.env);
  const sdkLoader = async () => ({ ...sdk, CopilotClient: class extends sdk.CopilotClient {
    constructor(options) {
      options.connection.env.COPILOT_OFFLINE = 'true';
      super(options);
      clients.push(options);
    }
    createSession(options) {
      return super.createSession({ ...options, provider: { type: 'openai', wireApi: 'completions',
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture', maxOutputTokens: 512 } });
    }
  } });
  const complete = createProviderCompletion({ provider: 'copilot', copilotBackend: 'sdk', model: 'fixture', env: {},
    copilotSdkLoader: sdkLoader, maxOutputTokens: 512 });
  try {
    for (let i = 0; i < 2; i++) {
      const result = await complete(request());
      assert.equal(result.choices[0].message.tool_calls[0].function.name, 'finish_task');
      assert.equal(result.usage.total_tokens, 150);
      assert.equal(result.usage.cost_usd, null);
      assert.equal(result.usage.copilot_sdk_requests, 1);
    }
    assert.equal(clients.length, 1);
    assert.equal(requests.length, 2);
    for (const received of requests) {
      assert.equal((received.tools || []).length, 0);
      assert.equal(received.max_tokens, 512);
      assert.equal(received.response_format.type, 'json_schema');
      assert.ok(JSON.stringify(received).includes('controller task'));
    }
  } finally {
    await complete.dispose();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(fs.existsSync(clients[0].baseDirectory), false);
});
