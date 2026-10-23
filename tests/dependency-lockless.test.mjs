import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectDependencyWork, verifyDependencyScope, validateDependencyCandidate } from '../.github/lights-on/runner/dependency-work.mjs';
import { reportDependencySelection, publishDependencyStage } from '../.github/lights-on/runner/dependency-stage.mjs';
import { describeChange } from '../.github/lights-on/runner/describe-change.mjs';
import { createAgentSandbox } from '../.github/lights-on/runner/agent-sandbox.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { NODE_IMAGE } from '../local/policy.mjs';
import { docker, restrictions, mount, privateDirectory } from '../local/runtime.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dep = { name: 'demo', ecosystem: 'npm', manifest: 'package.json',
  versionSpec: '^1.0.0', resolvedVersion: '1.0.0', latestVersion: '1.0.1',
  recommendedAction: 'bump-minor-or-patch', flags: { vulnerable: false }, cves: [],
  evidence: { metadata_available: true, advisory_checked: true } };
const report = (dependencies = [dep]) => ({ scannedAt: new Date().toISOString(), dependencies });
const write = (root, name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
const read = (root, name) => JSON.parse(fs.readFileSync(path.join(root, name)));
const cleanAdvisory = async () => ({ ok: true, json: async () => ({}) });
function fixture(prefix = '') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-lockless-'));
  const source = path.join(root, 'source'), candidate = path.join(root, 'candidate'), worker = path.join(root, 'worker');
  for (const dir of [source, candidate, worker]) fs.mkdirSync(path.join(dir, prefix), { recursive: true });
  const manifest = path.posix.join(prefix, 'package.json'), lock = path.posix.join(prefix, 'package-lock.json');
  const pkg = { name: 'app', version: '1.0.0', dependencies: { demo: '^1.0.0' },
    scripts: { test: 'node -e "if(require(\'demo/package.json\').version !== \'1.0.1\')process.exit(1)"' } };
  write(source, manifest, pkg);
  const next = { ...pkg, dependencies: { demo: '^1.0.1' } };
  write(candidate, manifest, next);
  write(worker, manifest, next);
  const selected = { ...dep, manifest };
  const selection = selectDependencyWork({ report: report([selected]), repoRoot: source });
  const generatedLock = { lockfileVersion: 3, packages: { '': next, 'node_modules/demo': { version: '1.0.1' } } };
  return { root, source, candidate, worker, selection, manifest, lock, generatedLock,
    close() { fs.rmSync(root, { recursive: true, force: true }); } };
}

test('the reported mix selects a routine manifest-only candidate while majors and security remain deferred', () => {
  const f = fixture();
  try {
    const pkg = { name: 'example', scripts: { test: 'node --test' },
      devDependencies: { 'semantic-release': '^25.0.0', 'ts-node': '^10.9.1', '@types/node': '^18.0.0', express: '^4.17.3' } };
    write(f.source, 'package.json', pkg);
    const dependencies = [
      { ...dep, name: 'semantic-release', versionSpec: '^25.0.0', resolvedVersion: '25.0.0', latestVersion: '25.0.2' },
      { ...dep, name: 'ts-node', versionSpec: '^10.9.1', resolvedVersion: '10.9.1', latestVersion: '10.9.2' },
      { ...dep, name: '@types/node', versionSpec: '^18.0.0', resolvedVersion: '18.0.0', latestVersion: '24.0.0', recommendedAction: 'evaluate-major-bump' },
      { ...dep, name: 'express', versionSpec: '^4.17.3', resolvedVersion: '4.17.3', recommendedAction: 'security-bump' }
    ];
    const result = selectDependencyWork({ report: report(dependencies), repoRoot: f.source });
    assert.equal(result.status, 'ready');
    assert.equal(result.dependency.name, 'semantic-release');
    assert.deepEqual(result.lockfile, { path: 'package-lock.json', mode: 'temporary', sha256: null });
    assert.equal(result.blockers.length, 0);
    assert.deepEqual(result.deferred.map((item) => item.route), ['migration-plan', 'Step C']);
    assert.deepEqual(read(f.source, 'package.json'), pkg);
    assert.ok(!fs.existsSync(path.join(f.source, 'package-lock.json')));
  } finally { f.close(); }
});

test('temporary locks do not permit unsupported managers, layouts, ranges, missing evidence or lost committed locks', () => {
  const f = fixture();
  try {
    const select = (dependency = dep) => selectDependencyWork({ repoRoot: f.source, report: report([dependency]) });
    for (const change of [{ packageManager: 'pnpm@10' }, { workspaces: ['packages/*'] }, { scripts: {} }]) {
      write(f.source, f.manifest, { ...read(f.candidate, f.manifest), dependencies: { demo: dep.versionSpec }, ...change });
      assert.equal(select().status, 'blocked');
    }
    write(f.source, f.manifest, { name: 'app', dependencies: { demo: dep.versionSpec }, scripts: { test: 'node --test' } });
    for (const file of ['yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json']) {
      fs.writeFileSync(path.join(f.source, file), '{}');
      assert.equal(select().status, 'blocked');
      fs.unlinkSync(path.join(f.source, file));
    }
    write(f.source, f.lock, null);
    assert.throws(() => select(), /Invalid or unreadable npm lockfile/);
    for (const lock of [{}, { lockfileVersion: 1, dependencies: { demo: { version: '1.0.0' } } }]) {
      write(f.source, f.lock, lock);
      assert.equal(select().status, 'blocked');
    }
    write(f.source, f.lock, { lockfileVersion: 3,
      packages: { '': {}, 'node_modules/demo': { version: '1.0.0' } } });
    const selected = select();
    assert.equal(selected.lockfile.mode, 'committed');
    fs.unlinkSync(path.join(f.source, f.lock));
    assert.throws(() => verifyDependencyScope({ selection: selected, repoRoot: f.source, candidateRoot: f.candidate, config: {} }),
      /Lockfile changed/);
    assert.equal(select({ ...dep, evidence: { metadata_available: false, advisory_checked: true } }).status, 'blocked');
    assert.equal(select({ ...dep, latestVersion: '2.0.0' }).status, 'blocked');
  } finally { f.close(); }
});

test('manifest-only scope excludes new lockfiles, test edits and unrelated changes, including nested packages', () => {
  for (const prefix of ['', 'packages/example']) {
    const f = fixture(prefix);
    try {
      const args = { selection: f.selection, repoRoot: f.source, candidateRoot: f.candidate, config: {} };
      const scope = verifyDependencyScope(args);
      assert.deepEqual(scope.changes, [f.manifest]);
      assert.equal(scope.temporaryLock.path, f.lock);
      assert.match(scope.temporaryLock.command, /--package-lock-only.*--offline.*--ignore-scripts/);
      write(f.candidate, f.lock, f.generatedLock);
      assert.throws(() => verifyDependencyScope(args), /change only the selected manifest/);
      fs.unlinkSync(path.join(f.candidate, f.lock));
      const pkg = read(f.candidate, f.manifest); pkg.scripts.test = 'echo skip';
      write(f.candidate, f.manifest, pkg);
      assert.throws(() => verifyDependencyScope(args), /unrelated manifest fields/);
    } finally { f.close(); }
  }
});

test('temporary lock generation, frozen install and original tests are controller-owned and leave no candidate artifacts', async () => {
  const f = fixture();
  try {
    let disposed = false;
    const calls = [];
    const evidence = await validateDependencyCandidate({
      selection: f.selection, repoRoot: f.source, candidateRoot: f.candidate,
      fetchImpl: cleanAdvisory, sandboxFactory: ({ repoRoot }) => {
        assert.equal(repoRoot, f.candidate);
        return { workspace: f.worker, async run(command) {
          calls.push(command);
          if (calls.length === 1) write(f.worker, f.lock, f.generatedLock);
          return { exit_code: 0 };
        }, dispose() { disposed = true; } };
      }
    });
    assert.ok(disposed);
    assert.equal(evidence.status, 'passed');
    assert.equal(evidence.lockfile.mode, 'temporary');
    assert.equal(evidence.lockfile.published, false);
    assert.match(evidence.lockfile.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(evidence.files.map((file) => file.path), ['package.json']);
    assert.match(calls[1], /npm ci --offline --ignore-scripts.*npm run test/);
    assert.ok(!fs.existsSync(path.join(f.source, f.lock)));
    assert.ok(!fs.existsSync(path.join(f.candidate, f.lock)));
    assert.match(describeChange({ result: { summary: 'Update demo.', dependency_validation: evidence } }), /not published/);
  } finally { f.close(); }
});

test('missing cache, invalid resolution, test failures and changed validation locks cannot pass', async () => {
  for (const scenario of ['cache', 'missing-lock', 'wrong-version', 'root-mismatch', 'tests', 'changed-lock', 'changed-source']) {
    const f = fixture();
    try {
      let calls = 0, disposed = false;
      await assert.rejects(validateDependencyCandidate({
        selection: f.selection, repoRoot: f.source, candidateRoot: f.candidate,
        fetchImpl: cleanAdvisory, sandboxFactory: () => ({ workspace: f.worker, run() {
          calls++;
          if (calls === 1) {
            if (scenario === 'cache') return { exit_code: 1 };
            const lock = structuredClone(f.generatedLock);
            if (scenario === 'wrong-version') lock.packages['node_modules/demo'].version = '1.0.2';
            if (scenario === 'root-mismatch') lock.packages[''].dependencies.demo = '^2.0.0';
            if (scenario !== 'missing-lock') write(f.worker, f.lock, lock);
          } else {
            if (scenario === 'tests') return { exit_code: 1 };
            if (scenario === 'changed-lock') fs.appendFileSync(path.join(f.worker, f.lock), '\n');
            if (scenario === 'changed-source') write(f.worker, f.manifest, {});
          }
          return { exit_code: 0 };
        }, dispose() { disposed = true; } })
      }), /lockfile generation failed|ENOENT|planned version|requirements disagree|validation command failed|Validation modified/i, scenario);
      assert.ok(disposed, scenario);
      assert.ok(!fs.existsSync(path.join(f.candidate, f.lock)));
    } finally { f.close(); }
  }
});

test('major upgrades reach read-only planning, respect deduplication and never become routine executable work', () => {
  const f = fixture();
  try {
    const major = { ...dep, latestVersion: '2.0.0', recommendedAction: 'evaluate-major-bump' };
    const select = (extra = {}) => selectDependencyWork({ report: report([major]), repoRoot: f.source, mode: 'migration-plan', ...extra });
    const result = select();
    assert.equal(result.task, 'dependency-migration-planner');
    assert.equal(result.planning_kind, 'major-upgrade');
    assert.equal(result.tier, 'reasoning');
    assert.equal(select({ openPlans: [result.key] }).status, 'skipped');
    assert.equal(select({ openPrs: [{ files: ['package.json'] }] }).status, 'skipped');
    assert.equal(select({ state: { processed_items: { [result.stateKey]: { attempts: 2 } } } }).status, 'skipped');
    const routine = selectDependencyWork({ report: report([major]), repoRoot: f.source });
    assert.equal(routine.status, 'skipped');
    assert.match(routine.reason, /migration-plan/);
    assert.throws(() => select({ mode: 'migration', planId: 'not-approved' }), /approved_migrations/);
  } finally { f.close(); }
});

test('workflow reports temporary validation and planning issues do not promise unsupported major execution', (t) => {
  const f = fixture();
  t.mock.method(console, 'error', () => {});
  try {
    const summary = path.join(f.root, 'summary.md');
    reportDependencySelection(f.selection, { env: { GITHUB_STEP_SUMMARY: summary } });
    assert.match(fs.readFileSync(summary, 'utf8'), /only the manifest is published/);
    const selection = selectDependencyWork({ repoRoot: f.source, mode: 'migration-plan',
      report: report([{ ...dep, latestVersion: '2.0.0', recommendedAction: 'evaluate-major-bump' }]) });
    let publishedBody;
    publishDependencyStage({ selection, result: { status: 'completed', summary: 'Review the major upgrade.' },
      repoRoot: f.source, base: 'main', stateFile: path.join(f.root, 'state.json'),
      env: { GITHUB_REPOSITORY: 'owner/repo' }, execFileImpl: (cmd, args) => {
        assert.equal(cmd, 'gh');
        if (args[0] === 'issue' && args[1] === 'list') return '[]';
        if (args[0] === 'issue' && args[1] === 'create') {
          publishedBody = fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8');
          return 'https://github.com/owner/repo/issues/1';
        }
        return '';
      } });
    assert.match(publishedBody, /separately reviewed implementation PR/);
    assert.doesNotMatch(publishedBody, /commit.*approved_migrations/);
  } finally { f.close(); }
});

test('failed temporary-lock validation discards model changes and charges the attempt', async () => {
  const f = fixture();
  try {
    const selection = path.join(f.root, 'selection.json');
    write(f.root, 'selection.json', f.selection);
    let turn = 0;
    const candidateFactory = ({ repoRoot }) => {
      const dir = fs.mkdtempSync(path.join(f.root, 'worker-'));
      fs.cpSync(repoRoot, dir, { recursive: true });
      return { workspace: dir, run: () => ({ exit_code: 1 }), apply() { assert.fail('Unverified candidate was exported'); },
        dispose() { fs.rmSync(dir, { recursive: true, force: true }); } };
    };
    const result = await runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source,
      dependencySelectionFile: selection, outputPath: path.join(f.root, 'result.json'),
      stateFile: path.join(f.root, 'state.json'), provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'synthetic' },
      sandboxFactory: candidateFactory, fetchImpl: cleanAdvisory,
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify(++turn === 1
        ? { name: 'write_file', arguments: { path: f.manifest, content: fs.readFileSync(path.join(f.candidate, f.manifest), 'utf8') } }
        : { name: 'finish_task', arguments: { summary: 'Bump demo.', action_taken: 'fix' } }) })
    });

    assert.equal(result.status, 'blocked');
    assert.match(result.dependency_validation.reason, /Temporary npm lockfile generation failed/);
    assert.deepEqual(result.files_changed, []);
    assert.equal(read(f.source, f.manifest).dependencies.demo, '^1.0.0');
    assert.equal(read(f.root, 'state.json').processed_items[f.selection.stateKey].attempts, 1);
  } finally { f.close(); }
});

test('a real offline metadata cache resolves a temporary lock, validates tests and exports only the manifest', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_DOCKER !== 'true', timeout: 180000
}, async () => {
  const f = fixture();
  const build = privateDirectory(path.join(f.root, 'image'));
  const existing = new Set(docker(['image', 'ls', '--quiet', '--no-trunc']).stdout.trim().split(/\s+/));
  let image;
  try {
    fs.writeFileSync(path.join(build, 'prepare.mjs'), `
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
fs.mkdirSync('/workspace/pkg');
fs.writeFileSync('/workspace/pkg/package.json', JSON.stringify({
  name: 'demo', version: '1.0.1', scripts: { prepack: 'exit 9', postinstall: 'exit 9' }
}));
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--json', '--offline', '--ignore-scripts',
  '--pack-destination', '/workspace'], { cwd: '/workspace/pkg', encoding: 'utf8' }));
const tar = fs.readFileSync('/workspace/' + packed.filename);
const server = http.createServer((req, res) => {
  if (req.url === '/demo') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ name: 'demo', 'dist-tags': { latest: '1.0.1' },
      versions: { '1.0.1': { name: 'demo', version: '1.0.1', scripts: { postinstall: 'exit 9' },
        dist: { integrity: packed.integrity, tarball: 'http://127.0.0.1:18765/demo.tgz' } } } }));
  } else if (req.url === '/demo.tgz') res.end(tar);
  else { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(18765, '127.0.0.1', resolve));
try {
  const child = spawn('npm', ['cache', 'add', 'demo@1.0.1', '--ignore-scripts', '--no-audit', '--no-fund',
    '--cache', '/workspace/cache', '--registry', 'http://127.0.0.1:18765'], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error('Synthetic cache preparation failed');
} finally { server.close(); }
`);
    docker(['run', '--rm', ...restrictions(), ...mount(build, '/workspace'),
      '--env', 'HOME=/tmp', '--entrypoint', 'node', NODE_IMAGE, '/workspace/prepare.mjs'], { timeout: 120000 });
    fs.writeFileSync(path.join(build, 'npm.sh'),
      '#!/bin/sh\nset -eu\nif [ ! -d /tmp/npm-cache ]; then cp -R /opt/npm-cache /tmp/npm-cache; fi\n' +
      'export npm_config_cache=/tmp/npm-cache\nexport npm_config_registry=http://127.0.0.1:18765\n' +
      'exec node /usr/local/lib/node_modules/npm/bin/npm-cli.js "$@"\n');
    fs.writeFileSync(path.join(build, 'Dockerfile'), `FROM ${NODE_IMAGE}
COPY cache/_cacache /opt/npm-cache/_cacache
COPY npm.sh /opt/npm.sh
RUN chmod -R a+rX /opt/npm-cache && chmod 755 /opt/npm.sh && rm /usr/local/bin/npm && ln -s /opt/npm.sh /usr/local/bin/npm
`);
    const imageFile = path.join(f.root, 'image-id');
    docker(['build', '--pull=false', '--network=none', '--iidfile', imageFile, build], { timeout: 120000 });
    image = fs.readFileSync(imageFile, 'utf8').trim();
    const verify = `node -e 'const a=require("assert/strict");a.equal(require("demo/package.json").version,"1.0.1");a.equal(process.env.GITHUB_TOKEN,undefined);a.ok(Object.values(require("os").networkInterfaces()).flat().every(i=>i.internal));'`;
    for (const dir of [f.source, f.candidate]) {
      const pkg = read(dir, f.manifest); pkg.scripts.test = verify; write(dir, f.manifest, pkg);
    }
    const selection = selectDependencyWork({ repoRoot: f.source, report: report() });
    const passed = await validateDependencyCandidate({
      selection, repoRoot: f.source, candidateRoot: f.candidate, image, fetchImpl: cleanAdvisory
    });
    assert.equal(passed.status, 'passed');
    assert.equal(passed.checks.length, 2);
    assert.equal(passed.lockfile.mode, 'temporary');
    assert.deepEqual(passed.files.map((file) => file.path), ['package.json']);
    assert.ok(!fs.existsSync(path.join(f.candidate, f.lock)));
    let postedBody;
    const published = publishDependencyStage({ selection, result: {
      status: 'completed', summary: 'Update demo from the declared ^1.0.0 to ^1.0.1.', dependency_validation: passed
    }, repoRoot: f.candidate, base: 'main', env: { GITHUB_REPOSITORY: 'owner/repo' }, execFileImpl: (cmd, args) => {
      if (cmd === 'git') {
        if (args[0] === 'diff') return 'package.json\0';
        if (args[0] === 'ls-files') return '';
        if (args[0] === 'add') assert.deepEqual(args, ['add', '--', 'package.json']);
        return '';
      }
      if (args[0] === 'pr' && args[1] === 'list') return '[]';
      if (args[0] === 'pr' && args[1] === 'create') {
        postedBody = args[args.indexOf('--body') + 1];
        return 'https://github.com/owner/repo/pull/1';
      }
      return '';
    } });
    assert.equal(published.published, true);
    assert.match(postedBody, /only the manifest is published/);
    write(f.root, 'selection.json', selection);
    let turn = 0;
    const result = await runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source,
      dependencySelectionFile: path.join(f.root, 'selection.json'), outputPath: path.join(f.root, 'result.json'),
      stateFile: path.join(f.root, 'state.json'), provider: 'copilot',
      env: { COPILOT_GITHUB_TOKEN: 'synthetic', LIGHTS_ON_SANDBOX_IMAGE: image },
      fetchImpl: cleanAdvisory, sandboxFactory: createAgentSandbox,
      spawnImpl: () => ({ status: 0, stdout: JSON.stringify(++turn === 1
        ? { name: 'write_file', arguments: { path: f.manifest, content: fs.readFileSync(path.join(f.candidate, f.manifest), 'utf8') } }
        : { name: 'finish_task', arguments: { summary: 'Update demo.', action_taken: 'fix' } }) })
    });
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.files_changed, ['package.json']);
    assert.equal(read(f.source, f.manifest).dependencies.demo, '^1.0.1');
    assert.ok(!fs.existsSync(path.join(f.source, f.lock)));
  } finally {
    if (image && !existing.has(image)) docker(['image', 'rm', image], { allowFailure: true });
    f.close();
  }
});
