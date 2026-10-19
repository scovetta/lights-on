import { spawn } from 'node:child_process';
import { forward } from './network/forward.mjs';
import { proxyEnvironment } from './network/fetch.mjs';
import { assert } from './policy.mjs';

const script = process.argv[2];
assert(['fetch', 'controller', 'prepare', 'publisher', 'probe'].includes(script), 'Unknown trusted role entry point.');
const proxy = await forward();
const tooling = ['controller', 'probe'].includes(script) && process.env.LIGHTS_ON_COPILOT_SDK_DIR
  ? { LIGHTS_ON_COPILOT_SDK_DIR: process.env.LIGHTS_ON_COPILOT_SDK_DIR } : {};
// Keep the forwarder responsive while the child runs synchronous Git/CLI calls.
const child = spawn(process.execPath, [`/code/local/${script}.mjs`, ...process.argv.slice(3)], {
  env: proxyEnvironment(proxy.url, tooling), stdio: 'inherit'
});
try {
  process.exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally { proxy.close(); }
