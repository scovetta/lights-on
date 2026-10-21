import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describeChange, writeChangeDescription } from '../.github/lights-on/runner/describe-change.mjs';
import { commitPublicationText, literalPublicationBody } from '../.github/lights-on/runner/publication-text.mjs';
import { runGitHub, execFileSync as scopedExecFileSync } from '../.github/lights-on/runner/github-io.mjs';
import { executeToolCall } from '../.github/lights-on/runner/openrouter-agent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const result = {
  status: 'completed', task: 'docs-clarifier', provider: 'copilot', model: 'example-model',
  summary: 'Clarify CORS preflight handling and the unverified token passed to the secret callback.',
  pr_body: 'README.md now explains when OPTIONS requests skip verification and why secret callbacks must treat decoded token fields as untrusted.',
  details: { rationale: 'The previous README left these caller responsibilities implicit.',
    citations: ['README.md:270', 'src/index.ts:100'] },
  risk_level: 'low', breaking_api_change: false,
  files_changed: ['agent-invented-file.txt'], gate_results: { tests: 'PASS' }
};

test('descriptions retain concrete rationale and citations without upgrading agent claims into CI evidence', () => {
  const body = describeChange({ result, files: ['README.md'], env: {
    GITHUB_REPOSITORY: 'owner/repo', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '2'
  } });
  for (const detail of ['CORS preflight', 'secret callback', 'OPTIONS', 'caller responsibilities',
    'src/index.ts:100', 'Changed files\n\n- README.md', 'Provider: copilot', 'attempt: 2']) assert.ok(body.includes(detail), detail);
  assert.doesNotMatch(body, /agent-invented-file/);
  assert.match(body, /No independent validation results/);
  assert.match(body, /Agent-reported breaking API change: no; not a compatibility guarantee/);
  assert.doesNotMatch(body, /tests passed|CI passed|verified against OSV/);
  assert.throws(() => describeChange({ result: {} }), /nonempty result summary/);
  assert.throws(() => describeChange({ result: { ...result, pr_body: 'x'.repeat(70000) } }), /too large/);
});

test('local and dependency descriptions include actual controller verification and declared limitations', () => {
  const body = describeChange({
    result: { ...result, dependency_validation: { status: 'passed', checks: [{ command: 'npm test', exit_code: 0 }] } },
    validation: { status: 'passed', cases: [{ profile: 'node24', platform: 'linux/amd64',
      image: `sha256:${'a'.repeat(64)}`, status: 'passed',
      commands: [{ command: 'npm run lint', exitCode: 0 }] }] },
    files: ['package-lock.json'], notes: ['Maintainer review required; created as a draft.'], env: {}
  });
  assert.match(body, /Local validation: passed/);
  assert.match(body, /node24: passed/);
  assert.match(body, /npm run lint\n  Exit code: 0/);
  assert.match(body, /Dependency candidate validation: passed/);
  assert.match(body, /npm test\n  Exit code: 0/);
  assert.match(body, /Maintainer review required/);
  const release = describeChange({ result: { prTitle: 'Release v1.2.3', prBody: 'Includes the documented parser fix.' }, env: {} });
  assert.match(release, /Release v1.2.3/);
  assert.match(release, /documented parser fix/);
});

test('finish_task preserves the explanation fields used by all publishers', () => {
  const output = executeToolCall('finish_task', { ...result, action_taken: 'docs_updated' }, { workingDir: ROOT });
  assert.equal(output.finished, true);
  assert.equal(output.result.pr_body, result.pr_body);
  assert.deepEqual(output.result.details, result.details);
  assert.equal(output.result.summary, result.summary);
});

test('staged-file descriptions and real commit bodies preserve detail without activating external references', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-description-'));
  try {
    const repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    git(['init', '-q']);
    fs.writeFileSync(path.join(repo, 'README.md'), 'fixture');
    git(['add', 'README.md']);
    const resultFile = path.join(root, 'result.json');
    const output = path.join(root, 'pr-body.md'), commitOutput = path.join(root, 'commit.txt');
    fs.writeFileSync(resultFile, JSON.stringify({
      ...result, pr_body: `${result.pr_body}\n\nupstream/repo#7 @maintainer\n\`\`\`\nhttps://github.com/foreign/repo/issues/1`
    }));
    writeChangeDescription({ resultFile, output, commitOutput, title: 'docs: clarify callback behavior', repoRoot: repo, env: {} });
    assert.match(fs.readFileSync(output, 'utf8'), /Changed files\n\n- README.md/);
    assert.doesNotMatch(fs.readFileSync(output, 'utf8'), /agent-invented-file/);
    const message = fs.readFileSync(commitOutput, 'utf8');
    assert.match(message, /^docs: clarify callback behavior\n\nSummary\n\n/);
    assert.match(message, /CORS preflight/);
    assert.doesNotMatch(message, /upstream\/repo|https:\/\/|[#@&]/);
    git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '-F', commitOutput]);
    assert.match(git(['log', '-1', '--format=%B']), /Summary\n\nClarify CORS preflight/);
    fs.appendFileSync(path.join(repo, 'README.md'), '\nmore');
    git(['add', 'README.md']);
    scopedExecFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'docs: more context',
      '-m', 'Summary\n\nKeep the explanation.\n\nupstream/repo#6 @someone'], {
      cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
    });
    const scopedMessage = git(['log', '-1', '--format=%B']);
    assert.match(scopedMessage, /Summary\n\nKeep the explanation/);
    assert.doesNotMatch(scopedMessage, /upstream\/repo|[#@]/);
    const fenced = literalPublicationBody(fs.readFileSync(output, 'utf8'));
    assert.match(fenced, /^`{4,}text\n/);
    assert.equal(commitPublicationText(literalPublicationBody('Summary\n\nupstream/repo#7')), 'Summary\n\nupstream / repo number 7');
    fs.writeFileSync(resultFile, JSON.stringify({ ...result, status: 'skipped' }));
    assert.throws(() => writeChangeDescription({ resultFile, output, commitOutput, title: 'skip', repoRoot: repo }), /completed live/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('squash and merge commits preserve current PR descriptions only for the reviewed head', () => {
  const env = { GITHUB_REPOSITORY: 'owner/repo' }, sha = 'a'.repeat(40);
  for (const method of ['--squash', '--merge']) {
    const calls = [];
    runGitHub(['pr', 'merge', '6', '--repo', 'owner/repo', method, '--match-head-commit', sha], { env },
      (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'api') return JSON.stringify({
          state: 'open', merged: false, head: { sha }, title: 'docs: clarify callbacks',
          body: literalPublicationBody('Summary\n\nTreat the decoded token as untrusted.\n\nupstream/repo#6')
        });
        assert.equal(args[args.indexOf('--subject') + 1], 'docs: clarify callbacks');
        const body = args[args.indexOf('--body') + 1];
        assert.match(body, /^Summary\n\nTreat the decoded token as untrusted/);
        assert.match(body, new RegExp(`Reviewed head: ${sha}`));
        assert.doesNotMatch(body, /upstream\/repo|#/);
        return '';
      });
    assert.equal(calls.length, 2);
    assert.ok(calls[0].includes('repos/owner/repo/pulls/6'));
  }
  let mutations = 0;
  assert.throws(() => runGitHub(['pr', 'merge', '6', '--repo', 'owner/repo', '--squash', '--match-head-commit', sha], { env },
    (_cmd, args) => {
      if (args[0] !== 'api') mutations++;
      return JSON.stringify({ state: 'open', title: 'changed', body: 'details', head: { sha: 'b'.repeat(40) } });
    }), /reviewed head changed/);
  assert.equal(mutations, 0);
});

test('explicit merge messages remain authoritative and nullable PR bodies get a truthful fallback', () => {
  const env = { GITHUB_REPOSITORY: 'owner/repo' }, sha = 'a'.repeat(40);
  let requests = 0;
  runGitHub(['pr', 'merge', '6', '--repo', 'owner/repo', '--squash',
    '--subject', 'Explicit title', '--body', 'Explicit explanation\n\nSecond paragraph.'], { env }, (_cmd, args) => {
    requests++;
    assert.equal(args[0], 'pr');
    assert.equal(args[args.indexOf('--body') + 1], 'Explicit explanation\n\nSecond paragraph.');
    return '';
  });
  assert.equal(requests, 1);
  runGitHub(['pr', 'merge', '6', '--repo', 'owner/repo', '--squash', '--match-head-commit', sha], { env }, (_cmd, args) => {
    if (args[0] === 'api') return JSON.stringify({ state: 'open', head: { sha }, title: 'Title', body: null });
    assert.match(args[args.indexOf('--body') + 1], /^No PR description was supplied/);
    return '';
  });
});

test('all generated proposal commits have description bodies and scheduled agents no longer use placeholder PR text', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lights-on-schedule.yml'), 'utf8').replace(/\r\n/g, '\n');
  for (const [name, task] of [
    ['Open PR for THREAT_MODEL', 'bootstrap'], ['Open Security Remediation', 'security'], ['Open Documentation Clarification', 'docs']
  ]) {
    const section = workflow.split(`- name: ${name}`)[1].split('\n      - name:')[0];
    assert.ok(section.includes(`--result /tmp/lights-on-${task}-result.json`));
    assert.ok(section.includes(`--body-file /tmp/lights-on-${task}-pr.md`));
    assert.ok(section.includes(`git commit -F /tmp/lights-on-${task}-commit.txt`));
    assert.ok(section.indexOf('describe-change.mjs') < section.indexOf('git commit'));
  }
  assert.doesNotMatch(workflow, /Automated documentation improvements grounded in recent user questions/);
  assert.match(workflow, /'commit', '-m', title, '-m', body/);
  assert.match(workflow, /'commit', '-m', res\.prTitle, '-m', res\.prBody/);
  for (const file of ['dependency-stage.mjs', 'maintain-toolchains.mjs']) {
    const source = fs.readFileSync(path.join(ROOT, '.github', 'lights-on', 'runner', file), 'utf8');
    assert.match(source, /'commit', '-m', title, '-m', (?:description|body)/);
  }
  const local = fs.readFileSync(path.join(ROOT, 'local', 'publisher.mjs'), 'utf8');
  assert.match(local, /body: literalPublicationBody\(description\)/);
  assert.match(local, /commitPublicationText\(description\)/);
});
