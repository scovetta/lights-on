#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main } from '../../lights-on.mjs';
import { assert, NODE_IMAGE, image, digestObject, hash } from '../../policy.mjs';
import { CODE, docker, privateDirectory } from '../../runtime.mjs';
import { HERE, parseOptions, registryUrl, configuredRegistry, forwardWindows, demoPolicy,
  lockedPackages, checkArchive, readJson, saveJson } from './common.mjs';
import { resolveLock } from './resolve-lock.mjs';

export function npmCommand(args, cwd, registry) {
  const transport = ['PATH', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
  const env = { ...Object.fromEntries(transport.filter((key) => process.env[key]).map((key) => [key, process.env[key]])),
    HOME: cwd, USERPROFILE: cwd };
  const config = path.join(cwd, 'user.npmrc'), globalConfig = path.join(cwd, 'global.npmrc');
  fs.writeFileSync(config, '');
  fs.writeFileSync(globalConfig, '');
  const result = spawnSync('npm', [...args, '--ignore-scripts', '--no-audit', '--no-fund',
    '--registry', registry, '--userconfig', config, '--globalconfig', globalConfig], {
    cwd, env, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024
  });
  assert(result.status === 0,
    `npm ${args[0]} failed (${result.error?.code || result.status}). Check the package/version, registry access, TLS and available disk space. Authenticated npm feeds are not supported by this demo.`);
  return result.stdout;
}

export function prepareCache(entries, scratch, registry, npm = npmCommand, { generatedLock, manifestDigest } = {}) {
  const context = privateDirectory(path.join(scratch, 'image'));
  const cache = privateDirectory(path.join(context, 'cache'));
  const downloads = privateDirectory(path.join(scratch, 'download-cache'));
  const packs = privateDirectory(path.join(scratch, 'packs'));
  const inputs = privateDirectory(path.join(context, 'inputs'));
  const archives = generatedLock ? privateDirectory(path.join(inputs, 'archives')) : null;
  let bytes = 0;
  for (const entry of entries) {
    console.log(`Caching ${entry.spec} through ${registry}`);
    // Never follow the target lockfile's URLs. Resolve the exact name/version through the selected registry.
    const packed = JSON.parse(npm(['pack', entry.spec, '--json', '--pack-destination', packs, '--cache', downloads], scratch, registry));
    const pkg = packed[0];
    assert(packed.length === 1 && pkg.name === entry.name && pkg.version === entry.version &&
      typeof pkg.filename === 'string' && /^[A-Za-z0-9_.+-]+\.tgz$/.test(pkg.filename), 'npm returned an unexpected package identity.');
    const file = path.join(packs, pkg.filename);
    const verified = checkArchive(file, entry, { generated: Boolean(generatedLock) });
    bytes += verified.bytes;
    assert(bytes <= 128 * 1024 * 1024, 'Demo package archives exceed 128 MiB; use a separately approved custom image.');
    // Build the exported cache from verified local archives, not HTTP metadata, credentials or npm logs.
    npm(['cache', 'add', file, '--offline', '--cache', cache], scratch, registry);
    if (generatedLock) {
      const archiveName = `${hash(fs.readFileSync(file))}.tgz`;
      fs.copyFileSync(file, path.join(archives, archiveName));
      for (const location of entry.locations) {
        generatedLock.packages[location].integrity = verified.integrity;
        generatedLock.packages[location].resolved = `file:/opt/lights-on-npm-inputs/archives/${archiveName}`;
      }
    }
    fs.unlinkSync(file);
  }
  fs.mkdirSync(path.join(cache, '_cacache'), { recursive: true });
  if (generatedLock) {
    assert(/^[a-f0-9]{64}$/.test(manifestDigest), 'Generated lock needs its source manifest digest.');
    saveJson(path.join(inputs, 'package-lock.json'), generatedLock);
    fs.writeFileSync(path.join(inputs, 'manifest.sha256'), manifestDigest);
  }
  fs.copyFileSync(path.join(HERE, 'worker.Dockerfile'), path.join(context, 'Dockerfile'));
  fs.copyFileSync(path.join(HERE, 'npm-install.mjs'), path.join(context, 'npm-install.mjs'));
  fs.writeFileSync(path.join(context, 'npm-wrapper.sh'),
    fs.readFileSync(path.join(HERE, 'npm-wrapper.sh'), 'utf8').replace(/\r\n/g, '\n'));
  return { context, packages: entries.length, bytes };
}

export function prepareController(options, scratch, engine = docker) {
  if (options['controller-image']) return image(options['controller-image']);
  if (options.provider !== 'copilot') return NODE_IMAGE;
  const registry = registryUrl(options.registry);
  const context = privateDirectory(path.join(scratch, 'controller'));
  for (const name of ['controller.Dockerfile', 'package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(CODE, 'local', 'containers', name), path.join(context, name));
  }
  const imageFile = path.join(scratch, 'controller-image-id');
  console.log(`Preparing the pinned Copilot CLI/SDK controller through ${registry}; no provider credential is needed.`);
  engine(['build', '--pull=false', '--file', path.join(context, 'controller.Dockerfile'),
    '--build-arg', `NPM_REGISTRY=${registry}`, '--iidfile', imageFile, context], { timeout: 600000 });
  return image(fs.readFileSync(imageFile, 'utf8').trim());
}

export async function setup(options, { run = main, npm = npmCommand, engine = docker, resolve = resolveLock } = {}) {
  assert(process.platform === 'linux', 'Use Linux or the Windows/WSL entry point.');
  const directory = path.resolve(options.directory);
  const relative = path.relative(CODE, directory);
  assert(relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative), 'Keep demo outputs outside the Lights On checkout.');
  assert(!fs.existsSync(directory), 'The demo directory must be new; existing runs and policies are never overwritten.');
  options = { ...options, registry: registryUrl(options.registry || configuredRegistry()) };
  privateDirectory(directory);
  const scratch = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-npm-prepare-')));
  try {
    const bootstrapFile = path.join(directory, 'snapshot-policy.json');
    saveJson(bootstrapFile, demoPolicy(options, { validation: false }));
    await run({ command: 'prepare', policy: bootstrapFile, output: path.join(directory, 'snapshots'), capabilities: [] });
    const fetched = await run({ command: 'run', policy: bootstrapFile, output: path.join(directory, 'snapshots'),
      repo: options.repo, ref: options.ref, task: 'validate', capabilities: [] });
    assert(/^[a-f0-9]{40}$/.test(fetched.sourceSha), 'The snapshot did not identify a commit.');
    const snapshot = path.join(directory, 'snapshots', fetched.id);
    assert(readJson(path.join(snapshot, 'result.json')).status === 'completed',
      'The target did not permit the snapshot task; inspect its result.json.');
    console.log('Source snapshot acquired; this bootstrap run deliberately has no validation coverage yet.');
    const source = path.join(snapshot, 'source');
    assert(!fs.existsSync(path.join(source, 'npm-shrinkwrap.json')), 'npm-shrinkwrap.json is unsupported; package-lock.json must be authoritative.');
    const manifestBytes = fs.readFileSync(path.join(source, 'package.json'));
    const manifest = JSON.parse(manifestBytes);
    assert(typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim() &&
      !manifest.scripts.test.includes('no test specified'), 'The target needs a real npm test script.');
    const lockFile = path.join(source, 'package-lock.json');
    const generated = !fs.existsSync(lockFile);
    if (generated) {
      assert(!['yarn.lock', 'pnpm-lock.yaml', '.npmrc'].some((name) => fs.existsSync(path.join(source, name))),
        'A lockless demo cannot ignore another package-manager lock or a project .npmrc; provide an approved npm lockfile.');
      console.log('No committed npm lockfile: resolving a demo-only lock through the restricted registry gateway.');
    }
    const lock = generated ? await resolve(manifest, options, scratch) : readJson(lockFile);
    const entries = lockedPackages(manifest, lock, { generated });
    const cache = prepareCache(entries, scratch, options.registry, npm,
      generated ? { generatedLock: lock, manifestDigest: hash(manifestBytes) } : {});
    saveJson(path.join(directory, 'dependency-lock.json'), lock);
    const imageFile = path.join(scratch, 'worker-image-id');
    engine(['build', '--pull=false', '--network=none', '--build-arg', `BASE_IMAGE=${NODE_IMAGE}`,
      '--iidfile', imageFile, cache.context], { timeout: 600000 });
    const worker = image(fs.readFileSync(imageFile, 'utf8').trim());
    const controller = prepareController(options, scratch, engine);
    options = { ...options, 'controller-image': controller };
    const policies = {
      read: demoPolicy(options, { worker }),
      agent: demoPolicy(options, { worker, inference: true })
    };
    for (const [name, policy] of Object.entries(policies)) saveJson(path.join(directory, `${name}-policy.json`), policy);
    saveJson(path.join(directory, 'demo.json'), {
      version: 1, repository: options.repo, requestedRef: options.ref || '(default branch)', sourceSha: fetched.sourceSha,
      provider: options.provider, registry: options.registry, workerImage: worker, controllerImage: controller,
      lockfile: { source: generated ? 'generated' : 'repository', manifestSha256: hash(manifestBytes),
        sha256: hash(fs.readFileSync(path.join(directory, 'dependency-lock.json'))) },
      cache: { packages: cache.packages, archiveBytes: cache.bytes },
      policies: Object.fromEntries(Object.entries(policies).map(([name, policy]) => [name, digestObject(policy)]))
    });
    console.log(`Prepared demo at ${directory}\nPinned source: ${fetched.sourceSha}\nWorker: ${worker}\nController: ${controller}\nNext: run.mjs --directory <this directory> --task validate`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), 'setup');
    if (options.help) console.log('setup.mjs --repo OWNER/REPO --directory NEW_DIR [--ref REF] [--registry HTTPS_URL] [--provider codex|claude|openrouter|copilot] [--model MODEL] [--github-auth] [--controller-image DIGEST]');
    else if (!forwardWindows('setup.mjs', process.argv.slice(2), options)) await setup(options);
  } catch (error) { console.error(`npm demo setup failed: ${error.message}`); process.exitCode = 1; }
}
