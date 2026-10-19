#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPolicy, readSecrets, grantedCapabilities, operationCredentials, normalizeTask, TASKS, assert, digestObject, hash } from './policy.mjs';
import { Runtime, docker, privateDirectory, writePrivate } from './runtime.mjs';
import { validateCandidate, validateProfile } from './validation.mjs';
import { inventory } from '../.github/lights-on/runner/agent-sandbox.mjs';
import { literalPublicationBody } from '../.github/lights-on/runner/publication-text.mjs';

export function parseArgs(args) {
  const options = { command: args[0], capabilities: [] };
  assert(['prepare', 'run', 'publish', 'status', 'cleanup'].includes(options.command), 'Usage: node local/lights-on.mjs prepare|run|publish|status|cleanup --policy FILE --output DIR');
  const flags = { '--publish': 'publish', '--allow-merge': 'merge', '--allow-release': 'release',
    '--allow-registry-publish': 'registry-publish' };
  const values = { '--policy': 'policy', '--output': 'output', '--run': 'run', '--repo': 'repo', '--ref': 'ref',
    '--task': 'task', '--item': 'item', '--plan-id': 'planId', '--tier': 'tier',
    '--version': 'version', '--ecosystem': 'ecosystem' };
  for (let index = 1; index < args.length; index++) {
    const flag = args[index];
    if (flags[flag]) options.capabilities.push(flags[flag]);
    else {
      assert(values[flag] && args[index + 1] && !args[index + 1].startsWith('--'), `Unknown or incomplete argument ${flag}.`);
      assert(options[values[flag]] === undefined, `Duplicate argument ${flag}.`);
      options[values[flag]] = args[++index];
    }
  }
  if (options.item) {
    assert(/^[1-9]\d*$/.test(options.item), 'Item must be a positive issue/PR number.');
    options.item = Number(options.item);
  }
  if (options.version) assert(/^\d+\.\d+\.\d+$/.test(options.version), 'Version must be stable semver.');
  if (options.ecosystem) assert(['npm', 'pypi', 'nuget', 'crates', 'rubygems'].includes(options.ecosystem), 'Unknown registry ecosystem.');
  if (options.tier) assert(['default', 'reasoning'].includes(options.tier), 'Unknown model tier.');
  return options;
}

function json(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function save(file, value) { writePrivate(file, JSON.stringify(value, null, 2) + '\n'); }

function safeRun(directory) {
  const root = path.resolve(directory);
  assert(!fs.lstatSync(root).isSymbolicLink(), 'Run directory cannot be a symlink.');
  const run = json(path.join(root, 'run.json'));
  assert(run.version === 1 && /^[a-f0-9-]{36}$/.test(run.id) && path.basename(root) === run.id, 'Not a managed run directory.');
  return { root, run };
}

function reports(root, run) {
  const logs = [];
  for (const role of ['fetch', 'analysis', 'prepare', 'publisher']) {
    const file = path.join(root, 'audit', role, 'network.jsonl');
    if (fs.existsSync(file)) logs.push(fs.readFileSync(file, 'utf8'));
  }
  writePrivate(path.join(root, 'network.jsonl'), logs.join(''));
  save(path.join(root, 'run.json'), run);
  const summary = [`# Lights On local run`, `Repository: ${run.repository}`, `Source: ${run.sourceSha || 'not fetched'}`,
    `Task: ${run.task || 'preparation'}`, `Status: ${run.status}`, `Capabilities: ${run.capabilities.join(', ') || 'none'}`,
    `Task outcome: ${run.result || 'not run'}`,
    `Local CI: ${run.validation || 'not run'} (never substitutes for trusted GitHub checks).`,
    run.error || '', 'Network request metadata is in network.jsonl; direct blocked sockets are not a syscall audit.'];
  if (fs.existsSync(path.join(root, 'result.json'))) {
    const result = json(path.join(root, 'result.json'));
    summary.push(typeof result.summary === 'string' ? result.summary : JSON.stringify(result.summary || result.reason || ''));
    if (result.usage) summary.push(`Provider usage: ${JSON.stringify(result.usage)}`);
  }
  if (fs.existsSync(path.join(root, 'publication.json'))) summary.push(JSON.stringify(json(path.join(root, 'publication.json'))));
  writePrivate(path.join(root, 'summary.md'), literalPublicationBody(summary.filter(Boolean).join('\n')) + '\n');
}

export async function main(options, { createRuntime = (settings) => new Runtime(settings) } = {}) {
  if (options.command === 'status') {
    const { run } = safeRun(options.run);
    console.log(JSON.stringify(run, null, 2));
    return run;
  }
  if (options.command === 'cleanup') {
    const { root, run } = safeRun(options.run);
    assert(!fs.existsSync(path.join(root, 'active.lock')), 'Cannot clean up an active run.');
    assert(!['running', 'publishing'].includes(run.status), 'Interrupted run needs inspection before cleanup.');
    fs.rmSync(root, { recursive: true });
    console.log('Removed the selected managed run only; persistent budget state retained.');
    return;
  }
  assert(options.policy, 'Select an operator-owned policy file.');
  const policy = readPolicy(path.resolve(options.policy));
  policy.profiles = policy.profiles.map(validateProfile);
  assert(!options.repo || options.repo.toLowerCase() === policy.repository, 'CLI repository differs from operator policy.');
  const capabilities = grantedCapabilities(policy, options.capabilities);
  assert(options.command !== 'prepare' || !capabilities.length, 'Preparation cannot grant publication.');
  let root, run;
  if (options.command === 'publish') {
    ({ root, run } = safeRun(options.run));
    assert(run.status === 'completed' && run.policyDigest === digestObject(policy), 'Run is incomplete or policy changed.');
    assert(capabilities.length > 0, 'Publication requires explicit capability flags.');
    assert(!fs.existsSync(path.join(root, 'publication.json')), 'This run already has publication side effects; inspect them before retrying.');
  } else {
    assert(options.output, 'Select a dedicated output directory.');
    const output = privateDirectory(path.resolve(options.output));
    assert(!fs.lstatSync(output).isSymbolicLink(), 'Output directory cannot be a symlink.');
    root = privateDirectory(path.join(output, crypto.randomUUID()));
    run = { version: 1, id: path.basename(root), repository: policy.repository, policyDigest: digestObject(policy),
      images: policy.images, capabilities: [], task: normalizeTask(options.task || 'validate'), status: 'running',
      startedAt: new Date().toISOString() };
    assert(TASKS.includes(run.task), 'Unsupported local task.');
    if (run.task === 'pr-reviewer') assert(options.item, 'PR review requires --item.');
    save(path.join(root, 'policy.json'), policy);
    save(path.join(root, 'request.json'), { task: run.task, ref: options.ref, item: options.item,
      planId: options.planId, tier: options.tier, version: options.version, ecosystem: options.ecosystem });
    save(path.join(root, 'run.json'), run);
  }
  const state = privateDirectory(path.join(path.dirname(root), 'state', digestObject({ repository: policy.repository, policy: run.policyDigest })));
  const cache = privateDirectory(path.join(state, 'bundles'));
  const stateLock = path.join(state, 'active.lock');
  const lock = fs.openSync(stateLock, 'wx', 0o600);
  fs.closeSync(lock);
  const active = path.join(root, 'active.lock');
  writePrivate(active, String(process.pid));
  let runtime;
  const cancel = () => {
    run.cancelled = true;
    try { runtime?.cancel(); } catch (err) { run.error = `Cancellation cleanup failed: ${err.message}`; }
  };
  process.on('SIGINT', cancel);
  process.on('SIGTERM', cancel);
  try {
    run.capabilities = capabilities;
    save(path.join(root, 'grants.json'), capabilities);
    runtime = createRuntime({ policy, work: root,
      secrets: readSecrets(policy, process.env, operationCredentials(policy, options.command, capabilities)), capabilities });
    if (run.codeDigest) assert(run.codeDigest === runtime.codeDigest, 'Trusted controller code changed; rerun before publication.');
    run.codeDigest = runtime.codeDigest;
    if (options.command === 'prepare') {
      const images = new Set([...Object.values(policy.images), ...policy.profiles.flatMap((p) => [p.image, ...p.services.map((s) => s.image)])]);
      for (const ref of images) {
        if (docker(['image', 'inspect', ref], { allowFailure: true }).status !== 0) {
          assert(ref.includes('@sha256:'), 'Image ID not loaded; load the approved image offline.');
          console.error('Preparing pinned image through the Docker daemon; this traffic is outside the gateway audit.');
          docker(['pull', ref], { timeout: 600000 });
        }
      }
      runtime.preflight();
      privateDirectory(path.join(root, 'bundles'));
      for (const bundle of policy.bundles) {
        const file = path.join(cache, bundle.name);
        if (fs.existsSync(file) && hash(fs.readFileSync(file)) === bundle.sha256) {
          fs.copyFileSync(file, path.join(root, 'bundles', bundle.name));
        }
      }
      await runtime.role('prepare', 'prepare');
      for (const bundle of policy.bundles) {
        fs.copyFileSync(path.join(root, 'bundles', bundle.name), path.join(cache, bundle.name));
        fs.chmodSync(path.join(cache, bundle.name), 0o600);
      }
    } else if (options.command === 'run') {
      runtime.preflight();
      console.log(JSON.stringify({ repository: policy.repository, task: run.task, capabilities,
        services: policy.rules.map((r) => ({ role: r.roles, host: r.host, rule: r.id })) }));
      await runtime.role('fetch', 'fetch', [], { extraMounts: [[state, '/state']] });
      const snapshot = json(path.join(root, 'snapshot.json'));
      run.sourceSha = snapshot.sourceSha;
      run.headSha = snapshot.headSha || null;
      run.sourceDigest = snapshot.sourceDigest;
      await runtime.listen();
      const extraMounts = [[state, '/state']];
      if (policy.provider === 'copilot' && runtime.secrets.COPILOT_GITHUB_TOKEN) {
        const inference = privateDirectory(path.join(runtime.root, 'inference'));
        writePrivate(path.join(inference, 'token'), runtime.secrets.COPILOT_GITHUB_TOKEN);
        extraMounts.push([inference, '/inference', true]);
      }
      await runtime.role('analysis', 'controller', [], { control: true, extraMounts });
      privateDirectory(path.join(root, 'bundles'));
      for (const bundle of policy.bundles) {
        const file = path.join(cache, bundle.name);
        if (fs.existsSync(file) && hash(fs.readFileSync(file)) === bundle.sha256) {
          fs.copyFileSync(file, path.join(root, 'bundles', bundle.name));
        }
      }
      const validation = await validateCandidate(runtime);
      save(path.join(root, 'validation.json'), validation);
      run.validation = validation.status;
      run.candidateDigest = digestObject([...inventory(path.join(root, 'candidate'), { omitLocal: true })]);
      run.result = json(path.join(root, 'result.json')).status;
      save(path.join(root, 'candidate-manifest.json'), [...inventory(path.join(root, 'candidate'), { omitLocal: true })]);
      if (run.task === 'release' && options.version && options.ecosystem && validation.status === 'passed') {
        const extensions = { npm: /\.tgz$/, pypi: /\.(whl|tar\.gz)$/, nuget: /\.nupkg$/, crates: /\.crate$/, rubygems: /\.gem$/ };
        const artifacts = privateDirectory(path.join(root, 'artifacts'));
        const entries = [];
        for (const profile of policy.profiles) {
          for (const output of profile.outputs) {
            if (!extensions[options.ecosystem].test(output) && !(options.ecosystem === 'crates' && output.endsWith('crate-metadata.json'))) continue;
            const name = path.basename(output);
            assert(!entries.some((entry) => entry.name === name), 'Duplicate artifact name across validation profiles.');
            const content = fs.readFileSync(path.join(root, 'test-output', profile.id, output));
            writePrivate(path.join(artifacts, name), content);
            entries.push({ name, sha256: hash(content) });
          }
        }
        assert(entries.length > 0, 'Release profiles produced no declared package artifacts.');
        const manifest = { version: options.version, ecosystem: options.ecosystem, files: entries };
        save(path.join(artifacts, 'manifest.json'), manifest);
        save(path.join(root, 'artifact.json'), manifest);
      }
    }
    assert(!run.cancelled, 'Run cancelled; no publication permitted.');
    run.status = 'completed';
    reports(root, run);
    if (options.command !== 'prepare' && capabilities.length) {
      run.status = 'publishing';
      reports(root, run);
      const publication = privateDirectory(path.join(runtime.root, 'publication'));
      writePrivate(path.join(publication, 'secrets.json'), JSON.stringify(
        capabilities.includes('registry-publish') ? { REGISTRY_TOKEN: runtime.secrets.REGISTRY_TOKEN } : {}));
      await runtime.role('publisher', 'publisher', [], { extraMounts: [[publication, '/publication', true]] });
      run.status = 'completed';
    }
    return run;
  } catch (err) {
    run.status = 'failed';
    run.error = err.message;
    throw err;
  } finally {
    try { runtime?.dispose(); } catch (err) { run.status = 'failed'; run.error = `Cleanup failed: ${err.message}`; throw err; }
    finally {
      process.off('SIGINT', cancel);
      process.off('SIGTERM', cancel);
      run.finishedAt = new Date().toISOString();
      reports(root, run);
      fs.unlinkSync(active);
      fs.unlinkSync(stateLock);
      console.log(`Local run artifacts: ${root}`);
    }
  }
}

function windows(args) {
  const distro = process.env.LIGHTS_ON_WSL_DISTRO || 'AzureLinux3.0';
  const convert = (file) => {
    const result = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', path.resolve(file)], { encoding: 'utf8' });
    assert(result.status === 0, 'Cannot map path into WSL.');
    return result.stdout.trim();
  };
  const mapped = [...args];
  for (let i = 0; i < mapped.length; i++) if (['--policy', '--output', '--run'].includes(mapped[i])) mapped[++i] = convert(mapped[i]);
  const policyIndex = args.indexOf('--policy');
  const envKeys = policyIndex >= 0 ? Object.values(json(args[policyIndex + 1]).credentials || {}).map((v) => v.env).filter(Boolean) : [];
  assert(envKeys.every((name) => /^[A-Z][A-Z0-9_]*$/.test(name)), 'Invalid credential environment key.');
  const child = spawnSync('wsl.exe', ['-d', distro, '--exec', 'node', convert(fileURLToPath(import.meta.url)), ...mapped],
    { stdio: 'inherit', env: { ...process.env, WSLENV: [process.env.WSLENV, ...envKeys].filter(Boolean).join(':') } });
  process.exitCode = child.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform === 'win32') windows(process.argv.slice(2));
    else await main(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(`Local Lights On failed: ${err.message}`);
    process.exitCode = 1;
  }
}
