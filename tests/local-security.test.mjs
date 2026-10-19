import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseArgs } from '../local/lights-on.mjs';
import { validatePolicy } from '../local/policy.mjs';

test('local gateway enforces independent capabilities, identity, TLS destinations and audit failure', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3',
    ['-B', 'tests/local-policy.py', 'local/network/policy.py'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

test('CLI never implicitly grants merge, releases or registry uploads', () => {
  assert.deepEqual(parseArgs(['run', '--publish']).capabilities, ['publish']);
  assert.deepEqual(parseArgs(['publish', '--allow-merge']).capabilities, ['merge']);
  assert.throws(() => parseArgs(['run', '--network', 'host']), /Unknown/);
  assert.throws(() => parseArgs(['run', '--item', '1;evil']), /positive/);
  assert.throws(() => parseArgs(['run', '--version', '../tag']), /semver/);
});

test('only scoped Copilot inference can forward ephemeral provider authorization', () => {
  const rule = { id: 'copilot', host: 'api.githubcopilot.com', path: '/chat/completions',
    methods: ['POST'], roles: ['analysis'], forwardAuthorization: true };
  const policy = { version: 1, repository: 'owner/repo', provider: 'copilot', rules: [rule] };
  assert.equal(validatePolicy(policy).rules[0].forwardAuthorization, true);
  assert.throws(() => validatePolicy({ ...policy, rules: [{ ...rule, host: 'api.github.com' }] }), /limited/);
  assert.throws(() => validatePolicy({ ...policy, rules: [{ ...rule, roles: ['publisher'] }] }), /limited/);
});

test('Windows launcher maps managed status and cleanup paths through WSL', {
  skip: process.platform !== 'win32' || process.env.LIGHTS_ON_TEST_WSL !== 'true', timeout: 30000
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-wsl-test-'));
  const id = crypto.randomUUID();
  const run = path.join(root, id);
  fs.mkdirSync(run);
  fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ version: 1, id, status: 'completed' }));
  try {
    const status = spawnSync(process.execPath, ['local/lights-on.mjs', 'status', '--run', run], { encoding: 'utf8', timeout: 15000 });
    assert.equal(status.status, 0, status.stderr);
    assert.equal(JSON.parse(status.stdout).id, id);
    const cleanup = spawnSync(process.execPath, ['local/lights-on.mjs', 'cleanup', '--run', run], { encoding: 'utf8', timeout: 15000 });
    assert.equal(cleanup.status, 0, cleanup.stderr);
    assert.equal(fs.existsSync(run), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
