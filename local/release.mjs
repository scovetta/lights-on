import { spawnSync } from 'node:child_process';
import os from 'node:os';
import { validateReleaseArtifacts, uploadReleaseArtifacts } from '../.github/lights-on/runner/release-artifacts.mjs';
import { assert } from './policy.mjs';

export async function uploadLocalArtifacts({ repoRoot, directory, version, ecosystem, token,
  env = process.env, fetchImpl = globalThis.fetch, execFileImpl }) {
  const clean = { PATH: env.PATH, SystemRoot: env.SystemRoot, REGISTRY_TOKEN: token };
  const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS',
    'SSL_CERT_FILE', 'REQUESTS_CA_BUNDLE'];
  const proxy = Object.fromEntries(proxyKeys.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
  const execute = execFileImpl || ((cmd, args, options) => {
    const child = spawnSync(cmd, args, { ...options, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576 });
    assert(child.status === 0, `Artifact-only ${cmd} uploader failed; credentials and arguments suppressed.`);
    return child.stdout;
  });
  const run = (cmd, args, options) => execute(cmd, args, { ...options, env: { ...options.env, ...proxy } });
  if (ecosystem === 'pypi') {
    const files = validateReleaseArtifacts({ repoRoot, directory, version, ecosystem, env: clean });
    assert(token, 'Missing PyPI token; local mode does not simulate Actions OIDC.');
    run(process.platform === 'win32' ? 'python' : 'python3',
      ['-I', '-m', 'twine', 'upload', '--non-interactive', '--repository-url', 'https://upload.pypi.org/legacy/', ...files],
      { cwd: os.tmpdir(), env: { PATH: env.PATH, SystemRoot: env.SystemRoot, HOME: os.tmpdir(),
        TWINE_USERNAME: '__token__', TWINE_PASSWORD: token } });
  } else {
    await uploadReleaseArtifacts({ repoRoot, directory, version, ecosystem, env: clean, execFileImpl: run, fetchImpl });
  }
}
