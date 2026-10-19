import net from 'node:net';
import assert from 'node:assert/strict';
import { proxyFetch, command } from './network/fetch.mjs';
import { createProviderCompletion } from '../.github/lights-on/runner/provider-completion.mjs';
import { spawnSync } from 'node:child_process';
import { loadCopilotSdk } from '../.github/lights-on/runner/copilot-sdk-completion.mjs';

async function cannotConnect(host, port) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    socket.setTimeout(1000, () => socket.destroy(new Error('timeout')));
    socket.once('error', resolve);
    socket.once('connect', () => { socket.destroy(); reject(new Error('Direct network bypass succeeded')); });
  });
}
if (process.argv.includes('--providers')) {
  for (const provider of ['claude', 'codex', 'openrouter', 'copilot']) {
    const complete = createProviderCompletion({ provider, model: 'test-model', env: {},
      spawnImpl: (cmd, args, options) => spawnSync(cmd, args, { ...options,
        env: { ...options.env, HTTP_PROXY: process.env.HTTP_PROXY, HTTPS_PROXY: process.env.HTTPS_PROXY,
          NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/egress/ca.pem', SSL_CERT_FILE: '/egress/ca.pem',
          COPILOT_OFFLINE: 'true', COPILOT_PROVIDER_TYPE: 'openai', COPILOT_PROVIDER_WIRE_API: 'completions',
          COPILOT_PROVIDER_BASE_URL: 'https://api.openai.com/v1' } })
    });
    const result = await complete({ messages: [{ role: 'user', content: 'controlled fixture' }],
      tools: [{ type: 'function', function: { name: 'finish_task', parameters: { type: 'object',
        properties: { summary: { type: 'string' }, action_taken: { type: 'string' } }, required: ['summary', 'action_taken'] } } }] });
    assert.equal(result.choices[0].message.tool_calls[0].function.name, 'finish_task');
    if (provider === 'copilot') {
      assert.equal(result.usage.copilot_cli_invocations, 2);
      assert.equal(result.usage.cost_usd, null);
    }
  }
  const sdk = await loadCopilotSdk(process.env);
  const copilotSdkLoader = async () => ({ ...sdk, CopilotClient: class extends sdk.CopilotClient {
    constructor(options) {
      options.connection.env.COPILOT_OFFLINE = 'true';
      super(options);
    }
    createSession(options) {
      return super.createSession({ ...options, provider: { type: 'openai', wireApi: 'completions',
        baseUrl: 'https://api.openai.com/v1', apiKey: 'fixture', maxOutputTokens: 512 } });
    }
  } });
  const sdkComplete = createProviderCompletion({ provider: 'copilot', copilotBackend: 'sdk', model: 'test-model',
    env: process.env, copilotSdkLoader, maxOutputTokens: 512 });
  try {
    const result = await sdkComplete({ messages: [{ role: 'user', content: 'controlled SDK fixture' }],
      tools: [{ type: 'function', function: { name: 'finish_task', parameters: { type: 'object',
        properties: { summary: { type: 'string' }, action_taken: { type: 'string' } }, required: ['summary', 'action_taken'] } } }] });
    assert.equal(result.choices[0].message.tool_calls[0].function.name, 'finish_task');
    assert.equal(result.usage.total_tokens, 15);
    assert.equal(result.usage.copilot_sdk_requests, 1);
    assert.equal(result.usage.cost_usd, null);
  } finally { await sdkComplete.dispose(); }
  console.log('PASS: Copilot SDK structured inference uses the protected TLS route with zero native tools.');
  console.log('PASS: all four inference adapters use the protected TLS route; Copilot exposes no native tools.');
} else {
await cannotConnect('1.1.1.1', 443);
await cannotConnect('169.254.169.254', 80);
await cannotConnect('2606:4700:4700::1111', 443);
const denied = await fetch('https://example.com');
assert.equal(denied.status, 403);
const response = await proxyFetch('https://api.github.com/repos/scovetta/test-aw1');
assert.equal((await response.json()).full_name.toLowerCase(), 'scovetta/test-aw1');
const git = command('git', ['-c', 'credential.helper=', 'ls-remote', 'https://github.com/scovetta/test-aw1.git', 'HEAD']);
assert.match(git, /^[a-f0-9]{40}\s+HEAD/);
console.log('PASS: real Node fetch and Git TLS through scoped Unix egress; direct IPv4/IPv6/metadata blocked.');
}
