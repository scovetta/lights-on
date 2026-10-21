import fs from 'node:fs';
import path from 'node:path';
import { assert, validatePolicy } from '../../policy.mjs';
import { Runtime, privateDirectory } from '../../runtime.mjs';
import { registryUrl, readJson, saveJson } from './common.mjs';

export function resolutionManifest(manifest) {
  assert(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Invalid npm manifest.');
  assert(!manifest.workspaces && !manifest.overrides && !manifest.resolutions &&
    !manifest.bundleDependencies && !manifest.bundledDependencies,
  'Generating a demo lock does not support workspaces, overrides, resolutions or bundled dependencies.');
  assert(!manifest.packageManager || /^npm@/.test(manifest.packageManager), 'The project selects a different package manager.');
  const result = {};
  for (const key of ['name', 'version', 'engines', 'os', 'cpu', 'peerDependenciesMeta']) {
    if (manifest[key] !== undefined) result[key] = manifest[key];
  }
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    if (manifest[key] === undefined) continue;
    assert(manifest[key] && typeof manifest[key] === 'object' && !Array.isArray(manifest[key]), `Invalid ${key}.`);
    result[key] = {};
    for (const [name, spec] of Object.entries(manifest[key])) {
      assert(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) &&
        typeof spec === 'string' && spec.trim() && /^[0-9A-Za-z.*+~^<>=| -]+$/.test(spec),
      'Generating a demo lock accepts only registry version ranges/tags, not Git, file, URL or alias dependencies.');
      result[key][name] = spec;
    }
  }
  return result;
}

export async function resolveLock(manifest, options, scratch, {
  createRuntime = (settings) => new Runtime(settings)
} = {}) {
  const registry = new URL(registryUrl(options.registry));
  assert(!registry.port, 'Protected lock resolution requires an HTTPS registry on port 443.');
  const work = privateDirectory(path.join(scratch, 'lock-resolution'));
  const policy = validatePolicy({
    version: 1, repository: options.repo, capabilities: [], npmRegistry: registry.href,
    rules: [{ id: 'npm-metadata', host: registry.hostname, path: registry.pathname,
      methods: ['GET'], roles: ['prepare'] }]
  });
  saveJson(path.join(work, 'policy.json'), policy);
  saveJson(path.join(work, 'package.json'), resolutionManifest(manifest));
  const runtime = createRuntime({ policy, work, secrets: {}, capabilities: [] });
  try {
    runtime.preflight();
    await runtime.role('prepare', 'prepare-npm-lock');
    return readJson(path.join(work, 'package-lock.json'));
  } finally {
    runtime.dispose();
    if (options.directory) {
      for (const [source, destination] of [
        [path.join(work, 'npm-lock.log'), 'dependency-resolution.log'],
        [path.join(work, 'audit', 'prepare', 'network.jsonl'), 'dependency-resolution-network.jsonl']
      ]) {
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(options.directory, destination));
      }
    }
  }
}
