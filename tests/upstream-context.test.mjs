import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { syncUpstream } from '../.github/lights-on/runner/sync-upstream.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, '.github', 'lights-on', 'runner', 'sync-upstream.mjs');
const tasks = ['bootstrap-threat-model', 'docs-clarifier', 'issue-responder'];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-upstream-context-'));
  const context = path.join(root, 'context.json'), items = path.join(root, 'items.json');
  const output = path.join(root, 'github-output');
  return {
    root, context, items,
    cli(setting, scenario) {
      return spawnSync(process.execPath, ['--input-type=module', '-e', `
        import { pathToFileURL } from 'node:url';
        globalThis.fetch = async (url, options) => {
          if (options?.method && options.method !== 'GET') throw new Error('Unexpected mutation');
          const endpoint = new URL(url).pathname;
          if (${JSON.stringify(scenario)} === 'api-error') return { ok: false, status: 503 };
          if (endpoint === '/repos/owner/project') {
            return { ok: true, json: async () => ({
              full_name: 'owner/project',
              ...(${JSON.stringify(scenario)} === 'fork' ? { parent: { full_name: 'upstream/project' } } : {})
            }) };
          }
          if (endpoint === '/repos/upstream/project') {
            return { ok: true, json: async () => ({ full_name: 'upstream/project' }) };
          }
          if (/^\\/repos\\/upstream\\/project\\/(issues|pulls|releases)$/.test(endpoint)) {
            return { ok: true, json: async () => [] };
          }
          throw new Error('Unexpected endpoint: ' + endpoint);
        };
        process.argv = [process.execPath, ${JSON.stringify(SCRIPT)},
          '--context-output', ${JSON.stringify(context)}, '--items-output', ${JSON.stringify(items)}, '--github-output'];
        await import(pathToFileURL(process.argv[1]).href);
      `], {
        cwd: root, encoding: 'utf8', timeout: 15000,
        env: {
          PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
          GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'empty.gitconfig'),
          GIT_CEILING_DIRECTORIES: path.dirname(root),
          GITHUB_REPOSITORY: 'owner/project', LIGHTS_ON_UPSTREAM_REPO: setting,
          LIGHTS_ON_STATE_FILE: path.join(root, 'state.json'), GITHUB_OUTPUT: output
        }
      });
    },
    outputs() {
      return Object.fromEntries(fs.readFileSync(output, 'utf8').trimEnd().split('\n').map((line) => {
        const equal = line.indexOf('='); return [line.slice(0, equal), line.slice(equal + 1)];
      }));
    },
    close() { fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test('every scheduled upstream-context consumer uses the optional producer output', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lights-on-schedule.yml'), 'utf8');
  const consumers = workflow.split(/^\s{6}- name:/m).filter((step) => tasks.some((task) => step.includes(`task: ${task}\n`) || step.includes(`task: ${task}\r\n`)));
  assert.equal(consumers.length, tasks.length);
  for (const consumer of consumers) {
    assert.match(consumer, /context_file: \$\{\{ steps\.upstream-sync\.outputs\.context_file \}\}/);
  }
});

test('disabled, self-referencing and undiscovered upstreams do not supply a missing context to scheduled agents', async () => {
  for (const [setting, source] of [['none', 'disabled'], ['', 'disabled'], ['owner/project', 'same-as-installed'], ['auto', 'none']]) {
    const f = fixture();
    try {
      // A leftover file must not turn optional upstream data into an input.
      fs.writeFileSync(f.context, 'STALE_UPSTREAM_CONTEXT');
      const command = f.cli(setting, 'no-parent');
      assert.equal(command.status, 0, command.stderr);
      const result = JSON.parse(command.stdout);
      assert.equal(result.source, source);
      const output = f.outputs();
      assert.equal(output.has_upstream, 'false');
      assert.equal(output.context_file, '');
      assert.equal(output.unsynced_file, '');
      assert.equal(output.created_local_count, '0');
      const snapshot = JSON.parse(fs.readFileSync(f.context));
      assert.equal(snapshot.hasUpstream, false);
      assert.equal(snapshot.status, 'skipped');
      assert.equal(snapshot.source, source);
      assert.equal(snapshot.upstreamRepo, null);
      assert.deepEqual(JSON.parse(fs.readFileSync(f.items)), []);
      const legacy = await runAgent({
        task: 'docs-clarifier', repoRoot: f.root, provider: 'claude', dryRun: true, env: {},
        contextFiles: [f.context], stateFile: path.join(f.root, 'state.json'),
        outputPath: path.join(f.root, 'legacy-result.json')
      });
      assert.equal(legacy.status, 'completed');
      fs.unlinkSync(f.context);
      for (const task of tasks) {
        const agent = await runAgent({
          task, repoRoot: f.root, provider: 'claude', dryRun: true,
          env: { GITHUB_EVENT_NAME: 'workflow_dispatch' },
          contextFiles: output.context_file ? [output.context_file] : [],
          stateFile: path.join(f.root, 'state.json'), outputPath: path.join(f.root, `${task}.json`),
          fetchImpl: () => assert.fail('Dry run must not call a provider')
        });
        assert.equal(agent.status, 'completed', `${setting}: ${task}`);
      }
    } finally { f.close(); }
  }
});

test('selected upstreams supply real files while API failures and lost required context remain errors', async () => {
  for (const setting of ['auto', 'upstream/project']) {
    const f = fixture();
    try {
      const command = f.cli(setting, 'fork');
      assert.equal(command.status, 0, command.stderr);
      const output = f.outputs();
      assert.equal(output.has_upstream, 'true');
      assert.equal(output.context_file, f.context);
      assert.equal(output.unsynced_file, f.items);
      assert.equal(JSON.parse(fs.readFileSync(f.context)).upstreamRepo, 'upstream/project');
      assert.deepEqual(JSON.parse(fs.readFileSync(f.items)), []);
      fs.unlinkSync(f.context);
      await assert.rejects(runAgent({
        task: 'docs-clarifier', repoRoot: f.root, provider: 'claude', dryRun: true, env: {},
        contextFiles: [output.context_file], stateFile: path.join(f.root, 'state.json'),
        outputPath: path.join(f.root, 'result.json')
      }), /Context file is missing/);
    } finally { f.close(); }
  }
  const f = fixture();
  try {
    const command = f.cli('upstream/project', 'api-error');
    assert.notEqual(command.status, 0);
    assert.match(command.stderr, /HTTP 503/);
    assert.equal(fs.existsSync(f.context), false);
  } finally { f.close(); }
});

test('unwritable no-upstream snapshot paths fail rather than advertising a successful handoff', async () => {
  const f = fixture();
  try {
    fs.mkdirSync(f.context);
    await assert.rejects(syncUpstream({
      repoRoot: f.root, env: { GITHUB_REPOSITORY: 'owner/project', LIGHTS_ON_UPSTREAM_REPO: 'none' },
      contextOutput: f.context, itemsOutput: f.items,
      fetchImpl: () => assert.fail('Disabled upstream must not perform network requests'),
      execFileImpl: () => assert.fail('Disabled upstream must not publish')
    }), /EISDIR|EACCES|EPERM/);
  } finally { f.close(); }
});
