import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';
import { partitionReleaseUploads } from '../.github/lights-on/runner/publish-release.mjs';
import { registryEnvironment, uploadReleaseArtifacts } from '../.github/lights-on/runner/release-artifacts.mjs';
import { archive, artifactManifest } from './package-fixtures.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (name) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', name), 'utf8').replace(/\r\n/g, '\n');
const expected = {
  'ci.yml': { test: { contents: 'read' } },
  'pages.yml': { build: { contents: 'read' }, deploy: { pages: 'write', 'id-token': 'write' } },
  'lights-on-events.yml': { respond: { contents: 'write', issues: 'write', 'pull-requests': 'write' } },
  'lights-on-schedule.yml': { maintenance: { contents: 'write', issues: 'write', 'pull-requests': 'write' } },
  'lights-on-pr.yml': { 'review-and-gate': { contents: 'write', 'pull-requests': 'write', checks: 'read', statuses: 'read' } },
  'lights-on-setup.yml': { discover: { contents: 'read', checks: 'read', statuses: 'read', actions: 'read' } },
  'lights-on-release.yml': {
    metadata: { contents: 'read' }, build: { contents: 'read' }, tag: { contents: 'write' },
    'upload-oidc': { contents: 'read', 'id-token': 'write' }, 'upload-token': { contents: 'read' }
  }
};

test('workflow defaults deny permissions and each named job has exactly its documented grants', () => {
  assert.deepEqual(fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((name) => /\.ya?ml$/.test(name)).sort(),
    Object.keys(expected).sort());
  for (const [file, jobs] of Object.entries(expected)) {
    const source = read(file), workflow = parseSimpleYaml(source);
    assert.deepEqual(workflow.permissions, {}, file);
    assert.deepEqual(Object.keys(workflow.jobs).sort(), Object.keys(jobs).sort(), file);
    for (const [job, grants] of Object.entries(jobs)) {
      assert.ok(workflow.jobs[job].name, `${file}/${job} needs a name`);
      assert.deepEqual(workflow.jobs[job].permissions, grants, `${file}/${job}`);
    }
    for (const line of source.split(/\r?\n/).filter((line) => /^      [\w-]+: (?:read|write)\b/.test(line))) {
      assert.match(line, / # \S/, `Explain permission: ${line}`);
    }
  }
});

test('read-only workflows cancel obsolete runs without changing the shared maintenance budget queue', () => {
  for (const file of ['ci.yml', 'lights-on-setup.yml']) {
    const concurrency = parseSimpleYaml(read(file)).concurrency;
    assert.equal(concurrency['cancel-in-progress'], true);
    assert.match(concurrency.group, /github\.repository/);
  }
  for (const file of ['lights-on-events.yml', 'lights-on-pr.yml', 'lights-on-schedule.yml']) {
    const concurrency = parseSimpleYaml(read(file)).concurrency;
    assert.equal(concurrency['cancel-in-progress'], false);
    assert.equal(concurrency.group, 'lights-on-maintenance-budget-${{ github.repository }}');
  }
});

test('inference action calls do not explicitly receive repository-write tokens', () => {
  let count = 0;
  for (const file of Object.keys(expected)) {
    for (const match of read(file).matchAll(/uses: \$\/\.github\/actions\/lights-on-agent\n([\s\S]*?)(?=\n      - name:|$)/g)) {
      count++;
      assert.doesNotMatch(match[1], /^\s+(?:GH_TOKEN|GITHUB_TOKEN):/m, file);
      assert.match(match[1], /COPILOT_GITHUB_TOKEN:/, file);
    }
  }
  assert.equal(count, 7);
});

test('upload authentication partitions every registry and token/provenance combination without overlap', () => {
  const ecosystems = ['npm', 'pypi', 'crates', 'nuget', 'rubygems'];
  for (const hasNpmToken of [false, true]) {
    for (const hasPypiToken of [false, true]) {
      for (const provenance of [false, true]) {
        const result = partitionReleaseUploads(ecosystems, { hasNpmToken, hasPypiToken, provenance });
        assert.equal(result.oidc.includes('npm'), !hasNpmToken || provenance);
        assert.equal(result.oidc.includes('pypi'), !hasPypiToken);
        for (const name of ['crates', 'nuget', 'rubygems']) assert.ok(result.token.includes(name));
        assert.deepEqual([...result.oidc, ...result.token].sort(), ecosystems.toSorted());
      }
    }
  }
  assert.deepEqual(partitionReleaseUploads([]), { oidc: [], token: [] });
  assert.deepEqual(partitionReleaseUploads(['npm', 'npm']), { oidc: ['npm'], token: [] });
  assert.throws(() => partitionReleaseUploads('npm'), /Invalid/);
  assert.throws(() => partitionReleaseUploads(['go']), /Invalid/);
  assert.throws(() => partitionReleaseUploads(['npm'], { hasNpmToken: 'true' }), /Invalid/);
  assert.throws(() => partitionReleaseUploads(['pypi'], { hasPypiToken: 'true' }), /Invalid/);
  assert.throws(() => partitionReleaseUploads(['npm'], { provenance: null }), /Invalid/);
});

test('the actual release planner wires secret presence, immutable source and empty-matrix guards correctly', () => {
  const source = read('lights-on-release.yml');
  assert.match(source, /HAS_NPM_TOKEN: \$\{\{ secrets\.NPM_TOKEN != '' \}\}/);
  assert.match(source, /HAS_PYPI_TOKEN: \$\{\{ secrets\.PYPI_API_TOKEN != '' \}\}/);
  const body = source.split("node --input-type=module <<'EOF'\n")[1].split('\n          EOF')[0]
    .replace(/^\s*import .*;\s*$/gm, '');
  const run = new Function('fs', 'execFileSync', 'loadConfig', 'parseReleaseMetadataFromPr',
    'publishRelease', 'partitionReleaseUploads', 'isTrustedStateAuthor', 'process', 'console', body);
  for (const ecosystems of [[], ['go'], ['npm'], ['pypi'], ['npm', 'pypi', 'crates']]) {
    for (const hasNpmToken of [false, true]) {
      for (const hasPypiToken of [false, true]) {
        for (const provenance of [false, true]) {
          let output = '';
          run({ appendFileSync: (_file, text) => { output += text; } }, () => 'a'.repeat(40),
            () => ({ enabled: true, release: { enabled: true, auto_publish: true, create_github_release: true, provenance } }),
            () => null, () => ({ version: '1.0.0', targets: ecosystems.map((ecosystem) => ({ ecosystem })) }),
            partitionReleaseUploads, () => true,
            { env: { EVENT_NAME: 'workflow_dispatch', INPUT_VERSION: '1.0.0',
              HAS_NPM_TOKEN: String(hasNpmToken), HAS_PYPI_TOKEN: String(hasPypiToken) } }, { log() {} });
          const values = Object.fromEntries(output.trim().split('\n').map((line) => {
            const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
          }));
          const packages = ecosystems.filter((name) => name !== 'go');
          const expected = partitionReleaseUploads(packages, { hasNpmToken, hasPypiToken, provenance });
          assert.deepEqual(JSON.parse(values.ecosystems), packages);
          assert.equal(values.has_packages, String(packages.length > 0));
          assert.deepEqual(JSON.parse(values.oidc_ecosystems), expected.oidc);
          assert.deepEqual(JSON.parse(values.token_ecosystems), expected.token);
          assert.equal(values.has_oidc_packages, String(expected.oidc.length > 0));
          assert.equal(values.has_token_packages, String(expected.token.length > 0));
          assert.equal(values.sha, 'a'.repeat(40));
        }
      }
    }
  }
  const workflow = parseSimpleYaml(source);
  for (const [job, kind] of [['upload-oidc', 'oidc'], ['upload-token', 'token']]) {
    assert.match(workflow.jobs[job].if, new RegExp(`has_${kind}_packages == 'true'`));
    assert.deepEqual(workflow.jobs[job].needs, ['metadata', 'build', 'tag']);
  }
  const oidc = source.split('\n  upload-oidc:\n')[1].split('\n  upload-token:\n')[0];
  const token = source.split('\n  upload-token:\n')[1];
  assert.doesNotMatch(oidc, /password:|secrets\.PYPI_API_TOKEN/);
  assert.match(token, /password: \$\{\{ secrets\.PYPI_API_TOKEN \}\}/);
  assert.match(token, /attestations: false/);
  assert.doesNotMatch(token, /id-token: write/);
  for (const job of [oidc, token]) {
    assert.ok(job.indexOf('--validate') < job.indexOf('uses: pypa/gh-action-pypi-publish'));
    assert.match(job, /ref: \$\{\{ needs\.metadata\.outputs\.sha \}\}/);
  }
});

test('npm token-only environments cannot inherit OIDC capability metadata', () => {
  const env = { REGISTRY_TOKEN: 'npm-only', ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc',
    ACTIONS_ID_TOKEN_REQUEST_URL: 'https://broker.invalid', GITHUB_ACTIONS: 'true' };
  const token = registryEnvironment('npm', env, '/empty', { provenance: false });
  assert.equal(token.NODE_AUTH_TOKEN, 'npm-only');
  assert.equal(token.ACTIONS_ID_TOKEN_REQUEST_TOKEN, undefined);
  assert.equal(token.ACTIONS_ID_TOKEN_REQUEST_URL, undefined);
  assert.equal(token.GITHUB_ACTIONS, undefined);
  const oidc = registryEnvironment('npm', { ...env, REGISTRY_TOKEN: '' }, '/empty', { provenance: false });
  assert.equal(oidc.ACTIONS_ID_TOKEN_REQUEST_TOKEN, 'oidc');
});

test('live npm upload honors provenance policy without breaking token or OIDC authentication', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-publish-permissions-'));
  const directory = path.join(root, 'artifacts');
  try {
    fs.mkdirSync(directory);
    fs.mkdirSync(path.join(root, '.github'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"name":"demo","version":"1.0.0"}');
    archive(path.join(directory, 'demo.tgz'), 'tar', [['package/package.json', '{"name":"demo","version":"1.0.0"}']]);
    artifactManifest(directory, 'npm', '1.0.0', ['demo.tgz']);
    for (const provenance of [false, true]) {
      fs.writeFileSync(path.join(root, '.github', 'lights-on.yml'), `release:\n  provenance: ${provenance}\n`);
      for (const token of [false, true]) {
        const calls = [];
        await uploadReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm',
          env: { ...(token ? { REGISTRY_TOKEN: 'npm-only' } : {}),
            ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'oidc', ACTIONS_ID_TOKEN_REQUEST_URL: 'https://broker.invalid' },
          execFileImpl: (_cmd, args, options) => { calls.push({ args, env: options.env }); }
        });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].args.includes('--provenance'), provenance);
        assert.equal(calls[0].env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, token && !provenance ? undefined : 'oidc');
        assert.equal(calls[0].env.NODE_AUTH_TOKEN, token ? 'npm-only' : undefined);
      }
    }
    const calls = [];
    await uploadReleaseArtifacts({ repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm',
      env: { REGISTRY_TOKEN: 'local-npm-only' },
      execFileImpl: (_cmd, args, options) => { calls.push({ args, env: options.env }); }
    });
    assert.equal(calls[0].args.includes('--provenance'), false);
    assert.equal(calls[0].env.NODE_AUTH_TOKEN, 'local-npm-only');
    await assert.rejects(() => uploadReleaseArtifacts({
      repoRoot: root, directory, version: '1.0.0', ecosystem: 'npm', env: {},
      execFileImpl: () => assert.fail('Missing identity must not start npm')
    }), /Missing npm publishing identity/);
  } finally { fs.rmSync(root, { recursive: true }); }
});
