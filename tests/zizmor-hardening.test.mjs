import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { pushGit } from '../.github/lights-on/runner/github-io.mjs';
import { COPILOT_CLI_VERSION, copilotInferenceSpec } from '../.github/lights-on/runner/provider-completion.mjs';
import { detectManifestsAndDeps } from '../.github/lights-on/runner/scan-dependencies.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8');
const workflows = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((name) => name.endsWith('.yml'))
  .map((name) => [name, read(`.github/workflows/${name}`)]);

test('every checkout drops credentials and every setup-node opts out of implicit caches', () => {
  let checkouts = 0, setups = 0;
  for (const [name, source] of [...workflows, ['action.yml', read('.github/actions/lights-on-agent/action.yml')]]) {
    for (const step of source.split(/(?=^\s*-\s+(?:name:|uses:))/m)) {
      if (step.includes('uses: actions/checkout@')) {
        checkouts++;
        assert.match(step, /persist-credentials: false/, name);
      }
      if (step.includes('uses: actions/setup-node@')) {
        setups++;
        assert.match(step, /package-manager-cache: false/, name);
      }
    }
  }
  assert.ok(checkouts >= 9);
  assert.ok(setups >= 9);
});

test('self references are commit-bound and scanner exceptions stay narrowly scoped', () => {
  const text = workflows.map(([, content]) => content).join('\n');
  assert.equal((text.match(/uses: \$\/\.github\/actions\/lights-on-agent/g) || []).length, 7);
  assert.doesNotMatch(text, /uses: \.\/\.github\/actions\/lights-on-agent/);
  assert.doesNotMatch(text, /^\s+git\s+push\b/m);
  assert.equal((text.match(/zizmor: ignore\[dangerous-triggers\]/g) || []).length, 3);
  assert.equal((text.match(/zizmor: ignore\[use-trusted-publishing\]/g) || []).length, 1);
  assert.doesNotMatch(text, /zizmor: ignore\[(?:artipacked|cache-poisoning|self-repository|adhoc-packages)/);
  assert.doesNotMatch(read('.github/actions/lights-on-agent/action.yml'), /\$GITHUB_ENV/);
  assert.ok(detectManifestsAndDeps(ROOT).githubActions.every((action) => !action.action.startsWith('$/')));
});

test('CLI tooling locks every runtime dependency without binding installations to a registry URL', () => {
  const manifest = JSON.parse(read('.github/lights-on/runner/copilot-cli.package.json'));
  const lock = JSON.parse(read('.github/lights-on/runner/copilot-cli.package-lock.json'));
  assert.equal(manifest.dependencies['@github/copilot'], COPILOT_CLI_VERSION);
  assert.equal(lock.packages['node_modules/@github/copilot'].version, COPILOT_CLI_VERSION);
  assert.ok(lock.packages['node_modules/detect-libc'].integrity);
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    assert.ok(entry.integrity, name);
    assert.equal(entry.resolved, undefined, name);
  }
  assert.match(read('.github/lights-on/runner/install-copilot-tools.mjs'), /'ci', '--ignore-scripts'/);
  for (const [, source] of workflows) assert.doesNotMatch(source, /npm install --global/);
});

test('prepared CLI selection is explicit, version-checked, and retains inference-only flags', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-cli-layout-'));
  try {
    const pkg = path.join(root, 'node_modules', '@github', 'copilot');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ version: COPILOT_CLI_VERSION, bin: { copilot: 'npm-loader.js' } }));
    const spec = copilotInferenceSpec(root, 'fixture', { LIGHTS_ON_COPILOT_CLI_DIR: root });
    assert.equal(spec.cmd, process.execPath);
    assert.equal(spec.args[0], path.join(pkg, 'npm-loader.js'));
    assert.ok(spec.args.includes('--available-tools=lights_on_no_builtin_tools'));
    fs.writeFileSync(path.join(pkg, 'package.json'), '{"version":"0.0.0"}');
    assert.throws(() => copilotInferenceSpec(root, 'fixture', { LIGHTS_ON_COPILOT_CLI_DIR: root }), /Prepared Copilot CLI/);
  } finally { fs.rmSync(root, { recursive: true }); }
});

test('Git publication is repository-bound, token-scoped and refuses broad or redirected pushes', () => {
  const env = { GITHUB_REPOSITORY: 'owner/repo', GH_TOKEN: 'synthetic-publication-token' };
  let invocation;
  const execute = (cmd, args, options) => {
    assert.equal(cmd, 'git');
    if (args[0] === 'remote') return 'https://github.com/owner/repo.git\n';
    invocation = { args, options };
    return '';
  };
  pushGit(['-u', 'origin', 'lights-on/fixture', '--force'], { env }, execute);
  assert.ok(invocation.args.includes('credential.helper=!gh auth git-credential'));
  assert.ok(invocation.args.includes('http.followRedirects=false'));
  assert.equal(invocation.options.env.GH_TOKEN, env.GH_TOKEN);
  assert.ok(!JSON.stringify(invocation.args).includes(env.GH_TOKEN));
  assert.ok(!invocation.args.includes('config'));
  pushGit(['origin', 'refs/tags/v1.0.0'], { env }, execute);
  for (const args of [['--mirror', 'origin'], ['origin', 'main'], ['origin', 'HEAD:main'],
    ['upstream', 'lights-on/fixture'], ['origin', 'refs/tags/v1.0.0', '--force']]) {
    assert.throws(() => pushGit(args, { env }, () => assert.fail('Invalid push reached Git')));
  }
  for (const url of ['https://github.com/other/repo.git\n', 'https://evil.invalid/owner/repo.git\n',
    'https://github.com/owner/repo.git\nhttps://github.com/other/repo.git\n']) {
    assert.throws(() => pushGit(['origin', 'lights-on/fixture'], { env }, () => url), /REPO_WRITE_VIOLATION/);
  }
  assert.throws(() => pushGit(['origin', 'lights-on/fixture'], { env: { GITHUB_REPOSITORY: 'owner/repo' } }), /requires a valid/);
});

test('actual Git credential helper obtains the step token without persisting it or contacting GitHub', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-git-auth-'));
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root,
    GH_CONFIG_DIR: root, GH_TOKEN: 'synthetic-step-token', GITHUB_REPOSITORY: 'owner/repo',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'global-config'),
    HTTPS_PROXY: 'http://127.0.0.1:9', HTTP_PROXY: 'http://127.0.0.1:9', NO_PROXY: '' };
  try {
    execFileSync('git', ['init', root], { env, stdio: 'pipe' });
    execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/owner/repo.git'], { cwd: root, env });
    const before = fs.readFileSync(path.join(root, '.git', 'config'), 'utf8');
    const credentials = pushGit(['origin', 'lights-on/fixture'], { cwd: root, env, encoding: 'utf8' },
      (cmd, args, options) => {
        if (args[0] === 'remote') return execFileSync(cmd, args, options);
        const index = args.indexOf('push');
        assert.ok(index > 0);
        return execFileSync(cmd, [...args.slice(0, index), 'credential', 'fill'], { ...options, stdio: 'pipe',
          input: 'protocol=https\nhost=github.com\npath=owner/repo.git\n\n', timeout: 15000 });
      });
    assert.match(credentials, /password=synthetic-step-token/);
    assert.equal(fs.readFileSync(path.join(root, '.git', 'config'), 'utf8'), before);
    assert.equal(fs.existsSync(path.join(root, '.git-credentials')), false);
    assert.equal(fs.existsSync(path.join(root, 'hosts.yml')), false);
  } finally { fs.rmSync(root, { recursive: true }); }
});
