import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cacheAccess } from '../.github/actions/lights-on-cache-access/index.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');
const action = read('.github/actions/lights-on-agent/action.yml');
const scheduled = read('.github/workflows/lights-on-schedule.yml');
const step = (source, name, indentation = 6) => {
  const marker = `${' '.repeat(indentation)}- name: `;
  const block = source.split(marker).find((part) => part.startsWith(name + '\n'));
  assert.ok(block, name);
  return block;
};
const cachedPaths = (block) => block.match(/path: \|\n((?: +\/tmp\/[^\n]+\n)+)/)?.[1]
  .trim().split('\n').map((line) => line.trim());

test('effective cache modes gate reads and writes independently without changing permissions', () => {
  for (const [mode, readable, writable] of [
    ['read', true, false], ['write', true, true], ['write-only', false, true], ['none', false, false]
  ]) {
    for (const event of ['issues', 'issue_comment', 'pull_request_target', 'workflow_run', 'schedule', 'workflow_dispatch']) {
      assert.deepEqual(cacheAccess({ ACTIONS_CACHE_MODE: ` ${mode.toUpperCase()} `, GITHUB_EVENT_NAME: event }),
        { mode, readable, writable, source: 'runner' });
    }
  }
  assert.throws(() => cacheAccess({ ACTIONS_CACHE_MODE: 'unexpected', GITHUB_EVENT_NAME: 'schedule' }), /Unrecognized/);
});

test('legacy runners use conservative trigger defaults, never assuming low-trust cache writes', () => {
  for (const event of ['issues', 'issue_comment', 'pull_request_target', 'workflow_run', 'pull_request', 'unknown', '']) {
    const access = cacheAccess({ GITHUB_EVENT_NAME: event });
    assert.equal(access.writable, false, event);
    assert.equal(access.readable, true, event);
  }
  for (const event of ['push', 'workflow_dispatch', 'repository_dispatch', 'delete', 'registry_package', 'page_build', 'schedule']) {
    assert.equal(cacheAccess({ GITHUB_EVENT_NAME: event }).writable, true, event);
  }
});

test('native action reports access and accounting limitations without exposing runtime credentials', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-cache-access-'));
  try {
    const script = path.join(ROOT, '.github', 'actions', 'lights-on-cache-access', 'index.mjs');
    for (const mode of ['read', 'write', 'write-only', 'none']) {
      const output = path.join(root, `${mode}.out`), summary = path.join(root, `${mode}.md`);
      const result = spawnSync(process.execPath, [script], {
        encoding: 'utf8', timeout: 15000,
        env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, GITHUB_EVENT_NAME: 'issues',
          ACTIONS_CACHE_MODE: mode, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary,
          ACTIONS_RUNTIME_TOKEN: 'private-runtime-canary', GITHUB_TOKEN: 'private-github-canary' }
      });
      assert.equal(result.status, 0, result.stderr);
      const access = cacheAccess({ ACTIONS_CACHE_MODE: mode });
      assert.equal(fs.readFileSync(output, 'utf8'), `mode=${mode}\nreadable=${access.readable}\nwritable=${access.writable}\n`);
      const visible = result.stdout + result.stderr + fs.readFileSync(summary, 'utf8');
      assert.doesNotMatch(visible, /private-runtime-canary|private-github-canary/);
      if (!access.writable) assert.match(visible, /not durable across runs/);
      if (!access.readable) assert.match(visible, /cannot restore|Restore: false/);
    }
    const bad = spawnSync(process.execPath, [script], {
      encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        ACTIONS_CACHE_MODE: 'unexpected', GITHUB_OUTPUT: path.join(root, 'bad.out') }
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /Cache access check failed/);
    assert.equal(fs.existsSync(path.join(root, 'bad.out')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('cache saves across all agent-bearing workflows require writable access even after failed inference', () => {
  for (const [file, output] of [
    ['lights-on-events.yml', 'steps.agent.outputs.cache_writable'],
    ['lights-on-pr.yml', 'steps.review-agent.outputs.cache_writable'],
    ['lights-on-schedule.yml', 'steps.cache-access.outputs.writable']
  ]) {
    const workflow = read(`.github/workflows/${file}`);
    const save = step(workflow, 'Persist shared budget even after failed inference');
    assert.ok(save.includes(`${output} == 'true'`), file);
    assert.match(save, /if: always\(\)/);
    assert.doesNotMatch(workflow, /cache-mode:\s*(?:write|write-only)|actions:\s*write/);
    assert.deepEqual(cachedPaths(save), ['/tmp/lights-on-cache', '/tmp/lights-on-threat-model']);
  }
  assert.match(action, /cache_writable:[\s\S]*?value: \$\{\{ steps\.cache-access\.outputs\.writable \}\}/);
  const restore = step(action, 'Restore shared Lights On state', 4);
  assert.match(restore, /inputs\.restore_state != 'false' && steps\.cache-access\.outputs\.readable == 'true'/);
});

test('scheduled agents share one restore with matching cache paths instead of resetting earlier usage', () => {
  const restore = step(scheduled, 'Restore Lights On state cache');
  const save = step(scheduled, 'Persist shared budget even after failed inference');
  assert.deepEqual(cachedPaths(restore), cachedPaths(save));
  assert.deepEqual(cachedPaths(restore), cachedPaths(step(action, 'Restore shared Lights On state', 4)));
  assert.match(restore, /steps\.cache-access\.outputs\.readable == 'true'/);
  const agents = scheduled.split(/^      - name: /m).filter((block) => block.includes('uses: $/.github/actions/lights-on-agent'));
  assert.equal(agents.length, 5);
  for (const agent of agents) assert.match(agent, /restore_state: 'false'/);
  assert.ok(scheduled.indexOf('Restore Lights On state cache') < scheduled.indexOf('uses: $/.github/actions/lights-on-agent'));
  assert.ok(action.indexOf('uses: $/.github/actions/lights-on-cache-access') < action.indexOf('uses: actions/cache/restore'));
});
