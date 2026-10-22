import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windows = process.platform === 'win32';
const relative = (file) => file.split(path.sep).join('/');
function write(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}
function snapshot(root) {
  const files = {};
  const visit = (directory) => {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name), stat = fs.statSync(file);
      files[relative(path.relative(root, file))] = {
        directory: stat.isDirectory(), mode: stat.mode, modified: stat.mtimeMs,
        content: stat.isFile() ? fs.readFileSync(file).toString('hex') : null
      };
      if (stat.isDirectory()) visit(file);
    }
  };
  visit(root);
  return files;
}
function fixture({ empty = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-preview-'));
  const source = path.join(root, 'source with spaces'), target = path.join(root, 'target with spaces');
  fs.mkdirSync(source); fs.mkdirSync(target);
  const inputs = {
    '.github/lights-on.yml': 'enabled: true\n',
    '.github/actions/lights-on-agent/action.yml': 'new action\nnew caf\u00e9 \u03bb\u96ea\n',
    '.github/actions/lights-on-cache-access/action.yml': 'cache access action\n',
    '.github/actions/lights-on-cache-access/index.mjs': 'cache access probe\n',
    '.github/lights-on/runner/sample.mjs': 'new runner\n',
    '.github/lights-on/runner/inspector.py': 'new inspector\n',
    '.github/lights-on/runner/copilot-sdk.package.json': '{"private":true}\n',
    '.github/lights-on/runner/copilot-sdk.package-lock.json': '{"lockfileVersion":3}\n',
    '.github/lights-on/runner/copilot-cli.package.json': '{"private":true}\n',
    '.github/lights-on/runner/copilot-cli.package-lock.json': '{"lockfileVersion":3}\n',
    '.github/lights-on/prompts/sample.md': 'unchanged prompt\n',
    '.github/lights-on/ecosystems/detection.json': '{"new":true}\n'
  };
  for (const name of ['events', 'schedule', 'pr', 'release', 'setup']) inputs[`.github/workflows/lights-on-${name}.yml`] = `new ${name} workflow\n`;
  for (const [file, text] of Object.entries(inputs)) write(source, file, text);
  fs.copyFileSync(path.join(ROOT, 'install.sh'), path.join(source, 'install.sh'));
  if (!empty) {
    write(target, '.github/lights-on.yml', 'preserved_setting: keep\n');
    write(target, '.github/actions/lights-on-agent/action.yml', 'old action\nold caf\u00e9 \u03bb\u96ea\n');
    write(target, '.github/lights-on/runner/sample.mjs', 'old runner\n');
    write(target, '.github/lights-on/prompts/sample.md', 'unchanged prompt\n');
    write(target, '.github/lights-on/ecosystems/detection.json', '{"old":true}\n');
    write(target, '.github/workflows/lights-on-events.yml', 'old events workflow\n');
    write(target, 'unrelated.txt', 'keep this\n');
  }
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const marker = path.join(root, 'gh-called');
  const fakeGh = path.join(bin, windows ? 'gh.cmd' : 'gh');
  fs.writeFileSync(fakeGh, windows
    ? '@echo off\r\necho called>>"%LIGHTS_ON_TEST_GH_LOG%"\r\nexit /b 99\r\n'
    : '#!/bin/sh\nprintf called >> "$LIGHTS_ON_TEST_GH_LOG"\nexit 99\n');
  fs.chmodSync(fakeGh, 0o755);
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH,
    LIGHTS_ON_TEST_GH_LOG: marker, GIT_EXTERNAL_DIFF: fakeGh };
  const run = ({ dry = true, force = false, same = false, failDiff = false } = {}) => {
    if (failDiff) {
      const file = path.join(bin, windows ? 'git.cmd' : 'git');
      fs.writeFileSync(file, windows ? '@echo off\r\necho synthetic diff failure\r\nexit /b 128\r\n'
        : '#!/bin/sh\nprintf "synthetic diff failure\\n" >&2\nexit 128\n');
      fs.chmodSync(file, 0o755);
    }
    const destination = same ? source : target;
    const command = windows ? path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'sh';
    const args = windows
      ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'install.ps1'),
        '-SourceDir', source, '-TargetDir', destination, ...(dry ? ['-DryRun', '-CreateLabels'] : ['-SkipLabels']), ...(force ? ['-Force'] : [])]
      : [path.join(source, 'install.sh'), destination, ...(dry ? ['--dry-run', '--create-labels'] : ['--skip-labels']), ...(force ? ['--force'] : [])];
    const result = spawnSync(command, args, { cwd: source, encoding: 'utf8', timeout: 30000,
      env });
    return { ...result, stdout: (result.stdout || '').replace(/\r/g, ''), stderr: (result.stderr || '').replace(/\r/g, '') };
  };
  return { root, source, target, inputs, marker, env, run, cleanup: () => fs.rmSync(root, { recursive: true }) };
}

describe('Installer dry-run previews', () => {
  it('reports success to PowerShell callers that propagate LASTEXITCODE', { skip: !windows }, () => {
    const f = fixture();
    try {
      const quote = (value) => `'${value.replace(/'/g, "''")}'`;
      const before = snapshot(f.target);
      const result = spawnSync(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
          `& ${quote(path.join(ROOT, 'install.ps1'))} -SourceDir ${quote(f.source)} -TargetDir ${quote(f.target)} -DryRun -CreateLabels; exit $LASTEXITCODE`],
        { cwd: f.source, env: f.env, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(snapshot(f.target), before);
      assert.equal(fs.existsSync(f.marker), false);
    } finally { f.cleanup(); }
  });

  it('shows unified overwrite/addition diffs while leaving the target and GitHub untouched', () => {
    const f = fixture();
    try {
      const before = snapshot(f.target);
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(snapshot(f.target), before);
      assert.equal(fs.existsSync(f.marker), false, 'No gh/auth/label or external diff execution');
      assert.match(result.stdout, /^\-old action$/m);
      assert.match(result.stdout, /^\+new action$/m);
      assert.ok(result.stdout.includes('+new caf\u00e9 \u03bb\u96ea'));
      assert.match(result.stdout, /^\-old runner$/m);
      assert.match(result.stdout, /^\+new runner$/m);
      assert.match(result.stdout, /^\+new inspector$/m);
      assert.match(result.stdout, /^\-old events workflow$/m);
      assert.match(result.stdout, /^\+new events workflow$/m);
      assert.match(result.stdout, /\[unchanged\].*sample\.md/);
      assert.match(result.stdout, /\[skip\].*lights-on\.yml/);
      assert.doesNotMatch(result.stdout, /[+-]preserved_setting|[+]enabled: true|installed successfully/);
      assert.match(result.stdout, /Dry run complete/);
    } finally { f.cleanup(); }
  });

  it('includes the preserved configuration only when Force is supplied', () => {
    const f = fixture();
    try {
      const before = snapshot(f.target);
      const result = f.run({ force: true });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /^\-preserved_setting: keep$/m);
      assert.match(result.stdout, /^\+enabled: true$/m);
      assert.deepEqual(snapshot(f.target), before);
      assert.equal(fs.existsSync(f.marker), false);
    } finally { f.cleanup(); }
  });

  it('does not create directories during a first-install preview', () => {
    const f = fixture({ empty: true });
    try {
      const result = f.run();
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(snapshot(f.target), {});
      assert.equal((result.stdout.match(/\[create\]/g) || []).length, Object.keys(f.inputs).length);
      assert.equal(fs.existsSync(f.marker), false);
    } finally { f.cleanup(); }
  });

  it('previews the same content changes that a real installation applies', () => {
    const f = fixture();
    try {
      const before = snapshot(f.target);
      const preview = f.run();
      assert.equal(preview.status, 0, preview.stderr);
      const planned = [...preview.stdout.matchAll(/^\s*\[(?:create|overwrite)\] (.+)$/gm)]
        .map((match) => match[1].replace(/\\/g, '/')).sort();
      const installed = f.run({ dry: false });
      assert.equal(installed.status, 0, installed.stderr);
      const after = snapshot(f.target);
      const changed = Object.keys(after).filter((file) => !after[file].directory &&
        before[file]?.content !== after[file].content).sort();
      assert.deepEqual(changed, planned);
      assert.equal(fs.readFileSync(path.join(f.target, '.github', 'lights-on.yml'), 'utf8'), 'preserved_setting: keep\n');
      assert.equal(fs.readFileSync(path.join(f.target, 'unrelated.txt'), 'utf8'), 'keep this\n');
    } finally { f.cleanup(); }
  });

  it('reports an in-place preview as unchanged and treats diff errors as failures', () => {
    const f = fixture();
    try {
      const same = f.run({ same: true, force: true });
      assert.equal(same.status, 0, same.stderr);
      assert.doesNotMatch(same.stdout, /\[(?:create|overwrite)\]/);
      const before = snapshot(f.target);
      const failed = f.run({ failDiff: true });
      assert.notEqual(failed.status, 0);
      assert.match(failed.stdout + failed.stderr, /git diff exit 128/);
      assert.deepEqual(snapshot(f.target), before);
      assert.equal(fs.existsSync(f.marker), false);
    } finally { f.cleanup(); }
  });
});
