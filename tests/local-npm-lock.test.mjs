import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { resolutionManifest, resolveLock } from '../local/demos/npm/resolve-lock.mjs';
import { setup, prepareCache } from '../local/demos/npm/setup.mjs';
import { runDemo } from '../local/demos/npm/run.mjs';
import { lockedPackages } from '../local/demos/npm/common.mjs';
import { NODE_IMAGE, hash } from '../local/policy.mjs';
import { Runtime, CODE, docker, mount, privateDirectory } from '../local/runtime.mjs';

const registry = 'https://packagefeedproxy.microsoft.io/npm/';
const manifest = { name: 'demo', version: '1.0.0', scripts: { test: 'node test.js', prepare: 'exit 9' },
  dependencies: { 'fixture-lock-dep': '^1.0.0' }, config: { ignored: 'not a resolver input' } };
const emptyLock = { lockfileVersion: 3, packages: { '': { name: 'demo', version: '1.0.0' } } };

test('lock resolution accepts inert registry requirements and refuses alternate resolution semantics', () => {
  assert.deepEqual(resolutionManifest(manifest), {
    name: 'demo', version: '1.0.0', dependencies: manifest.dependencies
  });
  for (const spec of ['git+https://example.org/repo', 'file:../other', 'owner/repo', 'npm:other@1', 'https://example.org/a.tgz']) {
    assert.throws(() => resolutionManifest({ ...manifest, dependencies: { demo: spec } }), /registry version/);
  }
  for (const change of [{ workspaces: ['packages/*'] }, { overrides: { demo: '2' } }, { resolutions: {} },
    { bundledDependencies: ['demo'] }, { packageManager: 'yarn@4' }]) {
    assert.throws(() => resolutionManifest({ ...manifest, ...change }));
  }
});

test('lock resolution uses a credential-free preparation gateway and retains diagnostics on failure', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lock-policy-'));
  try {
    let settings, disposed = false;
    const createRuntime = (value) => {
      settings = value;
      assert.deepEqual(value.secrets, {});
      assert.deepEqual(value.capabilities, []);
      assert.deepEqual(value.policy.rules, [{
        id: 'npm-metadata', host: 'packagefeedproxy.microsoft.io', path: '/npm/', methods: ['GET'], roles: ['prepare']
      }]);
      const prepared = JSON.parse(fs.readFileSync(path.join(value.work, 'package.json')));
      assert.equal(prepared.scripts, undefined);
      return {
        preflight() {},
        async role(role, script) {
          assert.equal(role, 'prepare');
          assert.equal(script, 'prepare-npm-lock');
          fs.writeFileSync(path.join(value.work, 'npm-lock.log'), 'synthetic resolution failure');
          throw new Error('resolution failed');
        },
        dispose() { disposed = true; }
      };
    };
    await assert.rejects(resolveLock(manifest, { repo: 'owner/repo', registry, directory: root }, root, { createRuntime }), /resolution failed/);
    assert.ok(settings && disposed);
    assert.equal(fs.readFileSync(path.join(root, 'dependency-resolution.log'), 'utf8'), 'synthetic resolution failure');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generated lock inputs are bound to the manifest and do not turn into source files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lock-image-'));
  try {
    const digest = hash(JSON.stringify(manifest));
    const prepared = prepareCache([], root, registry, () => assert.fail('empty cache needs no downloads'),
      { generatedLock: emptyLock, manifestDigest: digest });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(prepared.context, 'inputs', 'package-lock.json'))), emptyLock);
    assert.equal(fs.readFileSync(path.join(prepared.context, 'inputs', 'manifest.sha256'), 'utf8'), digest);
    assert.ok(!fs.existsSync(path.join(root, 'package-lock.json')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('only generated locks can verify legacy registry hashes and replace them with cache-compatible SHA-512 pins', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lock-legacy-'));
  try {
    const pkg = { name: 'demo', scripts: { test: 'node test.js' } };
    const legacy = `sha1-${crypto.createHash('sha1').update('archive').digest('base64')}`;
    const lock = { lockfileVersion: 3, packages: {
      '': { name: 'demo' }, 'node_modules/dep': { version: '1.0.0', integrity: legacy }
    } };
    assert.throws(() => lockedPackages(pkg, lock));
    const entries = lockedPackages(pkg, lock, { generated: true });
    const npm = (args) => {
      if (args[0] !== 'pack') return '';
      fs.writeFileSync(path.join(args[args.indexOf('--pack-destination') + 1], 'dep.tgz'), 'archive');
      return JSON.stringify([{ name: 'dep', version: '1.0.0', filename: 'dep.tgz' }]);
    };
    const prepared = prepareCache(entries, root, registry, npm, { generatedLock: lock, manifestDigest: hash(JSON.stringify(pkg)) });
    const expected = `sha512-${crypto.createHash('sha512').update('archive').digest('base64')}`;
    assert.equal(lock.packages['node_modules/dep'].integrity, expected);
    assert.equal(lock.packages['node_modules/dep'].resolved,
      `file:/opt/lights-on-npm-inputs/archives/${hash('archive')}.tgz`);
    assert.equal(fs.readFileSync(path.join(prepared.context, 'inputs', 'archives', `${hash('archive')}.tgz`), 'utf8'), 'archive');
    assert.equal(JSON.parse(fs.readFileSync(path.join(prepared.context, 'inputs', 'package-lock.json')))
      .packages['node_modules/dep'].integrity, expected);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('setup supports a missing lock without altering the fetched repository', { skip: process.platform !== 'linux' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lock-setup-'));
  const directory = path.join(root, 'demo');
  const pkg = { name: 'demo', version: '1.0.0', scripts: { test: 'node test.js' } };
  let source;
  try {
    const run = async (request) => {
      if (request.command === 'prepare') return {};
      const snapshot = path.join(request.output, 'fixture');
      source = path.join(snapshot, 'source');
      fs.mkdirSync(source, { recursive: true });
      fs.writeFileSync(path.join(source, 'package.json'), JSON.stringify(pkg));
      fs.writeFileSync(path.join(snapshot, 'result.json'), '{"status":"completed"}');
      return { id: 'fixture', sourceSha: 'a'.repeat(40) };
    };
    const resolve = async (input) => { assert.deepEqual(input, pkg); return emptyLock; };
    const engine = (args) => {
      assert.ok(fs.existsSync(path.join(args.at(-1), 'inputs', 'package-lock.json')));
      fs.writeFileSync(args[args.indexOf('--iidfile') + 1], `sha256:${'b'.repeat(64)}`);
    };
    await setup({ directory, repo: 'owner/repo', provider: 'codex', registry }, { run, resolve, engine });
    const demo = JSON.parse(fs.readFileSync(path.join(directory, 'demo.json')));
    assert.equal(demo.lockfile.source, 'generated');
    assert.equal(demo.lockfile.manifestSha256, hash(JSON.stringify(pkg)));
    assert.ok(!fs.existsSync(path.join(source, 'package-lock.json')));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'dependency-lock.json'))), emptyLock);
    await assert.rejects(runDemo({ directory, task: 'scan' }, {
      run: () => assert.fail('A synthetic validation lock must not masquerade as a repository scan input')
    }), /committed npm lockfile/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the actual npm resolver uses registry metadata without scripts, tarball downloads or package installs', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_LOCAL_DOCKER !== 'true', timeout: 120000
}, async () => {
  const root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lock-tls-')));
  const fixture = privateDirectory(path.join(root, 'fixture'));
  const network = `lights-on-lock-${crypto.randomUUID()}`, server = `lights-on-lock-${crypto.randomUUID()}`;
  try {
    docker(['network', 'create', '--internal', '--subnet', '11.254.235.0/24', network]);
    docker(['run', '-d', '--name', server, '--pull=never', '--network', network, '--ip', '11.254.235.3',
      '--user', `${process.getuid()}:${process.getgid()}`, '--network-alias', 'packagefeedproxy.microsoft.io',
      ...mount(CODE, '/code', true), ...mount(fixture, '/fixture'),
      '--entrypoint', 'node', NODE_IMAGE, '/code/local/testing/tls-fixture.mjs']);
    for (let attempt = 0; attempt < 100 && !fs.existsSync(path.join(fixture, 'ready')); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(path.join(fixture, 'ready')));
    class FixtureRuntime extends Runtime {
      constructor(settings) { super({ ...settings, policy: { ...settings.policy, upstreamCaFile: path.join(fixture, 'ca.pem') } }); }
      async gateway(role) {
        const existing = this.gateways.has(role);
        const value = await super.gateway(role);
        if (!existing) docker(['network', 'connect', network, value.name]);
        return value;
      }
    }
    const lock = await resolveLock(manifest, { repo: 'owner/repo', registry, directory: root }, root,
      { createRuntime: (settings) => new FixtureRuntime(settings) });
    assert.equal(lock.lockfileVersion, 3);
    assert.equal(lock.packages['node_modules/fixture-lock-dep'].version, '1.0.0');
    assert.ok(!fs.existsSync(path.join(root, 'lock-resolution', 'node_modules')));
    assert.ok(!fs.existsSync(path.join(fixture, 'tarball-requested')));
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'npm-connection.json'))), 'close');
    assert.ok(!fs.existsSync(path.join(fixture, 'mutations.json')));
    const audit = fs.readFileSync(path.join(root, 'dependency-resolution-network.jsonl'), 'utf8');
    assert.match(audit, /"rule": "npm-metadata"/);
    assert.doesNotMatch(audit, /"outcome": "denied"/);
  } finally {
    docker(['rm', '--force', server], { allowFailure: true });
    docker(['network', 'rm', network], { allowFailure: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
