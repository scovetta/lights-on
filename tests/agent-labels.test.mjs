import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareAgentLabelChanges } from '../.github/lights-on/runner/agent-labels.mjs';
import { STANDARD_LABELS } from '../.github/lights-on/runner/ensure-labels.mjs';
import * as stateStore from '../.github/lights-on/runner/state-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = 'owner/repo';
const base = { repo: repository, installedRepo: repository, env: {} };
const workflow = (name) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');

test('missing custom labels are reported and skipped without creating arbitrary repository labels', (t) => {
  const messages = [];
  t.mock.method(console, 'error', (message) => messages.push(message));
  const calls = [];
  const changes = prepareAgentLabelChanges({ ...base,
    labelsToAdd: ['out-of-scope', 'DOCUMENTATION', 'documentation'],
    labelsToRemove: ['nonexistent'],
    execFileImpl: (cmd, args) => {
      calls.push([cmd, ...args]);
      return JSON.stringify([[{ name: 'documentation' }]]);
    }
  });
  assert.deepEqual(changes, { labelsToAdd: ['documentation'], labelsToRemove: [] });
  assert.deepEqual(calls, [['gh', 'api', '--paginate', '--slurp', 'repos/owner/repo/labels?per_page=100']]);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /warning.*out-of-scope.*not created automatically/);
  assert.match(messages[1], /notice.*nonexistent.*Nothing needs to be removed/);
});

test('only missing requested standard labels are created before use, preserving existing definitions', () => {
  const calls = [];
  const changes = prepareAgentLabelChanges({ ...base,
    labelsToAdd: ['Lights-On:Ignore', 'lights-on:ignore', 'lights-on:triaged', 'Documentation'],
    labelsToRemove: ['LIGHTS-ON:RE-REVIEW'],
    execFileImpl: (cmd, args) => {
      assert.equal(cmd, 'gh');
      calls.push(args);
      if (args[0] === 'api') return JSON.stringify([
        [{ name: 'lights-on:triaged' }], [{ name: 'Documentation' }, { name: 'Lights-On:Re-Review' }]
      ]);
      assert.equal(args[0], 'label');
      assert.equal(args[2], 'lights-on:ignore');
      assert.equal(args[args.indexOf('--repo') + 1], repository);
      assert.ok(args.includes('--force'));
      return '';
    }
  });
  assert.deepEqual(changes, { labelsToAdd: ['lights-on:ignore', 'lights-on:triaged', 'Documentation'],
    labelsToRemove: ['Lights-On:Re-Review'] });
  assert.equal(calls.length, 2);
});

test('maintainer-control and read-only restrictions precede inventory and label creation', () => {
  const changes = prepareAgentLabelChanges({ ...base,
    labelsToAdd: [...stateStore.PROTECTED_MAINTAINER_ADD_LABELS, 'LIGHTS-ON:ACTIONABLE'],
    labelsToRemove: [...stateStore.PROTECTED_MAINTAINER_REMOVE_LABELS],
    readOnly: true, execFileImpl: () => assert.fail('Protected requests must not reach GitHub')
  });
  assert.deepEqual(changes, { labelsToAdd: [], labelsToRemove: [] });
  for (const name of ['ok,lights-on:automerge', 'ok\nbad', '"fake"', { name: 'fake' }]) {
    assert.throws(() => prepareAgentLabelChanges({ ...base, labelsToAdd: [name],
      execFileImpl: () => assert.fail('Invalid names must not reach GitHub') }), /Invalid agent label/);
  }
  assert.throws(() => prepareAgentLabelChanges({ ...base, repo: 'other/repo', labelsToAdd: ['out-of-scope'],
    execFileImpl: () => assert.fail('Foreign repository must not reach GitHub') }), /REPO_WRITE_VIOLATION/);
});

test('inventory and standard-label permission failures remain errors rather than successful skips', () => {
  for (const output of ['{}', '[]', '[{}]', '[[{}]]', '[[{"name":null}]]', 'broken']) {
    assert.throws(() => prepareAgentLabelChanges({ ...base, labelsToAdd: ['out-of-scope'], execFileImpl: () => output }));
  }
  assert.throws(() => prepareAgentLabelChanges({ ...base, labelsToAdd: ['out-of-scope'],
    execFileImpl: () => { throw new Error('API permission denied'); } }), /API permission denied/);
  assert.throws(() => prepareAgentLabelChanges({ ...base, labelsToAdd: ['lights-on:triaged'],
    execFileImpl: (_cmd, args) => {
      if (args[0] === 'api') return '[[]]';
      throw new Error('Label creation permission denied');
    } }), /Label creation permission denied/);
});

test('unknown-label warnings cannot inject annotations and are visible in the run summary', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-labels-'));
  const messages = [];
  t.mock.method(console, 'error', (message) => messages.push(message));
  try {
    const summary = path.join(root, 'summary.md');
    const changes = prepareAgentLabelChanges({ ...base, labelsToAdd: ['::error::madeup'],
      env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary }, execFileImpl: () => '[[]]' });
    assert.deepEqual(changes.labelsToAdd, []);
    assert.equal(messages.length, 1);
    assert.match(messages[0], /^::warning title=Agent label skipped::/);
    assert.equal(messages[0].includes('\n'), false);
    assert.match(fs.readFileSync(summary, 'utf8'), /Custom labels are not created automatically/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the issue workflow still publishes its response when out-of-scope is absent', (t) => {
  t.mock.method(console, 'error', () => {});
  const block = workflow('lights-on-events.yml').split('- name: Apply Triage, Comment, or Fix PR')[1];
  const source = block.split("<< 'EOF'\n")[1].split('\n          EOF')[0]
    .replace(/^\s*import .*;\s*$/gm, '');
  const calls = [], writes = new Map();
  const exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === 'api') return '[[]]';
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'comment') return '';
    if (cmd === 'git' && args[0] === 'status') return '';
    assert.fail(`Unexpected mutation: ${cmd} ${args.join(' ')}`);
  };
  const fsMock = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ status: 'completed', labels_to_add: ['out-of-scope'],
      comment_body: 'This feature is outside the maintenance scope.', disposition: 'OUT-OF-SCOPE' }),
    writeFileSync: (file, content) => writes.set(file, content)
  };
  new Function('fs', 'execFileSync', 'stateStore', 'assertWriteTargetIsInstalledRepo',
    'reportWorkflowEvent', 'githubItemUrl', 'neutralizeCrossRepoAutoLinks', 'prepareAgentLabelChanges', 'process',
    source)(fsMock, exec, stateStore, (repo) => repo, () => {}, () => '', (body) => body,
    (options) => prepareAgentLabelChanges({ ...options, env: {}, execFileImpl: exec }),
    { env: { GITHUB_REPOSITORY: repository, ISSUE_NUMBER: '15', READ_ONLY_MODE: 'false' } });
  assert.match(writes.get('/tmp/lights-on-comment.md'), /outside the maintenance scope/);
  assert.ok(calls.some((call) => call[0] === 'gh' && call[1] === 'issue' && call[2] === 'comment'));
  assert.ok(!calls.some((call) => call.includes('--add-label')));
});

test('the PR workflow posts its commit-bound review when custom and re-review labels are absent', (t) => {
  t.mock.method(console, 'error', () => {});
  const block = workflow('lights-on-pr.yml').split('- name: Post structured 4-Gate review and update labels')[1];
  const source = block.split("<< 'EOF'\n")[1].split('\n          EOF')[0]
    .replace(/^\s*import .*;\s*$/gm, '');
  const sha = 'a'.repeat(40);
  let reviewed = false, inventories = 0;
  const fsMock = {
    existsSync: () => true,
    readFileSync: () => JSON.stringify({ status: 'completed', summary: 'Review complete.',
      labels_to_add: ['custom-review-label'], labels_to_remove: ['missing-label'], verdict: 'COMMENT' }),
    writeFileSync() {}
  };
  const exec = (_cmd, args) => {
    assert.equal(args[0], 'api');
    inventories++;
    return '[[]]';
  };
  new Function('fs', 'execFileSync', 'submitCommitReview', 'formatStateComment', 'prepareAgentLabelChanges',
    'reportWorkflowEvent', 'githubItemUrl', 'assertWriteTargetIsInstalledRepo', 'neutralizeCrossRepoAutoLinks',
    'process', source)(fsMock, exec, ({ prNumber, headSha }) => {
    assert.equal(prNumber, '15'); assert.equal(headSha, sha); reviewed = true;
    return { event: 'COMMENT' };
  }, stateStore.formatStateComment,
  (options) => prepareAgentLabelChanges({ ...options, env: {}, execFileImpl: exec }),
  () => {}, () => '', (repo) => repo, (body) => body,
  { env: { GITHUB_REPOSITORY: repository, PR_NUMBER: '15', HEAD_SHA: sha } });
  assert.ok(reviewed);
  assert.equal(inventories, 1);
});

test('both agent-driven workflows preflight label changes and the prompt uses standard labels', () => {
  for (const name of ['lights-on-events.yml', 'lights-on-pr.yml']) {
    const source = workflow(name);
    const call = source.indexOf('const { labelsToAdd, labelsToRemove } = prepareAgentLabelChanges(');
    assert.ok(call >= 0, name);
    assert.ok(source.indexOf("--add-label', labelsToAdd.join(',')") > call, name);
    assert.ok(source.indexOf("--remove-label', labelsToRemove.join(',')") > call, name);
  }
  const prompt = fs.readFileSync(path.join(ROOT, '.github', 'lights-on', 'prompts', 'issue-responder.md'), 'utf8');
  assert.doesNotMatch(prompt, /or `out-of-scope`|label the issue `documentation`/);
  for (const label of prompt.match(/lights-on:[a-z-]+/g) || []) {
    assert.ok(STANDARD_LABELS.some((item) => item.name === label), label);
  }
});
