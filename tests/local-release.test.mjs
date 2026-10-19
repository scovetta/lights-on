import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { archive, artifactManifest } from './package-fixtures.mjs';
import { uploadLocalArtifacts } from '../local/release.mjs';

test('local PyPI upload validates distribution identity, keeps proxy transport and never builds with a token', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-local-release-'));
  const directory = path.join(root, 'artifacts');
  fs.mkdirSync(directory);
  const filename = 'demo-1.0.0-py3-none-any.whl';
  try {
    fs.writeFileSync(path.join(root, 'pyproject.toml'), '[project]\nname="demo"\nversion="1.0.0"\n');
    archive(path.join(directory, filename), 'zip', [['demo-1.0.0.dist-info/METADATA',
      'Metadata-Version: 2.1\nName: demo\nVersion: 1.0.0\n\n']]);
    artifactManifest(directory, 'pypi', '1.0.0', [filename]);
    const calls = [];
    const options = { repoRoot: root, directory, version: '1.0.0', ecosystem: 'pypi', token: 'synthetic-token',
      env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
        HTTPS_PROXY: 'http://127.0.0.1:8080', REQUESTS_CA_BUNDLE: '/egress/ca.pem',
        ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'must-not-forward', OPENAI_API_KEY: 'must-not-forward' },
      execFileImpl: (cmd, args, opts) => { calls.push({ cmd, args, opts }); }
    };
    await uploadLocalArtifacts(options);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].args.slice(0, 4), ['-I', '-m', 'twine', 'upload']);
    assert.ok(!calls[0].args.includes('synthetic-token'));
    assert.equal(calls[0].opts.env.TWINE_PASSWORD, 'synthetic-token');
    assert.equal(calls[0].opts.env.HTTPS_PROXY, 'http://127.0.0.1:8080');
    assert.equal(calls[0].opts.env.OPENAI_API_KEY, undefined);
    assert.equal(calls[0].opts.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
    archive(path.join(directory, filename), 'zip', [['demo-1.0.0.dist-info/METADATA',
      'Metadata-Version: 2.1\nName: victim\nVersion: 1.0.0\n\n']]);
    artifactManifest(directory, 'pypi', '1.0.0', [filename]);
    await assert.rejects(uploadLocalArtifacts(options), /identity/);
    assert.equal(calls.length, 1, 'identity failure prevents the uploader from running');
  } finally { fs.rmSync(root, { recursive: true }); }
});
