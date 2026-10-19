import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { archive, artifactManifest } from './package-fixtures.mjs';
import { validateReleaseArtifacts, uploadReleaseArtifacts } from '../.github/lights-on/runner/release-artifacts.mjs';
import { executeToolCall, resolveSafePath } from '../.github/lights-on/runner/openrouter-agent.mjs';

const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-review-fix-'));
const metadata = '--- !ruby/object:Gem::Specification\nname: demo\nversion: !ruby/object:Gem::Version\n  version: 1.0.0\n';

describe('Artifact-controlled npm configuration', () => {
  it('blocks transport, authentication and other unapproved publishConfig fields before credentialed execution', async () => {
    const root = temp(), directory = path.join(root, 'artifacts');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo","version":"1.0.0"}');
    try {
      const malicious = [
        { 'https-proxy': 'http://proxy.attacker.invalid:8080', 'strict-ssl': false },
        { proxy: 'http://proxy.attacker.invalid:8080' }, { 'strict-ssl': false },
        { ca: 'untrusted CA' }, { cafile: '/some/file' }, { userconfig: '/some/file' },
        { '//registry.npmjs.org/:_authToken': 'substituted-token' }, { '@demo:registry': 'https://attacker.invalid' },
        { 'ignore-scripts': false }, { provenance: true }, { registry: 'https://attacker.invalid' },
        null, [], 'not-an-object'
      ];
      for (const publishConfig of malicious) {
        archive(path.join(directory, 'demo.tgz'), 'tar', [['package/package.json',
          JSON.stringify({ name: 'demo', version: '1.0.0', publishConfig })]]);
        artifactManifest(directory, 'npm', '1.0.0', ['demo.tgz']);
        await assert.rejects(uploadReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm',
          env: { REGISTRY_TOKEN: 'must-not-reach-a-process' },
          execFileImpl: () => assert.fail('Invalid artifact reached npm'),
          fetchImpl: () => assert.fail('Invalid artifact made a network request') }), /identity verification failed/);
      }
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  it('preserves supported publish metadata and pins TLS verification in the uploader', async () => {
    const root = temp(), directory = path.join(root, 'artifacts');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo","version":"1.0.0"}');
    try {
      archive(path.join(directory, 'demo.tgz'), 'tar', [['package/package.json', JSON.stringify({
        name: 'demo', version: '1.0.0', publishConfig: { registry: 'https://registry.npmjs.org/', access: 'public', tag: 'next' }
      })]]);
      artifactManifest(directory, 'npm', '1.0.0', ['demo.tgz']);
      let calls = 0;
      await uploadReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm',
        env: { REGISTRY_TOKEN: 'synthetic-token' }, execFileImpl: (cmd, args) => {
          calls++;
          assert.equal(cmd, 'npm');
          assert.ok(args.includes('--ignore-scripts'));
          assert.ok(args.includes('--strict-ssl=true'));
          assert.equal(args[args.indexOf('--registry') + 1], 'https://registry.npmjs.org');
        } });
      assert.equal(calls, 1);
    } finally { fs.rmSync(root, { recursive: true }); }
  });
});

describe('RubyGems identity uses syntax trees, not regex matches', () => {
  it('rejects duplicate effective keys, symbols, aliases, multiple documents and executable tags', () => {
    const root = temp(), directory = path.join(root, 'artifacts');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(root, 'demo.gemspec'), 'Gem::Specification.new do |s|\n s.name = "demo"\n s.version = "1.0.0"\nend\n');
    try {
      const variants = [
        metadata + 'name : victim\n',
        metadata + '"name": victim\n',
        metadata + '"na\\u006de": victim\n',
        metadata + ':name: victim\n',
        metadata + '!ruby/symbol name: victim\n',
        metadata.replace('  version: 1.0.0', '  version: 1.0.0\n  version : 2.0.0'),
        metadata + 'extra: &item demo\nname: *item\n',
        metadata + '<<: {name: victim}\n',
        metadata + '--- !ruby/object:Gem::Specification\nname: victim\n',
        metadata + 'extra: !ruby/object:UntrustedObject {}\n'
      ];
      for (const text of variants) {
        archive(path.join(directory, 'demo.gem'), 'gem', [['metadata.gz', text]]);
        artifactManifest(directory, 'rubygems', '1.0.0', ['demo.gem']);
        assert.throws(() => validateReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'rubygems' }),
          /identity verification failed/);
      }
      for (const text of [metadata, metadata.replace('name: demo', '"name" : "demo"')]) {
        archive(path.join(directory, 'demo.gem'), 'gem', [['metadata.gz', text]]);
        artifactManifest(directory, 'rubygems', '1.0.0', ['demo.gem']);
        assert.equal(validateReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'rubygems' }).length, 1);
      }
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  it('rejects the exact archive that the actual RubyGems reader interprets as a different package', async () => {
    const root = temp(), directory = path.join(root, 'artifacts');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(root, 'demo.gemspec'), 'Gem::Specification.new do |s|\n s.name = "demo"\n s.version = "1.0.0"\nend\n');
    try {
      const file = path.join(directory, 'demo.gem');
      archive(file, 'gem', [['metadata.gz', metadata + 'name : victim\n']]);
      artifactManifest(directory, 'rubygems', '1.0.0', ['demo.gem']);
      const actual = spawnSync('ruby', ['--disable=gems', '-rrubygems', '-rrubygems/package', '-rjson', '-e',
        'spec = Gem::Package.new(ARGV.fetch(0)).spec; puts JSON.generate([spec.name, spec.version.to_s])', file],
      { encoding: 'utf8', timeout: 15000, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: root, USERPROFILE: root } });
      assert.equal(actual.status, 0, actual.stderr);
      assert.deepEqual(JSON.parse(actual.stdout), ['victim', '1.0.0']);
      await assert.rejects(uploadReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'rubygems',
        env: { REGISTRY_TOKEN: 'broad-synthetic-token' },
        execFileImpl: () => assert.fail('Substituted gem reached credentialed uploader') }), /identity verification failed/);
    } finally { fs.rmSync(root, { recursive: true }); }
  });
});

describe('Controller filesystem writes reject links before any side effect', () => {
  function link(t, destination, name, type) {
    try { fs.symlinkSync(destination, name, type); return true; }
    catch (err) {
      if (process.platform === 'win32' && err.code === 'EPERM') { t.skip('Creating this symlink requires Windows developer privileges.'); return false; }
      throw err;
    }
  }

  it('does not follow a dangling file symlink to create a host configuration file', (t) => {
    const root = temp(), workspace = path.join(root, 'workspace'), outside = path.join(root, '.npmrc');
    fs.mkdirSync(workspace);
    try {
      if (!link(t, outside, path.join(workspace, 'notes.txt'), 'file')) return;
      const changes = new Set();
      const result = executeToolCall('write_file', { path: 'notes.txt', content: 'registry=https://attacker.invalid' },
        { workingDir: workspace, env: {}, filesChanged: changes });
      assert.equal(result.ok, false);
      assert.match(result.error, /Symlink/);
      assert.equal(fs.existsSync(outside), false);
      assert.equal(changes.size, 0);
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  it('rejects dangling directory links and existing links for reads, writes and edits', (t) => {
    const root = temp(), workspace = path.join(root, 'workspace'), outside = path.join(root, 'outside');
    fs.mkdirSync(workspace);
    try {
      if (!link(t, outside, path.join(workspace, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')) return;
      const created = executeToolCall('write_file', { path: 'linked/nested/file', content: 'bad' }, { workingDir: workspace, env: {} });
      assert.equal(created.ok, false);
      assert.equal(fs.existsSync(outside), false);
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, 'secret'), 'unchanged');
      for (const tool of ['read_file', 'write_file', 'edit_file']) {
        const result = executeToolCall(tool, { path: 'linked/secret', content: 'bad', old_str: 'unchanged', new_str: 'bad' },
          { workingDir: workspace, env: {} });
        assert.equal(result.ok, false);
        assert.match(result.error, /Symlink/);
      }
      assert.equal(fs.readFileSync(path.join(outside, 'secret'), 'utf8'), 'unchanged');
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  it('fails closed on filesystem errors and preserves normal atomic writes and executable modes', (t) => {
    const root = temp();
    try {
      const original = fs.lstatSync;
      t.mock.method(fs, 'lstatSync', (file, options) => {
        if (file === path.join(root, 'unreadable')) throw Object.assign(new Error('Access denied'), { code: 'EACCES' });
        return original(file, options);
      });
      assert.throws(() => resolveSafePath('unreadable/file', root), /Access denied/);
      const created = executeToolCall('write_file', { path: 'nested/script', content: 'OLD' }, { workingDir: root, env: {} });
      assert.equal(created.ok, true);
      const file = path.join(root, 'nested', 'script');
      fs.chmodSync(file, 0o755);
      assert.equal(executeToolCall('edit_file', { path: 'nested/script', old_str: 'OLD', new_str: 'new $& value' },
        { workingDir: root, env: {} }).ok, true);
      assert.equal(fs.readFileSync(file, 'utf8'), 'new $& value');
      if (process.platform !== 'win32') assert.equal(fs.statSync(file).mode & 0o777, 0o755);
      assert.deepEqual(fs.readdirSync(path.dirname(file)), ['script']);
    } finally { fs.rmSync(root, { recursive: true }); }
  });

  it('atomic replacement cannot follow a final link inserted after path validation', {
    skip: process.platform === 'win32'
  }, (t) => {
    const root = temp(), workspace = path.join(root, 'workspace'), outside = path.join(root, 'host-file');
    fs.mkdirSync(workspace);
    try {
      const destination = path.join(workspace, 'document');
      const rename = fs.renameSync;
      t.mock.method(fs, 'renameSync', (source, target) => {
        if (target === destination) fs.symlinkSync(outside, target);
        return rename(source, target);
      });
      const result = executeToolCall('write_file', { path: 'document', content: 'safe replacement' },
        { workingDir: workspace, env: {} });
      assert.equal(result.ok, true);
      assert.equal(fs.existsSync(outside), false);
      assert.equal(fs.lstatSync(destination).isSymbolicLink(), false);
      assert.equal(fs.readFileSync(destination, 'utf8'), 'safe replacement');
      assert.deepEqual(fs.readdirSync(workspace), ['document']);
    } finally { fs.rmSync(root, { recursive: true }); }
  });
});
