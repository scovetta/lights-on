import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProfile, aggregateValidation, validateCandidate } from '../local/validation.mjs';
import { validatePolicy, NODE_IMAGE } from '../local/policy.mjs';
import { Runtime, privateDirectory, writePrivate } from '../local/runtime.mjs';

test('CI profiles accept arbitrary tools, not arbitrary Docker privileges', () => {
  const profile = { id: 'rust', image: NODE_IMAGE, commands: ['cargo test --locked --offline'] };
  assert.equal(validateProfile(profile).commands[0], profile.commands[0]);
  for (const change of [{ privileged: true }, { mounts: ['/'] }, { network: 'host' },
    { environment: { GITHUB_TOKEN: 'secret' } }, { outputs: ['../outside'] }, { image: 'rust:latest' }]) {
    assert.throws(() => validateProfile({ ...profile, ...change }));
  }
  assert.equal(aggregateValidation([]), 'blocked');
  assert.equal(aggregateValidation([{ status: 'passed' }, { status: 'blocked' }]), 'blocked');
  assert.equal(aggregateValidation([{ status: 'passed' }, { status: 'failed' }]), 'failed');
});

test('real offline validation supports a native compiler and loopback-only services', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_LOCAL_DOCKER !== 'true',
  timeout: 180000
}, async () => {
  const root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-ci-test-')));
  const candidate = privateDirectory(path.join(root, 'candidate'));
  writePrivate(path.join(candidate, 'main.c'), '#include <stdio.h>\nint main(void) { puts("native-ok"); return 0; }\n');
  const netTest = `node -e 'const net=require("net");let c=net.connect(443,"1.1.1.1");c.on("connect",()=>process.exit(9));c.on("error",()=>process.exit(0));setTimeout(()=>{c.destroy();process.exit(0)},500)'`;
  const policy = validatePolicy({ version: 1, repository: 'owner/repo', profiles: [
    { id: 'native', image: NODE_IMAGE, commands: ['cc main.c -o /tmp/program && /tmp/program', netTest] },
    { id: 'service', image: NODE_IMAGE, commands: [
      `node -e 'fetch("http://127.0.0.1:8088").then(r=>r.text()).then(t=>{if(t!=="ok")process.exit(1)})'`, netTest
    ], services: [{ id: 'fixture', image: NODE_IMAGE, port: 8088,
      command: ['node', '-e', 'require("http").createServer((q,s)=>s.end("ok")).listen(8088,"127.0.0.1")'],
      healthCommand: `node -e 'fetch("http://127.0.0.1:8088").then(r=>{if(!r.ok)process.exit(1)})' && ${netTest}`
    }] }
  ] });
  const runtime = new Runtime({ policy, work: root });
  try {
    const result = await validateCandidate(runtime);
    assert.equal(result.status, 'passed', JSON.stringify(result));
    assert.equal(result.remoteChecksSatisfied, false);
    assert.equal(result.cases.length, 2);
    assert.match(result.cases[0].commands[0].stdout, /native-ok/);
    const failed = await validateCandidate(runtime, { profiles: [
      { id: 'missing', image: NODE_IMAGE, commands: ['missing_tool_123'] },
      { id: 'mutating', image: NODE_IMAGE, commands: ['echo changed > main.c'] },
      { id: 'missing-output', image: NODE_IMAGE, commands: ['true'], outputs: ['test.xml'] },
      { id: 'failed-output', image: NODE_IMAGE, commands: ['false'], outputs: ['test.xml'] },
      { id: 'mode-change', image: NODE_IMAGE, commands: ['chmod +x main.c'] },
      { id: 'windows', image: NODE_IMAGE, platform: 'windows/amd64', commands: ['true'] }
    ] });
    assert.deepEqual(failed.cases.map((c) => c.status), ['failed', 'blocked', 'blocked', 'failed', 'blocked', 'blocked']);
    const started = Date.now();
    const timeout = await validateCandidate(runtime, { profiles: [{
      id: 'unhealthy', image: NODE_IMAGE, commands: ['true'], timeoutSeconds: 1,
      services: [{ id: 'unhealthy', image: NODE_IMAGE, port: 8089,
        command: ['node', '-e', 'setInterval(()=>{},1000)'], healthCommand: 'false' }]
    }] });
    assert.notEqual(timeout.status, 'passed');
    assert.ok(Date.now() - started < 15000, 'Service readiness must share the one-second profile deadline, not wait thirty retries.');
  } finally { runtime.dispose(); fs.rmSync(root, { recursive: true }); }
});
