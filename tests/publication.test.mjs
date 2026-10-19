import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ensureLabels, STANDARD_LABELS } from '../.github/lights-on/runner/ensure-labels.mjs';
import { publishPr } from '../.github/lights-on/runner/publish-pr.mjs';
import { LABELS } from '../.github/lights-on/runner/state-store.mjs';
import { publishDependencyStage } from '../.github/lights-on/runner/dependency-stage.mjs';
import { dependencyFileHash } from '../.github/lights-on/runner/dependency-work.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'steward/project';
const pr = { number: 1, url: `https://github.com/${repo}/pull/1`,
  headRefName: 'lights-on/dependency-maintenance-2026-10-18', baseRefName: 'main',
  headRepositoryOwner: { login: 'steward' }, isCrossRepository: false };
const options = { repo, installedRepo: repo, head: pr.headRefName, base: 'main',
  title: 'chore(deps): update dependency', body: 'Dependency update', labels: ['lights-on:dependencies'], env: {} };
const readWorkflow = (name) => fs.readFileSync(path.join(root, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');

describe('Required labels and PR publication', () => {
  it('creates missing dependency labels before creating a PR on a fresh installation', () => {
    const labels = new Set();
    const calls = [];
    const result = publishPr({ ...options, execFileImpl: (cmd, args) => {
      assert.equal(cmd, 'gh');
      assert.equal(args[args.indexOf('--repo') + 1], repo);
      calls.push(args);
      if (args[0] === 'label') {
        assert.ok(args.includes('--force'));
        labels.add(args[2]);
        return '';
      }
      if (args[1] === 'list') return '[]';
      if (!labels.has('lights-on:dependencies')) throw new Error("could not add label: 'lights-on:dependencies' not found");
      return pr.url;
    } });
    assert.equal(result.created, true);
    assert.equal(result.url, pr.url);
    assert.deepEqual(calls.map((args) => args.slice(0, 2)), [['label', 'create'], ['pr', 'list'], ['pr', 'create']]);
  });

  it('reuses an existing same-repository PR, but not a fork with the same branch name', () => {
    for (const isCrossRepository of [false, true]) {
      let creates = 0;
      const result = publishPr({ ...options, execFileImpl: (_cmd, args) => {
        if (args[0] === 'label') return '';
        if (args[1] === 'list') return JSON.stringify([{ ...pr, isCrossRepository }]);
        creates++;
        return pr.url;
      } });
      assert.equal(creates, isCrossRepository ? 1 : 0);
      assert.equal(result.created, isCrossRepository);
    }
  });

  it('only treats a confirmed concurrently created PR as a successful create failure', () => {
    for (const concurrent of [true, false]) {
      let queries = 0;
      const run = () => publishPr({ ...options, execFileImpl: (_cmd, args) => {
        if (args[0] === 'label') return '';
        if (args[1] === 'list') {
          queries++;
          return JSON.stringify(concurrent && queries === 2 ? [pr] : []);
        }
        throw new Error('PR creation failed');
      } });
      if (concurrent) assert.equal(run().created, false);
      else assert.throws(run, /PR creation failed/);
      assert.equal(queries, 2);
    }
  });

  it('propagates label failures and rejects cross-repo writes before any API call', () => {
    let calls = 0;
    const execFileImpl = () => { calls++; throw new Error('Resource not accessible by integration'); };
    assert.throws(() => publishPr({ ...options, execFileImpl }), /Resource not accessible/);
    assert.equal(calls, 1);
    calls = 0;
    assert.throws(() => ensureLabels({ repo: 'upstream/project', installedRepo: repo, execFileImpl }), /REPO_WRITE_VIOLATION/);
    assert.throws(() => publishPr({ ...options, repo: 'upstream/project', execFileImpl }), /REPO_WRITE_VIOLATION/);
    assert.throws(() => ensureLabels({ repo, installedRepo: repo, labels: ['lights-on:docs,lights-on:automerge'], execFileImpl }), /Unknown standard/);
    assert.equal(calls, 0);
  });

  it('covers all standard labels and preflights event, schedule, and PR workflows before agents', () => {
    const names = new Set(STANDARD_LABELS.map((label) => label.name));
    assert.equal(names.size, STANDARD_LABELS.length);
    for (const name of [...Object.values(LABELS), 'lights-on:dependencies', 'lights-on:security', 'lights-on:docs']) {
      assert.ok(names.has(name), `Missing definition: ${name}`);
    }
    for (const label of STANDARD_LABELS) assert.match(label.color, /^[a-f0-9]{6}$/i);
    for (const filename of ['lights-on-events.yml', 'lights-on-schedule.yml', 'lights-on-pr.yml']) {
      const workflow = readWorkflow(filename);
      const start = workflow.indexOf('- name: Ensure standard lights-on labels exist');
      const step = workflow.slice(start).split('\n      - ')[0];
      assert.ok(start > 0 && start < workflow.indexOf('uses: $/.github/actions/lights-on-agent'));
      assert.ok(step.includes("if: steps.config.outputs.enabled != 'false'"));
      assert.ok(step.includes('GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}'));
      assert.ok(step.includes('node .github/lights-on/runner/ensure-labels.mjs'));
      assert.ok(!step.includes('|| true'));
    }
    for (const installer of ['install.ps1', 'install.sh']) {
      const text = fs.readFileSync(path.join(root, installer), 'utf8');
      for (const label of names) assert.ok(text.includes(`"${label}"`), `${installer} omits ${label}`);
    }
  });

  it('executes the scheduled dependency publisher with missing labels and surfaces PR failures', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-publish-stage-'));
    try {
    fs.writeFileSync(path.join(dir, 'package.json'), '{"dependencies":{"demo":"1.1.0"}}');
    for (const failCreate of [false, true]) {
      const labels = new Set();
      const calls = [];
      const execFileImpl = (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'git') return args[0] === 'diff' ? 'package.json\0' : '';
        assert.equal(args[args.indexOf('--repo') + 1], repo);
        if (args[0] === 'label') { labels.add(args[2]); return ''; }
        if (args[1] === 'list') return '[]';
        assert.ok(labels.has('lights-on:dependencies'));
        if (failCreate) throw new Error('PR creation failed');
        return pr.url;
      };
      const run = () => publishDependencyStage({ repoRoot: dir, base: 'main',
        env: { GITHUB_REPOSITORY: repo }, execFileImpl,
        selection: { status: 'ready', task: 'dependency-updater', key: 'dependency:npm:package.json:demo',
          branch: pr.headRefName, dependency: { name: 'demo', manifest: 'package.json' } },
        result: { status: 'completed', summary: 'Updated demo', dependency_validation: {
          status: 'passed', key: 'dependency:npm:package.json:demo', checks: [{}],
          files: [{ path: 'package.json', sha256: dependencyFileHash(dir, 'package.json') }] } } });
      if (failCreate) assert.throws(run, /PR creation failed/);
      else assert.doesNotThrow(run);
      assert.ok(calls.some((call) => call[0] === 'git' && call[1] === 'push'));
      assert.ok(calls.some((call) => call[0] === 'gh' && call[1] === 'pr' && call[2] === 'create'));
    }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('does not report installer label failures as successful setup', { skip: process.platform !== 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-label-install-'));
    try {
      const script = `
        function git { $global:LASTEXITCODE = 0; 'https://github.com/steward/project.git' }
        function gh {
          if ($args[0] -eq 'label') { $global:LASTEXITCODE = 1 }
          elseif ($args[0] -eq 'api') { $global:LASTEXITCODE = 0; 'true' }
          else { $global:LASTEXITCODE = 0 }
        }
        & '${path.join(root, 'install.ps1').replace(/'/g, "''")}' -TargetDir '${dir.replace(/'/g, "''")}' -CreateLabels
      `;
      const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Failed to configure label/);
      assert.ok(!result.stdout.includes('Lights On installed successfully!'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
