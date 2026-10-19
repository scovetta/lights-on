import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runGitHub, githubEnvironment, prepareGitHubArgs } from '../.github/lights-on/runner/github-io.mjs';
import { literalPublicationBody, plainPublicationText } from '../.github/lights-on/runner/publication-text.mjs';
import { buildLocalUpstreamTrackingIssue, parseGitHubRepoFromRemoteUrl } from '../.github/lights-on/runner/sync-upstream.mjs';
import { publishPr } from '../.github/lights-on/runner/publish-pr.mjs';
import { prepareRelease } from '../.github/lights-on/runner/prepare-release.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { GITHUB_REPOSITORY: 'fork/project', GH_HOST: 'enterprise.invalid', GH_REPO: 'upstream/project',
  GITHUB_SERVER_URL: 'https://github.com' };
const payloads = [
  '[upstream issue](https://github&#46;com/upstream/project/issues/42)',
  '[ref][target]\n\n[target]: https://github.com/upstream/project/issues/42',
  '<a href="https://github.com/upstream/project/issues/42">upstream</a>',
  'https://github.com/upstream/project/issues/42\nupstream/project#42\nupstream/project@deadbeef',
  '```\n[breakout](https://github.com/upstream/project/issues/42)\n````\n~~~\n@somebody',
  '[escaped](https://github\\.com/upstream/project/issues/42)',
  '&#x68;ttps://github.com/upstream/project/issues/42'
];

describe('External repository publication boundary', () => {
  it('binds repository commands and API calls to github.com despite conflicting host defaults', () => {
    const calls = [];
    const execute = (cmd, args, options) => { calls.push({ cmd, args, options }); return ''; };
    runGitHub(['label', 'create', 'lights-on:docs', '--repo', 'fork/project', '--force'], { env }, execute);
    assert.equal(calls[0].args[calls[0].args.indexOf('--repo') + 1], 'github.com/fork/project');
    assert.equal(calls[0].options.env.GH_HOST, 'github.com');
    assert.equal(calls[0].options.env.GH_REPO, undefined);
    runGitHub(['api', 'repos/fork/project/pulls/1'], { env }, execute);
    assert.deepEqual(calls[1].args.slice(-2), ['--hostname', 'github.com']);
    assert.throws(() => githubEnvironment({ ...env, GITHUB_SERVER_URL: 'https://enterprise.invalid' }), /Only github.com/);
    assert.equal(githubEnvironment({ ...env, GH_ENTERPRISE_TOKEN: 'secret' }).GH_ENTERPRISE_TOKEN, undefined);
  });

  it('rejects mismatched hosts, repositories and positional item URLs before invoking gh', () => {
    for (const args of [
      ['pr', 'create', '--repo', 'upstream/project'],
      ['pr', 'create', '--repo', 'enterprise.invalid/fork/project'],
      ['pr', 'review', 'https://github.com/upstream/project/pull/1', '--repo', 'fork/project', '--comment'],
      ['api', 'repos/upstream/project/issues'],
      ['api', 'https://api.github.com/repos/fork/project/issues'],
      ['api', 'repos/fork/project/issues', '--hostname', 'enterprise.invalid'],
      ['api', 'repos/fork/project/issues', '-f', 'body=upstream/project#42'],
      ['label', 'create', 'test', '--repo', 'fork/project', '--repo', 'upstream/project']
    ]) assert.throws(() => runGitHub(args, { env }, () => assert.fail('Unexpected command')), /REPO_WRITE_VIOLATION/);
  });

  it('uses literal content with an unbreakable fence for encoded, HTML and reference links', () => {
    for (const raw of payloads) {
      const result = literalPublicationBody(raw);
      const match = result.match(/^(`{3,})text\n([\s\S]*)\n\1$/);
      assert.ok(match);
      assert.equal(match[2], raw);
      assert.ok(!(raw.match(/`+/g) || []).some((run) => run.length >= match[1].length));
      assert.equal(literalPublicationBody(result), result, 'Safe rendering is idempotent.');
    }
    assert.throws(() => literalPublicationBody('x'.repeat(70000)), /too large/);
    const issue = buildLocalUpstreamTrackingIssue({ number: 42, title: 'Issue', body: payloads[0] },
      { upstreamRepo: 'upstream/project', installedRepo: 'fork/project' });
    assert.ok(issue.body.includes(literalPublicationBody(payloads[0])));
  });

  it('renders bodyFile content at publication without changing the input file and cleans temporary files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-external-body-'));
    try {
      const file = path.join(dir, 'body.md');
      fs.writeFileSync(file, payloads[0]);
      let actualFile;
      runGitHub(['issue', 'comment', '42', '--repo', 'fork/project', '--body-file', file], { env }, (_cmd, args) => {
        actualFile = args[args.indexOf('--body-file') + 1];
        assert.notEqual(actualFile, file);
        assert.equal(fs.readFileSync(actualFile, 'utf8'), literalPublicationBody(payloads[0]));
        return '';
      });
      assert.equal(fs.existsSync(actualFile), false);
      assert.equal(fs.readFileSync(file, 'utf8'), payloads[0]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('sanitizes generated release PR bodies even when the caller supplies raw commit references', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-release-refs-'));
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"example","version":"1.0.0"}');
      const release = prepareRelease({ repoRoot: dir, dryRun: true, tags: ['v1.0.0'],
        commits: ['fix: address upstream/project#42'] });
      const result = publishPr({ repo: 'fork/project', installedRepo: 'fork/project', head: release.branchName,
        base: 'main', title: release.prTitle, body: release.prBody, env: {},
        execFileImpl: (_cmd, args) => {
          if (args[0] === 'label') return '';
          if (args[1] === 'list') return '[]';
          assert.equal(args[args.indexOf('--body') + 1], literalPublicationBody(release.prBody));
          return 'https://github.com/fork/project/pull/1';
        } });
      assert.equal(result.created, true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('breaks references in plain-text titles/commit messages and preserves explicit local issue closing', () => {
    const title = plainPublicationText('fix: upstream/project#42 https://github.com/upstream/project/issues/42 @user &#47;');
    assert.match(title, /^fix:/);
    assert.ok(!/[#@&]/.test(title));
    assert.ok(!title.includes('upstream/project'));
    assert.ok(!title.includes('https://'));
    runGitHub(['pr', 'create', '--repo', 'fork/project', '--title', 'fix: upstream/project#42',
      '--body', 'upstream/project#42'], { env, lightsOnClosesIssue: 17 }, (_cmd, args) => {
      assert.equal(args[args.indexOf('--body') + 1], `${literalPublicationBody('upstream/project#42')}\n\nCloses #17`);
      assert.equal(args[args.indexOf('--title') + 1], plainPublicationText('fix: upstream/project#42'));
      return '';
    });
    const merge = prepareGitHubArgs(['pr', 'merge', '17', '--repo', 'fork/project', '--squash'], env);
    assert.ok(merge.includes('--subject'));
    assert.ok(merge.includes('--body'));
    assert.throws(() => prepareGitHubArgs(['release', 'create', 'v1.0.0', '--repo', 'fork/project', '--generate-notes'], env), /separately/);
    assert.throws(() => prepareGitHubArgs(['pr', 'merge', '17', '--repo', 'fork/project', '--rebase'], env), /Rebase merging/);
  });

  it('rejects deceptive origin hosts and binds the actual PowerShell installer commands', { skip: process.platform !== 'win32' }, () => {
    assert.equal(parseGitHubRepoFromRemoteUrl('https://evilgithub.com/fork/project.git'), null);
    assert.equal(parseGitHubRepoFromRemoteUrl('https://github.com/fork/project.git'), 'fork/project');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-host-installer-'));
    try {
      const log = path.join(dir, 'calls.jsonl');
      const script = `
        $env:GH_HOST = 'enterprise.invalid'
        function git { $global:LASTEXITCODE = 0; 'https://github.com/fork/project.git' }
        function gh {
          ConvertTo-Json -Compress -InputObject @($args) | Add-Content -LiteralPath '${log.replace(/'/g, "''")}'
          $global:LASTEXITCODE = 0
          if ($args[0] -eq 'api') { 'true' }
        }
        & '${path.join(root, 'install.ps1').replace(/'/g, "''")}' -TargetDir '${dir.replace(/'/g, "''")}' -CreateLabels
      `;
      const result = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const calls = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
      for (const args of calls) {
        if (args[0] === 'label') assert.equal(args[args.indexOf('--repo') + 1], 'github.com/fork/project');
        else assert.equal(args[args.indexOf('--hostname') + 1], 'github.com');
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('binds the actual POSIX installer to the inspected GitHub.com origin', { skip: process.platform === 'win32' }, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-posix-host-'));
    try {
      const bin = path.join(dir, 'bin');
      const target = path.join(dir, 'target');
      const log = path.join(dir, 'calls.log');
      fs.mkdirSync(bin); fs.mkdirSync(target);
      fs.writeFileSync(path.join(bin, 'git'), '#!/bin/sh\nif [ "$1" = "remote" ]; then echo https://github.com/fork/project.git; fi\n', { mode: 0o755 });
      fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$CALL_LOG"\nif [ "$1" = "api" ]; then echo true; fi\n', { mode: 0o755 });
      const installer = path.join(dir, 'install.sh');
      fs.writeFileSync(installer, fs.readFileSync(path.join(root, 'install.sh'), 'utf8').replace(/\r\n/g, '\n'));
      const result = spawnSync('sh', [installer, target, '--create-labels'], {
        cwd: root, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GH_HOST: 'enterprise.invalid', CALL_LOG: log }
      });
      assert.equal(result.status, 0, result.stderr);
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
      for (const call of calls) {
        if (call.startsWith('label ')) assert.ok(call.includes('--repo github.com/fork/project'));
        else assert.ok(call.includes('--hostname github.com'));
      }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });

  it('routes every workflow GitHub mutation through the host/body boundary', () => {
    for (const filename of fs.readdirSync(path.join(root, '.github', 'workflows')).filter((name) => /^lights-on-.*\.yml$/.test(name))) {
      const text = fs.readFileSync(path.join(root, '.github', 'workflows', filename), 'utf8');
      assert.doesNotMatch(text, /^\s*gh\s+(?:pr|issue|label|release)\b/m, filename);
      if (text.includes("execFileSync('gh'")) {
        assert.ok(text.includes("from './.github/lights-on/runner/github-io.mjs'"), filename);
        assert.ok(!text.includes("from 'node:child_process'"), filename);
      }
    }
  });
});
