import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assert, exactKeys, image, integer, relativeFile, digestObject, hash } from './policy.mjs';
import { copyWorkspace, privateDirectory, docker, restrictions, mount } from './runtime.mjs';
import { inventory } from '../.github/lights-on/runner/agent-sandbox.mjs';

export function validateProfile(raw) {
  exactKeys(raw, ['id', 'image', 'platform', 'commands', 'services', 'environment', 'resources',
    'timeoutSeconds', 'bundles', 'outputs'], 'validation profile');
  const profile = structuredClone(raw);
  assert(/^[a-z0-9-]{1,60}$/.test(profile.id), 'Invalid profile ID.');
  image(profile.image);
  profile.platform ||= 'linux/amd64';
  assert(/^(linux|windows|darwin)\/(amd64|arm64)$/.test(profile.platform), 'Invalid profile platform.');
  assert(Array.isArray(profile.commands) && profile.commands.length > 0 && profile.commands.length <= 30, 'Profile needs bounded commands.');
  for (const command of profile.commands) {
    assert(typeof command === 'string' && command.trim().length > 0 && command.length <= 16000, 'Invalid validation command.');
  }
  profile.timeoutSeconds ??= 300;
  integer(profile.timeoutSeconds, 1, 3600, 'validation timeout');
  profile.resources ||= {};
  exactKeys(profile.resources, ['memory', 'cpus', 'pids'], 'resources');
  restrictions(profile.resources);
  profile.environment ||= {};
  exactKeys(profile.environment, Object.keys(profile.environment), 'environment');
  for (const [name, value] of Object.entries(profile.environment)) {
    assert(/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string' && value.length < 4000 &&
      !/(?:TOKEN|PASSWORD|SECRET|API_KEY|PROXY|DOCKER|LD_PRELOAD|NODE_OPTIONS)/i.test(name), 'Invalid non-secret test environment.');
  }
  profile.bundles ||= [];
  assert(Array.isArray(profile.bundles), 'Invalid profile bundles.');
  profile.bundles.forEach((name) => { relativeFile(name); assert(!name.includes('/'), 'Bundle name cannot contain directories.'); });
  profile.outputs ||= [];
  assert(Array.isArray(profile.outputs), 'Invalid profile outputs.');
  profile.outputs.forEach(relativeFile);
  profile.services ||= [];
  assert(Array.isArray(profile.services) && profile.services.length <= 8, 'Too many test services.');
  for (const service of profile.services) {
    exactKeys(service, ['id', 'image', 'command', 'healthCommand', 'port', 'dataPaths', 'environment'], 'test service');
    assert(/^[a-z0-9-]{1,60}$/.test(service.id), 'Invalid service ID.');
    image(service.image);
    assert(Array.isArray(service.command) && service.command.length && service.command.every((arg) => typeof arg === 'string'),
      'Service must declare its command explicitly.');
    assert(typeof service.healthCommand === 'string' && service.healthCommand.length <= 4000, 'Service needs a readiness command.');
    integer(service.port, 1024, 65535, 'service port');
    service.dataPaths ||= [];
    assert(Array.isArray(service.dataPaths) && service.dataPaths.every((p) => /^\/[A-Za-z0-9_/-]+$/.test(p) &&
      !p.includes('..') && !['/', '/proc', '/sys', '/dev', '/etc', '/code', '/workspace'].some((root) => p === root)),
    'Unsafe temporary service data path.');
    service.environment ||= {};
    assert(Object.entries(service.environment).every(([key, val]) => /^[A-Z][A-Z0-9_]*$/.test(key) &&
      typeof val === 'string' && !/PROXY|TOKEN|API_KEY|DOCKER/i.test(key)), 'Service environment must contain only synthetic local test settings.');
  }
  assert(new Set(profile.services.map((s) => s.port)).size === profile.services.length, 'Loopback service ports must be unique.');
  return profile;
}

export function aggregateValidation(cases) {
  if (!cases.length) return 'blocked';
  if (cases.some((item) => item.status === 'failed')) return 'failed';
  if (cases.some((item) => item.status !== 'passed')) return 'blocked';
  return 'passed';
}

export async function validateCandidate(runtime, { profiles = runtime.policy.profiles, candidate = path.join(runtime.work, 'candidate'),
  bundleRoot = path.join(runtime.work, 'bundles') } = {}) {
  const baseline = inventory(candidate, { omitLocal: true });
  const candidateDigest = digestObject([...baseline]);
  const result = { version: 1, candidate: candidateDigest, cases: [], status: 'blocked', remoteChecksSatisfied: false };
  const ids = new Set();
  for (const raw of profiles) {
    const profile = validateProfile(raw);
    assert(!ids.has(profile.id), 'Duplicate validation profile.');
    ids.add(profile.id);
    const outcome = { profile: profile.id, profileDigest: digestObject(profile), image: profile.image,
      platform: profile.platform, status: 'blocked', commands: [], bundles: [] };
    result.cases.push(outcome);
    const directory = privateDirectory(path.join(runtime.work, 'validation', crypto.randomUUID()));
    const workspace = path.join(directory, 'workspace');
    const names = [];
    const deadline = Math.min(runtime.deadline, Date.now() + profile.timeoutSeconds * 1000);
    const remaining = () => {
      const value = deadline - Date.now();
      assert(!runtime.cancelled && value > 0, 'Validation deadline exceeded or run cancelled.');
      return value;
    };
    try {
      runtime.requireImage(profile.image);
      const platform = docker(['image', 'inspect', profile.image, '--format', '{{.Os}}/{{.Architecture}}']).stdout.trim();
      assert(platform === profile.platform && platform.startsWith('linux/'), 'Required platform is unavailable.');
      copyWorkspace(candidate, workspace);
      const bundles = privateDirectory(path.join(directory, 'bundles'));
      for (const name of profile.bundles) {
        const expected = runtime.policy.bundles.find((b) => b.name === name);
        const file = path.join(bundleRoot, name);
        assert(expected && fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() &&
          hash(fs.readFileSync(file)) === expected.sha256, `Missing or changed offline bundle: ${name}`);
        fs.copyFileSync(file, path.join(bundles, name));
        fs.chmodSync(path.join(bundles, name), 0o444);
        outcome.bundles.push({ name, sha256: expected.sha256 });
      }
      const anchor = runtime.name();
      names.push(anchor);
      docker(['run', '-d', '--name', anchor, ...restrictions(profile.resources),
        ...mount(workspace, '/workspace'), ...mount(bundles, '/bundles', true),
        '--workdir', '/workspace', '--env', 'HOME=/tmp', '--env', 'CI=true',
        ...Object.entries(profile.environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
        '--entrypoint', '/bin/sh', profile.image, '-c', 'while :; do sleep 3600; done'], { timeout: remaining() });
      for (const service of profile.services) {
        runtime.requireImage(service.image);
        const name = runtime.name();
        names.push(name);
        docker(['run', '-d', '--name', name, ...restrictions({ ...profile.resources, network: `container:${anchor}` }),
          ...service.dataPaths.flatMap((p) => ['--tmpfs', `${p}:rw,nosuid,nodev,size=256m,uid=${process.getuid() || 1000},gid=${process.getgid() || 1000}`]),
          ...Object.entries(service.environment).flatMap(([key, value]) => ['--env', `${key}=${value}`]),
          '--entrypoint', service.command[0], service.image, ...service.command.slice(1)], { timeout: remaining() });
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          if (docker(['exec', name, '/bin/sh', '-c', service.healthCommand], { allowFailure: true, timeout: Math.min(2000, remaining()) }).status === 0) {
            ready = true; break;
          }
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000, remaining())));
        }
        assert(ready, `Test service ${service.id} did not become healthy.`);
      }
      for (const command of profile.commands) {
        const executed = docker(['exec', anchor, '/bin/sh', '-c', command], { timeout: remaining(), allowFailure: true });
        outcome.commands.push({ command, exitCode: executed.status, timedOut: executed.error?.code === 'ETIMEDOUT',
          stdout: (executed.stdout || '').slice(0, 50000), stderr: (executed.stderr || '').slice(0, 50000) });
        if (executed.status !== 0) {
          outcome.status = executed.error?.code === 'ETIMEDOUT' ? 'timed out' : 'failed';
          break;
        }
      }
      // Stop descendants and services before inspecting untrusted filesystem output.
      for (const name of names.splice(0).reverse()) runtime.remove(name);
      for (const [name, entry] of baseline) {
        const file = path.join(workspace, name);
        let parent = path.dirname(file);
        while (parent !== workspace) {
          assert(!fs.lstatSync(parent).isSymbolicLink(), 'Validation replaced a source directory with a symlink.');
          parent = path.dirname(parent);
        }
        assert(fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink() &&
          hash(fs.readFileSync(file)) === entry.hash &&
          (fs.statSync(file).mode & 0o111) === (entry.mode & 0o111), `Validation modified candidate source: ${name}`);
      }
      if (outcome.commands.length === profile.commands.length && outcome.commands.every((c) => c.exitCode === 0)) outcome.status = 'passed';
      const exported = privateDirectory(path.join(runtime.work, 'test-output', profile.id));
      for (const name of outcome.status === 'passed' ? profile.outputs : []) {
        const file = path.join(workspace, name);
        assert(fs.existsSync(file), `Declared validation output is missing: ${name}`);
        let cursor = file;
        while (cursor !== workspace) {
          assert(!fs.lstatSync(cursor).isSymbolicLink(), 'Symlink in validation output.');
          cursor = path.dirname(cursor);
        }
        const stat = fs.lstatSync(file);
        assert(stat.isFile() && stat.size <= 10 * 1024 * 1024, 'Unsafe or excessive validation output.');
        const target = path.join(exported, name);
        privateDirectory(path.dirname(target));
        fs.copyFileSync(file, target);
      }
    } catch (err) {
      if (!['failed', 'timed out'].includes(outcome.status)) outcome.status = 'blocked';
      outcome.reason = err.message;
    } finally {
      for (const name of names.reverse()) runtime.remove(name);
      fs.rmSync(directory, { recursive: true });
    }
  }
  result.status = aggregateValidation(result.cases);
  if (!result.cases.length) result.reason = 'No operator-approved validation profiles; local CI coverage is unknown.';
  return result;
}
