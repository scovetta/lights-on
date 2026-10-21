import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseOptions, registryUrl, demoPolicy, lockedPackages, checkArchive, runOutcome, TEST_COMMAND } from '../local/demos/npm/common.mjs';
import { setup, prepareCache, prepareController, npmCommand } from '../local/demos/npm/setup.mjs';
import { runDemo } from '../local/demos/npm/run.mjs';
import { digestObject, NODE_IMAGE } from '../local/policy.mjs';
import { Runtime, CODE, docker, mount, privateDirectory } from '../local/runtime.mjs';
import { validateCandidate } from '../local/validation.mjs';
import { main } from '../local/lights-on.mjs';

const registry = 'https://proxy.example.org/npm/';
const options = { repo: 'owner/example', provider: 'codex', registry };
const manifest = { name: 'app', scripts: { test: 'node test.cjs' } };
const integrity = (data) => `sha512-${crypto.createHash('sha512').update(data).digest('base64')}`;
const entry = () => ({ version: '1.0.0', resolved: 'https://registry.npmjs.org/demo/-/demo-1.0.0.tgz', integrity: integrity('archive') });
const lock = () => ({ lockfileVersion: 3, packages: { '': { name: 'app' }, 'node_modules/demo': entry() } });

test('npm demo CLI requires an explicit target, refuses writes, and makes inference opt-in', () => {
  assert.throws(() => parseOptions(['--directory', 'out'], 'setup'), /Repository/);
  assert.throws(() => parseOptions(['--directory', 'out', '--repo', 'SCOVETTA/LIGHTS-ON'], 'setup'), /source repository/);
  assert.throws(() => parseOptions(['--directory', 'out', '--publish'], 'run'), /Unknown/);
  assert.throws(() => parseOptions(['--directory', 'out', '--task', 'docs-clarifier'], 'run'), /charges/);
  assert.equal(parseOptions(['--directory', 'out', '--repo', 'owner/repo', '--provider', 'copilot'], 'setup').provider, 'copilot');
  assert.throws(() => parseOptions(['--directory', 'out', '--repo', 'owner/repo', '--provider', 'copilot',
    '--controller-image', 'copilot:latest'], 'setup'), /immutable/);
  assert.equal(parseOptions(['--directory', 'out', '--task', 'docs-clarifier', '--allow-inference'], 'run').task, 'docs-clarifier');
  assert.equal(registryUrl(registry), registry);
  for (const value of ['http://proxy.example.org', 'https://user:token@example.org', 'https://example.org/?token=x',
    'https://example.org/?', 'https://example.org/#']) {
    assert.throws(() => registryUrl(value), /HTTPS/);
  }
});

test('Copilot setup builds trusted locked tooling through the selected registry and preserves image overrides', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-controller-'));
  try {
    const id = `sha256:${'b'.repeat(64)}`;
    let builds = 0;
    const engine = (args, limits) => {
      builds++;
      assert.equal(args[0], 'build');
      assert.ok(args.includes(`NPM_REGISTRY=${registry}`));
      assert.equal(limits.timeout, 600000);
      const context = args.at(-1);
      assert.deepEqual(fs.readdirSync(context).sort(), ['controller.Dockerfile', 'package-lock.json', 'package.json']);
      for (const name of fs.readdirSync(context)) {
        assert.deepEqual(fs.readFileSync(path.join(context, name)), fs.readFileSync(path.join(CODE, 'local', 'containers', name)));
      }
      assert.doesNotMatch(args.join(' '), /TOKEN|PASSWORD|SECRET|API_KEY/);
      fs.writeFileSync(args[args.indexOf('--iidfile') + 1], id);
    };
    assert.equal(prepareController({ ...options, provider: 'copilot' }, root, engine), id);
    assert.equal(builds, 1);
    assert.equal(prepareController({ ...options, provider: 'copilot', 'controller-image': NODE_IMAGE }, root, engine), NODE_IMAGE);
    assert.equal(prepareController(options, root, engine), NODE_IMAGE);
    assert.equal(builds, 1);
    assert.throws(() => prepareController({ ...options, provider: 'copilot' }, root, () => {
      throw new Error('controller build failed');
    }), /controller build failed/);
    assert.throws(() => prepareController({ ...options, provider: 'copilot' }, root, (args) => {
      fs.writeFileSync(args[args.indexOf('--iidfile') + 1], 'copilot:latest');
    }), /immutable/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Copilot setup records its automatic controller only in the inference policy', { skip: process.platform !== 'linux' }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-automatic-'));
  const directory = path.join(root, 'demo');
  const worker = `sha256:${'a'.repeat(64)}`, controller = `sha256:${'b'.repeat(64)}`;
  const sha = 'c'.repeat(40);
  try {
    const run = async (request) => {
      assert.deepEqual(request.capabilities, []);
      const policy = JSON.parse(fs.readFileSync(request.policy));
      assert.deepEqual(policy.credentials, {}, 'setup never requests a provider token');
      if (request.command === 'prepare') return {};
      const snapshot = path.join(request.output, 'fixture');
      fs.mkdirSync(path.join(snapshot, 'source'), { recursive: true });
      fs.writeFileSync(path.join(snapshot, 'result.json'), '{"status":"completed"}');
      fs.writeFileSync(path.join(snapshot, 'source', 'package.json'), JSON.stringify(manifest));
      fs.writeFileSync(path.join(snapshot, 'source', 'package-lock.json'), JSON.stringify({
        lockfileVersion: 3, packages: { '': { name: 'app' } }
      }));
      return { id: 'fixture', sourceSha: sha };
    };
    const engine = (args) => {
      const id = path.basename(args.at(-1)) === 'controller' ? controller : worker;
      fs.writeFileSync(args[args.indexOf('--iidfile') + 1], id);
    };
    await setup({ ...options, provider: 'copilot', directory }, { run, engine });
    const demo = JSON.parse(fs.readFileSync(path.join(directory, 'demo.json')));
    assert.equal(demo.controllerImage, controller);
    const read = JSON.parse(fs.readFileSync(path.join(directory, 'read-policy.json')));
    const agent = JSON.parse(fs.readFileSync(path.join(directory, 'agent-policy.json')));
    assert.equal(read.images.controller, NODE_IMAGE);
    assert.equal(agent.images.controller, controller);
    assert.equal(agent.images.worker, worker);
    assert.deepEqual(agent.capabilities, []);
    assert.equal(digestObject(agent), demo.policies.agent);
    assert.ok(!fs.existsSync(path.join(directory, 'preparation')));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('generated demo policies preserve the read-only boundary for every provider', () => {
  for (const provider of ['codex', 'claude', 'openrouter', 'copilot']) {
    const settings = { ...options, provider, 'controller-image': NODE_IMAGE, 'github-auth': true };
    for (const inference of [false, true]) {
      const policy = demoPolicy(settings, { inference });
      assert.deepEqual(policy.capabilities, []);
      assert.ok(policy.rules.every((rule) => !rule.roles.includes('publisher')));
      assert.equal(policy.profiles[0].commands[0], TEST_COMMAND);
      assert.ok(policy.rules.filter((rule) => rule.roles.includes('fetch') && rule.host === 'api.github.com')
        .every((rule) => rule.methods.join() === 'GET' && rule.path.startsWith('/repos/owner/example')));
      assert.equal(Object.keys(policy.credentials).length, inference ? 2 : 1);
    }
  }
  assert.deepEqual(demoPolicy(options).credentials, {});
  assert.deepEqual(demoPolicy(options, { validation: false }).profiles, []);
});

test('lockfile preparation accepts exact registry identities, not executable dependency sources', () => {
  assert.deepEqual(lockedPackages(manifest, lock()).map((item) => item.spec), ['demo@1.0.0']);
  assert.throws(() => lockedPackages({ ...manifest, workspaces: ['packages/*'] }, lock()), /workspaces/);
  assert.throws(() => lockedPackages({ scripts: {} }, lock()), /test script/);
  for (const change of [
    { link: true }, { inBundle: true }, { version: 'file:../escape' },
    { resolved: 'git+https://example.org/repo' }, { resolved: 'file:../escape' }, { integrity: 'sha1-aaaa' },
    { integrity: 'sha256-aaaa' }
  ]) {
    const value = lock();
    Object.assign(value.packages['node_modules/demo'], change);
    assert.throws(() => lockedPackages(manifest, value));
  }
  const duplicate = lock();
  duplicate.packages['node_modules/parent/node_modules/demo'] = entry();
  assert.equal(lockedPackages(manifest, duplicate).length, 1);
});

test('cache preparation uses the selected registry, checks lockfile integrity, and exports only inert cache data', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-cache-'));
  try {
    const calls = [];
    const npm = (args, _cwd, selected) => {
      calls.push(args);
      assert.equal(selected, registry);
      if (args[0] === 'pack') {
        assert.equal(args[1], 'demo@1.0.0');
        const directory = args[args.indexOf('--pack-destination') + 1];
        fs.writeFileSync(path.join(directory, 'demo.tgz'), 'archive');
        return JSON.stringify([{ name: 'demo', version: '1.0.0', filename: 'demo.tgz' }]);
      }
      assert.equal(args[0], 'cache');
      assert.ok(args.includes('--offline'));
      return '';
    };
    const prepared = prepareCache(lockedPackages(manifest, lock()), root, registry, npm);
    assert.equal(prepared.packages, 1);
    assert.equal(calls.length, 2);
    assert.deepEqual(fs.readdirSync(prepared.context).sort(), ['Dockerfile', 'cache', 'inputs', 'npm-install.mjs', 'npm-wrapper.sh']);
    assert.ok(!fs.readFileSync(path.join(prepared.context, 'npm-wrapper.sh'), 'utf8').includes('\r'));
    const bad = path.join(root, 'bad.tgz');
    fs.writeFileSync(bad, 'wrong-content');
    assert.throws(() => checkArchive(bad, { ...entry(), spec: 'demo@1.0.0' }), /integrity/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the demo runner pins source, passes no grants, and rejects blocked validation or policy edits', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-run-'));
  try {
    const policy = demoPolicy(options);
    const sha = 'a'.repeat(40);
    fs.writeFileSync(path.join(root, 'read-policy.json'), JSON.stringify(policy));
    fs.writeFileSync(path.join(root, 'demo.json'), JSON.stringify({
      version: 1, repository: options.repo, sourceSha: sha, policies: { read: digestObject(policy) }
    }));
    const calls = [];
    const run = async (request) => {
      calls.push(request);
      assert.deepEqual(request.capabilities, []);
      if (request.command === 'prepare') return {};
      assert.equal(request.ref, sha);
      const directory = path.join(request.output, 'fixture');
      fs.mkdirSync(directory, { recursive: true });
      for (const name of ['run', 'result']) fs.writeFileSync(path.join(directory, `${name}.json`), '{"status":"completed"}');
      fs.writeFileSync(path.join(directory, 'validation.json'), '{"status":"passed"}');
      return { id: 'fixture', sourceSha: sha, repository: options.repo, task: 'validate' };
    };
    const directory = await runDemo({ directory: root, task: 'validate' }, { run });
    assert.equal(calls.length, 2);
    fs.writeFileSync(path.join(directory, 'validation.json'), '{"status":"blocked"}');
    assert.throws(() => runOutcome(directory), /did not pass/);
    policy.capabilities.push('publish');
    fs.writeFileSync(path.join(root, 'read-policy.json'), JSON.stringify(policy));
    await assert.rejects(runDemo({ directory: root, task: 'validate' }, { run }), /policy changed/);
    assert.equal(calls.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('prepared npm worker cache supports real offline analysis and validation without lifecycle installs', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_LOCAL_DOCKER !== 'true', timeout: 300000
}, async () => {
  const root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-offline-')));
  const existingImages = new Set(docker(['image', 'ls', '--quiet', '--no-trunc']).stdout.trim().split(/\s+/));
  let worker, generatedWorker, runtime;
  try {
    const dependency = privateDirectory(path.join(root, 'dependency'));
    fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({
      name: 'lights-on-demo-fixture', version: '1.0.0', main: 'index.cjs',
      scripts: { prepack: 'exit 9', postinstall: 'exit 9' }
    }));
    fs.writeFileSync(path.join(dependency, 'index.cjs'), 'module.exports = 42;\n');
    const packs = privateDirectory(path.join(root, 'fixture-packs'));
    const [packed] = JSON.parse(npmCommand(['pack', dependency, '--offline', '--json',
      '--pack-destination', packs, '--cache', path.join(root, 'fixture-cache')], root, registry));
    const fixtureArchive = path.join(packs, packed.filename);
    const app = { name: 'demo-app', version: '1.0.0', scripts: { test: 'node test.cjs' },
      dependencies: { 'lights-on-demo-fixture': '1.0.0' } };
    const packageLock = { name: app.name, version: app.version, lockfileVersion: 3, packages: {
      '': app, 'node_modules/lights-on-demo-fixture': { version: '1.0.0',
        resolved: 'https://registry.npmjs.org/lights-on-demo-fixture/-/lights-on-demo-fixture-1.0.0.tgz',
        integrity: packed.integrity }
    } };
    const scratch = privateDirectory(path.join(root, 'preparation'));
    const prepared = prepareCache(lockedPackages(app, packageLock), scratch, registry, (args, cwd, selected) => {
      if (args[0] !== 'pack') return npmCommand(args, cwd, selected);
      fs.copyFileSync(fixtureArchive, path.join(args[args.indexOf('--pack-destination') + 1], packed.filename));
      return JSON.stringify([packed]);
    });

    const idFile = path.join(root, 'image-id');
    docker(['build', '--pull=false', '--network=none', '--build-arg', `BASE_IMAGE=${NODE_IMAGE}`,
      '--iidfile', idFile, prepared.context], { timeout: 120000 });
    worker = fs.readFileSync(idFile, 'utf8').trim();
    const candidate = privateDirectory(path.join(root, 'candidate'));
    fs.writeFileSync(path.join(candidate, 'package.json'), JSON.stringify(app));
    fs.writeFileSync(path.join(candidate, 'package-lock.json'), JSON.stringify(packageLock));
    fs.writeFileSync(path.join(candidate, 'test.cjs'), `
const assert = require('node:assert/strict');
assert.equal(require('lights-on-demo-fixture'), 42);
assert.equal(process.env.GITHUB_TOKEN, undefined);
assert.equal(require('node:fs').existsSync('/var/run/docker.sock'), false);
assert.ok(Object.values(require('node:os').networkInterfaces()).flat().every(i => i.internal));
`);
    runtime = new Runtime({ policy: demoPolicy(options, { worker }), work: path.join(root, 'run') });
    const command = runtime.command({ workspace: candidate, command: TEST_COMMAND, image: worker, timeoutSeconds: 60 });
    assert.equal(command.exit_code, 0, command.stderr);
    const validation = await validateCandidate(runtime, { candidate });
    assert.equal(validation.status, 'passed', JSON.stringify(validation));
    const generatedScratch = privateDirectory(path.join(root, 'generated-cache'));
    const generated = prepareCache(lockedPackages(app, packageLock), generatedScratch, registry, (args, cwd, selected) => {
      if (args[0] !== 'pack') return npmCommand(args, cwd, selected);
      fs.copyFileSync(fixtureArchive, path.join(args[args.indexOf('--pack-destination') + 1], packed.filename));
      return JSON.stringify([packed]);
    }, { generatedLock: packageLock, manifestDigest: crypto.createHash('sha256').update(JSON.stringify(app)).digest('hex') });
    const generatedId = path.join(root, 'generated-image-id');
    docker(['build', '--pull=false', '--network=none', '--build-arg', `BASE_IMAGE=${NODE_IMAGE}`,
      '--iidfile', generatedId, generated.context], { timeout: 120000 });
    generatedWorker = fs.readFileSync(generatedId, 'utf8').trim();
    const lockless = privateDirectory(path.join(root, 'lockless'));
    fs.copyFileSync(path.join(candidate, 'package.json'), path.join(lockless, 'package.json'));
    fs.copyFileSync(path.join(candidate, 'test.cjs'), path.join(lockless, 'test.cjs'));
    const installed = runtime.command({ workspace: lockless, command: TEST_COMMAND, image: generatedWorker, timeoutSeconds: 60 });
    assert.equal(installed.exit_code, 0, installed.stderr);
    assert.ok(!fs.existsSync(path.join(lockless, 'package-lock.json')));
    const checked = await validateCandidate(runtime, { candidate: lockless,
      profiles: demoPolicy(options, { worker: generatedWorker }).profiles });
    assert.equal(checked.status, 'passed', JSON.stringify(checked));
    fs.appendFileSync(path.join(lockless, 'package.json'), '\n');
    const stale = runtime.command({ workspace: lockless, command: TEST_COMMAND, image: generatedWorker, timeoutSeconds: 60 });
    assert.notEqual(stale.exit_code, 0);
    assert.match(stale.stderr, /changed since demo preparation/);
    assert.ok(!fs.existsSync(path.join(lockless, 'package-lock.json')));
  } finally {
    runtime?.dispose();
    if (worker && !existingImages.has(worker)) docker(['image', 'rm', worker], { allowFailure: true });
    if (generatedWorker && !existingImages.has(generatedWorker)) docker(['image', 'rm', generatedWorker], { allowFailure: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('npm setup and run scripts complete against controlled GitHub and inference services without publication', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_LOCAL_DOCKER !== 'true', timeout: 300000
}, async () => {
  const root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-demo-e2e-')));
  const fixture = privateDirectory(path.join(root, 'fixture'));
  const network = `lights-on-demo-${crypto.randomUUID()}`;
  const server = `lights-on-demo-${crypto.randomUUID()}`;
  const directory = path.join(root, 'demo');
  const previousKey = process.env.OPENAI_API_KEY;
  const existingImages = new Set(docker(['image', 'ls', '--quiet', '--no-trunc']).stdout.trim().split(/\s+/));
  try {
    docker(['network', 'create', '--internal', '--subnet', '11.254.234.0/24', network]);
    docker(['run', '-d', '--name', server, '--pull=never', '--network', network, '--ip', '11.254.234.3',
      '--user', `${process.getuid()}:${process.getgid()}`,
      '--network-alias', 'api.github.com', '--network-alias', 'github.com', '--network-alias', 'api.openai.com',
      '--env', 'LIGHTS_ON_TEST_NPM=true', ...mount(CODE, '/code', true), ...mount(fixture, '/fixture'),
      '--entrypoint', 'node', NODE_IMAGE, '/code/local/testing/tls-fixture.mjs']);
    for (let attempt = 0; attempt < 100 && !fs.existsSync(path.join(fixture, 'ready')); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(path.join(fixture, 'ready')));
    class FixtureRuntime extends Runtime {
      constructor(settings) {
        super({ ...settings, policy: { ...settings.policy, upstreamCaFile: path.join(fixture, 'ca.pem') } });
      }
      async gateway(role) {
        const existing = this.gateways.has(role);
        const value = await super.gateway(role);
        if (!existing) docker(['network', 'connect', network, value.name]);
        return value;
      }
    }
    const run = (request) => main(request, { createRuntime: (settings) => new FixtureRuntime(settings) });
    await setup({ ...options, repo: 'scovetta/test-aw1', ref: 'main', directory }, { run });
    const prepared = JSON.parse(fs.readFileSync(path.join(directory, 'demo.json')));
    assert.equal(prepared.cache.packages, 0);
    assert.equal(prepared.registry, registry);
    const validated = await runDemo({ directory, task: 'validate' }, { run });
    assert.equal(runOutcome(validated).validation.status, 'passed');
    process.env.OPENAI_API_KEY = 'synthetic-demo-credential';
    const docs = await runDemo({ directory, task: 'docs-clarifier', 'allow-inference': true }, { run });
    assert.equal(fs.readFileSync(path.join(docs, 'candidate', 'README.md'), 'utf8'), 'Updated controlled documentation.\n');
    assert.equal(fs.readFileSync(path.join(docs, 'source', 'README.md'), 'utf8'), 'Controlled Lights On fixture.\n');
    assert.ok(!fs.existsSync(path.join(fixture, 'mutations.json')), 'no GitHub writes');
    assert.ok(!fs.existsSync(path.join(docs, 'publication.json')), 'no publisher started');
    assert.ok(!fs.existsSync(path.join(directory, 'preparation')), 'temporary download/build files cleaned up');
  } finally {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    docker(['rm', '--force', server], { allowFailure: true });
    docker(['network', 'rm', network], { allowFailure: true });
    const manifestFile = path.join(directory, 'demo.json');
    if (fs.existsSync(manifestFile)) {
      const worker = JSON.parse(fs.readFileSync(manifestFile)).workerImage;
      if (!existingImages.has(worker)) docker(['image', 'rm', worker], { allowFailure: true });
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
