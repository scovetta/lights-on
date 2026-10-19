import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { publishPr } from '../.github/lights-on/runner/publish-pr.mjs';
import { reportWorkflowEvent, reportMergeDecision } from '../.github/lights-on/runner/workflow-report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'owner/repo';
const url = `https://github.com/${repo}/pull/17`;
const head = 'lights-on/docs-clarification-20261018';
const title = 'docs: clarify recurring questions from issue tracker';
const existing = { number: 17, url, headRefName: head, baseRefName: 'main',
  headRepositoryOwner: { login: 'owner' }, isCrossRepository: false };

describe('GitHub workflow outcome annotations', () => {
  it('reports documentation PR creation, reuse, and concurrent reuse with links and branch details', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-report-'));
    const logs = [];
    t.mock.method(console, 'error', (line) => logs.push(line));
    try {
      for (const outcome of ['created', 'reused', 'concurrent']) {
        const summaryFile = path.join(dir, `${outcome}.md`);
        let queries = 0;
        const result = publishPr({ repo, installedRepo: repo, head, base: 'main', title,
          body: 'Automated documentation improvements.', labels: ['lights-on:docs'],
          env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile },
          execFileImpl: (_cmd, args) => {
            if (args[0] === 'label') return '';
            if (args[1] === 'list') {
              queries++;
              return JSON.stringify(outcome === 'reused' || (outcome === 'concurrent' && queries === 2) ? [existing] : []);
            }
            if (outcome === 'concurrent') throw new Error('PR already exists');
            return `${url}\n`;
          } });
        assert.equal(result.url, url);
        assert.equal(result.created, outcome === 'created');
        const annotation = logs.at(-1);
        assert.match(annotation, /^::notice title=/);
        assert.ok(annotation.includes(`${outcome === 'created' ? 'Created' : 'Reused'} PR #17`));
        assert.ok(annotation.includes(title));
        assert.ok(annotation.includes(url));
        const summary = fs.readFileSync(summaryFile, 'utf8');
        assert.ok(summary.includes(`[Open in GitHub](${url})`));
        assert.ok(summary.includes(title));
        assert.ok(summary.includes(head));
        assert.ok(summary.includes('lights-on:docs'));
        assert.match(summary, /\*\*Base branch:\*\* main/);
      }
      assert.equal(logs.length, 3, 'Each publication emits exactly one outcome annotation.');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports failed publication as an error, never as PR creation', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-report-failure-'));
    const logs = [];
    t.mock.method(console, 'error', (line) => logs.push(line));
    try {
      const summaryFile = path.join(dir, 'summary.md');
      assert.throws(() => publishPr({ repo, installedRepo: repo, head, base: 'main', title,
        body: '', labels: ['lights-on:docs'],
        env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile, GH_TOKEN: 'private-canary' },
        execFileImpl: (_cmd, args) => {
          if (args[0] === 'label') return '';
          if (args[1] === 'list') return '[]';
          throw new Error('Authorization failed: private-canary\n::notice::fake success');
        } }), /Authorization failed/);
      assert.equal(logs.length, 1);
      assert.match(logs[0], /^::error title=PR publication failed::/);
      assert.ok(!logs[0].includes('private-canary'));
      assert.ok(!logs[0].includes('\n'));
      const summary = fs.readFileSync(summaryFile, 'utf8');
      assert.ok(!summary.includes('private-canary'));
      assert.ok(!summary.includes('Pull request created'));
      assert.ok(summary.includes(head));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('uses the confirmed existing PR title instead of reporting an unsubmitted replacement title', (t) => {
    const lines = [];
    t.mock.method(console, 'error', (line) => lines.push(line));
    publishPr({ repo, installedRepo: repo, head, base: 'main', title: 'unsubmitted title',
      body: '', env: { GITHUB_ACTIONS: 'true' },
      execFileImpl: () => JSON.stringify([{ ...existing, title: 'docs: previously published title' }]) });
    assert.equal(lines.length, 1);
    assert.match(lines[0], /previously published title/);
    assert.ok(!lines[0].includes('unsubmitted title'));
  });

  it('does not announce a PR when the returned URL cannot be verified', (t) => {
    const lines = [];
    t.mock.method(console, 'error', (line) => lines.push(line));
    assert.throws(() => publishPr({ repo, installedRepo: repo, head, base: 'main', title,
      body: '', env: { GITHUB_ACTIONS: 'true' },
      execFileImpl: (_cmd, args) => args[1] === 'list' ? '[]' : 'https://github.com/another/repo/pull/17'
    }), /Could not verify/);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^::error/);
  });

  it('escapes untrusted annotation/Markdown text and appends rather than overwriting prior outcomes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-report-escaping-'));
    try {
      const summaryFile = path.join(dir, 'summary.md');
      const env = { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summaryFile, API_KEY: 'private-value' };
      const lines = [];
      reportWorkflowEvent({ title: 'Docs, title:\n::error::bad',
        message: '<script>bad</script> [fake](https://evil.invalid) `code` 100%\n::error::private-value',
        url, details: { Branch: 'branch|table' } }, { env, write: (line) => lines.push(line) });
      reportWorkflowEvent({ title: 'Dependency publication skipped', message: 'No dependency candidate.' },
        { env, write: (line) => lines.push(line) });
      assert.equal(lines.length, 2);
      assert.ok(lines[0].includes('%2C'));
      assert.ok(lines[0].includes('%3A'));
      assert.ok(lines[0].includes('100%25%0A'));
      assert.ok(lines.every((line) => !line.includes('\n') && !line.includes('private-value')));
      const summary = fs.readFileSync(summaryFile, 'utf8');
      assert.ok(summary.includes('&lt;script&gt;'));
      assert.ok(summary.includes('\\[fake\\]\\(https://evil.invalid\\)'));
      assert.ok(summary.includes('branch\\|table'));
      assert.ok(summary.includes(url));
      assert.ok(summary.includes('Dependency publication skipped'));
      assert.throws(() => reportWorkflowEvent({ title: 'Invalid', message: 'bad link', url: 'javascript:alert(1)' },
        { env, write: () => {} }), /Unsafe URL/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('preserves machine-readable stdout when called from workflow shell steps', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-report-cli-'));
    try {
      const result = spawnSync(process.execPath, [path.join(root, '.github', 'lights-on', 'runner', 'workflow-report.mjs'),
        '--title', 'Documentation publication skipped', '--message', 'No changes; no PR published.'],
      { encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md') } });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, /^::notice title=Documentation publication skipped::No changes; no PR published\./);
      assert.ok(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8').includes('No changes; no PR published.'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('reports actual blocking reasons without claiming all gates passed', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-report-gate-'));
    const logs = [];
    t.mock.method(console, 'error', (line) => logs.push(line));
    try {
      const summaryFile = path.join(dir, 'summary.md');
      const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repo, PR_NUMBER: '17',
        HEAD_SHA: 'a'.repeat(40), CI_STATUS: 'pending', GITHUB_STEP_SUMMARY: summaryFile };
      reportMergeDecision({ allowAutoMerge: false, reasons: ['external-pr-automerge-disabled', 'ci-not-passing'] }, { env });
      assert.match(logs[0], /^::warning title=PR auto-merge blocked::/);
      assert.ok(logs[0].includes('ci-not-passing'));
      assert.ok(!logs[0].includes('passed all'));
      const summary = fs.readFileSync(summaryFile, 'utf8');
      assert.ok(summary.includes(url));
      assert.ok(summary.includes('a'.repeat(40)));
      assert.ok(summary.includes('pending'));
      reportMergeDecision({ allowAutoMerge: true, reasons: [] }, { env });
      assert.match(logs[1], /not confirmation of a merge/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('routes documentation PRs through the reporter and gives the no-change branch an explicit outcome', () => {
    const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'lights-on-schedule.yml'), 'utf8');
    const docs = workflow.split('- name: Open Documentation Clarification PR')[1].split('- name: Fetch open actionable issues')[0];
    assert.ok(docs.includes('node .github/lights-on/runner/publish-pr.mjs'));
    assert.ok(docs.includes('--label "lights-on:docs"'));
    assert.ok(docs.includes('--title "Documentation publication skipped"'));
    assert.ok(docs.indexOf('publish-pr.mjs') < docs.indexOf('Documentation publication skipped'));
  });
});
