import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';
import { selectDependencyWork, dependencyKey, approvedMigration, verifyDependencyScope,
  validateDependencyCandidate } from '../.github/lights-on/runner/dependency-work.mjs';
import { prepareDependencyStage, publishDependencyStage } from '../.github/lights-on/runner/dependency-stage.mjs';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { scanRepositoryDependencies } from '../.github/lights-on/runner/scan-dependencies.mjs';
import { loadState } from '../.github/lights-on/runner/state-store.mjs';

globalThis.fetch = async () => { throw new Error('Unexpected live fetch'); };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.now();
const writeJson = (dir, file, value) => fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
const readJson = (dir, file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
const dep = { name: 'demo', ecosystem: 'npm', manifest: 'package.json', versionSpec: '^1.0.0', resolvedVersion: '1.0.0',
  latestVersion: '1.0.1', recommendedAction: 'bump-minor-or-patch', flags: { vulnerable: false }, cves: [],
  evidence: { metadata_available: true, advisory_checked: true } };
const report = (dependencies = [dep]) => ({ scannedAt: new Date(now).toISOString(), dependencies, downstreamDependents: {} });
const config = loadConfig(ROOT, {});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-dependency-'));
  const source = path.join(root, 'source');
  const candidate = path.join(root, 'candidate');
  fs.mkdirSync(source); fs.mkdirSync(candidate);
  const pkg = { name: 'test-package', version: '1.0.0', dependencies: { demo: '^1.0.0' },
    scripts: { test: 'node -e "if(require(\'demo/package.json\').version !== \'1.0.1\')process.exit(1)"' } };
  const lock = { name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: {
    '': { name: pkg.name, version: pkg.version, dependencies: pkg.dependencies },
    'node_modules/demo': { version: '1.0.0' } } };
  writeJson(source, 'package.json', pkg); writeJson(source, 'package-lock.json', lock);
  fs.cpSync(source, candidate, { recursive: true });
  const next = structuredClone(pkg); next.dependencies.demo = '^1.0.1';
  const nextLock = structuredClone(lock); nextLock.packages[''].dependencies.demo = '^1.0.1';
  nextLock.packages['node_modules/demo'].version = '1.0.1';
  writeJson(candidate, 'package.json', next); writeJson(candidate, 'package-lock.json', nextLock);
  const selection = selectDependencyWork({ report: report(), repoRoot: source, config, now });
  return { root, source, candidate, selection, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const cleanAdvisory = async () => ({ ok: true, json: async () => ({}) });

describe('Dependency stage selection and scan evidence', () => {
  it('selects one deterministic routine update and defers security fixes/migrations', () => {
    const f = fixture();
    try {
      const selected = selectDependencyWork({ report: report([
        { ...dep, name: 'old', recommendedAction: 'migrate' },
        { ...dep, name: 'vulnerable', recommendedAction: 'security-bump' }, dep
      ]), repoRoot: f.source, config, now });
      assert.equal(selected.status, 'ready');
      assert.equal(selected.task, 'dependency-updater');
      assert.equal(selected.tier, 'default');
      assert.equal(selected.key, dependencyKey(dep));
      assert.equal(selected.deferred.find((d) => d.action === 'security-bump').route, 'Step C');
      assert.equal(selected.deferred.find((d) => d.action === 'migrate').route, 'migration-plan');
    } finally { f.cleanup(); }
  });

  it('deduplicates open manifest PRs, honors cooldowns/attempts, and detects stale input', () => {
    const f = fixture();
    try {
      const args = { report: report(), repoRoot: f.source, config, now };
      assert.equal(selectDependencyWork({ ...args, openPrs: [{ files: ['package.json'] }] }).status, 'skipped');
      assert.equal(selectDependencyWork({ ...args, state: { cooldowns: {
        [dependencyKey(dep)]: { expires_at: new Date(now + 3600000).toISOString() } } } }).status, 'skipped');
      assert.equal(selectDependencyWork({ ...args, state: { processed_items: {
        [dependencyKey(dep)]: { attempts: 2 } } } }).status, 'skipped');
      assert.equal(selectDependencyWork({ ...args, mode: 'migration-plan',
        report: report([{ ...dep, recommendedAction: 'migrate' }]), openPlans: [dependencyKey(dep)] }).status, 'skipped');
      assert.equal(selectDependencyWork({ ...args, report: { ...report(), scannedAt: '2020-01-01' } }).status, 'blocked');
      writeJson(f.source, 'package.json', { dependencies: { demo: '^1.0.2' } });
      assert.equal(selectDependencyWork(args).status, 'blocked');
    } finally { f.cleanup(); }
  });

  it('blocks missing evidence, unsupported lockfiles and ecosystems before inference', () => {
    const f = fixture();
    try {
      const select = (d = dep) => selectDependencyWork({ report: report([d]), repoRoot: f.source, config, now });
      assert.equal(select({ ...dep, evidence: { advisory_checked: false, metadata_available: true } }).status, 'blocked');
      assert.equal(select({ ...dep, latestVersion: '2.0.0' }).status, 'blocked');
      assert.equal(select({ ...dep, latestVersion: '1.1.0-beta' }).status, 'blocked');
      fs.writeFileSync(path.join(f.source, 'yarn.lock'), 'alternate package manager');
      assert.equal(select().status, 'blocked');
      fs.unlinkSync(path.join(f.source, 'yarn.lock'));
      fs.unlinkSync(path.join(f.source, 'package-lock.json'));
      assert.equal(select().status, 'blocked');
      fs.writeFileSync(path.join(f.source, 'requirements.txt'), 'demo==1.0.0');
      const python = { ...dep, ecosystem: 'pypi', manifest: 'requirements.txt', versionSpec: '==1.0.0' };
      assert.equal(select(python).status, 'blocked');
    } finally { f.cleanup(); }
  });

  it('marks unavailable OSV responses as missing rather than no vulnerabilities', async () => {
    const f = fixture();
    try {
      const scan = await scanRepositoryDependencies({ repoRoot: f.source, config, fetchImpl: async (url) =>
        url.includes('osv.dev') ? { ok: false } : { ok: true, json: async () => ({ latest_release_number: '1.0.1' }) } });
      assert.equal(scan.dependencies[0].evidence.advisory_checked, false);
      assert.equal(scan.dependencies[0].evidence.metadata_available, true);
      const offline = await scanRepositoryDependencies({ repoRoot: f.source, config, offline: true });
      assert.equal(offline.dependencies[0].evidence.advisory_checked, false);
      assert.equal(offline.dependencies[0].evidence.metadata_available, false);
    } finally { f.cleanup(); }
  });

  it('fetches open PRs and changed manifests in the installed repository and fails on lookup errors', () => {
    const f = fixture();
    try {
      const selected = prepareDependencyStage({ report: report(), repoRoot: f.source, config, env: { GITHUB_REPOSITORY: 'owner/repo' },
        state: {}, execFileImpl: (_cmd, args) => {
          assert.ok(args.includes('--paginate')); assert.ok(args.includes('--slurp'));
          assert.match(args.at(-1), /^repos\/owner\/repo\//);
          return JSON.stringify(args.at(-1).includes('/files') ? [[{ filename: 'package.json' }]] : [[{ number: 1, head: { ref: 'security-fix' } }]]);
        } });
      assert.equal(selected.status, 'skipped');
      assert.throws(() => prepareDependencyStage({ report: report(), repoRoot: f.source,
        env: { GITHUB_REPOSITORY: 'owner/repo' }, execFileImpl: () => { throw new Error('lookup denied'); } }), /lookup denied/);
    } finally { f.cleanup(); }
  });
});

describe('Dependency candidate validation and publication', () => {
  it('requires only the selected manifest requirement and matching lockfile to change', () => {
    const f = fixture();
    try {
      const args = { selection: f.selection, repoRoot: f.source, candidateRoot: f.candidate, config };
      assert.deepEqual(verifyDependencyScope(args).changes.sort(), ['package-lock.json', 'package.json']);
      const pkg = readJson(f.candidate, 'package.json');
      pkg.scripts.test = 'echo fake success';
      writeJson(f.candidate, 'package.json', pkg);
      assert.throws(() => verifyDependencyScope(args), /unrelated manifest/);
      pkg.scripts = readJson(f.source, 'package.json').scripts;
      writeJson(f.candidate, 'package.json', pkg);
      fs.writeFileSync(path.join(f.candidate, 'unrelated.txt'), 'not allowed');
      assert.throws(() => verifyDependencyScope(args), /only the selected/);
      fs.unlinkSync(path.join(f.candidate, 'unrelated.txt'));
      const lock = readJson(f.candidate, 'package-lock.json');
      lock.packages['node_modules/demo'].version = '1.0.0';
      writeJson(f.candidate, 'package-lock.json', lock);
      assert.throws(() => verifyDependencyScope(args), /does not resolve/);
    } finally { f.cleanup(); }
  });

  it('runs independent offline install/resolution/tests and rejects failures or source mutation', async () => {
    const f = fixture();
    try {
      const args = { selection: f.selection, repoRoot: f.source, candidateRoot: f.candidate, config, fetchImpl: cleanAdvisory };
      let commands = [];
      const sandboxFactory = ({ repoRoot }) => {
        assert.equal(repoRoot, f.candidate);
        return { workspace: f.candidate, run: (command) => { commands.push(command); return { exit_code: 0 }; }, dispose() {} };
      };
      const validation = await validateDependencyCandidate({ ...args, sandboxFactory });
      assert.equal(validation.status, 'passed');
      assert.match(commands[0], /npm ci --offline --ignore-scripts/);
      assert.match(commands[0], /node_modules/);
      assert.match(commands[0], /npm run test/);
      await assert.rejects(validateDependencyCandidate({ ...args, sandboxFactory: () =>
        ({ workspace: f.candidate, run: () => ({ exit_code: 1 }), dispose() {} }) }), /validation command failed/);
      commands = [];
      await assert.rejects(validateDependencyCandidate({ ...args, sandboxFactory, fetchImpl: async () => ({ ok: false }) }), /advisory lookup failed/);
      assert.equal(commands.length, 0);
      await assert.rejects(validateDependencyCandidate({ ...args, sandboxFactory,
        fetchImpl: async () => ({ ok: true, json: async () => ({ vulns: [{ id: 'known' }] }) }) }), /known vulnerabilities/);
      const altered = path.join(f.root, 'altered-validation');
      fs.cpSync(f.candidate, altered, { recursive: true });
      await assert.rejects(validateDependencyCandidate({ ...args, sandboxFactory: () => ({
        workspace: altered, run: () => {
          fs.writeFileSync(path.join(altered, 'package.json'), '{}');
          return { exit_code: 0 };
        }, dispose() {}
      }) }), /Validation modified candidate source/);
    } finally { f.cleanup(); }
  });

  it('returns an explicit blocker and does not export unverified model changes', async () => {
    const f = fixture();
    try {
      const selectionPath = path.join(f.root, 'selection.json');
      writeJson(f.root, 'selection.json', f.selection);
      let turn = 0;
      const result = await runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source,
        dependencySelectionFile: selectionPath, stateFile: path.join(f.root, 'state.json'), outputPath: path.join(f.root, 'result.json'),
        provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake' }, spawnImpl: () => ({
          status: 0, stdout: JSON.stringify(++turn === 1
            ? { name: 'write_file', arguments: { path: 'package.json', content: fs.readFileSync(path.join(f.candidate, 'package.json'), 'utf8') } }
            : { name: 'finish_task', arguments: { summary: 'claimed safe', action_taken: 'opened_pr' } })
        }) });
      assert.equal(result.status, 'blocked');
      assert.equal(result.dependency_validation.status, 'blocked');
      assert.deepEqual(result.files_changed, []);
      assert.equal(readJson(f.source, 'package.json').dependencies.demo, '^1.0.0');
      assert.equal(loadState({ stateFile: path.join(f.root, 'state.json') }).processed_items[f.selection.stateKey].attempts, 1);
      await assert.rejects(runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source, env: {} }), /trusted dependency selection/);
    } finally { f.cleanup(); }
  });

  it('publishes a blocker instead of code without controller evidence and deduplicates it', () => {
    const f = fixture();
    try {
      let body;
      const calls = [];
      const args = { selection: f.selection, result: { status: 'completed', summary: 'model said safe' },
        repoRoot: f.candidate, base: 'main', stateFile: path.join(f.root, 'state.json'), env: { GITHUB_REPOSITORY: 'owner/repo' },
        execFileImpl: (cmd, options) => {
          calls.push([cmd, ...options]);
          assert.equal(cmd, 'gh');
          if (options[0] === 'issue' && options[1] === 'list') return body ? JSON.stringify([
            { number: 1, author: { login: 'github-actions[bot]' }, body }
          ]) : '[]';
          if (options[0] === 'issue') {
            body = fs.readFileSync(options[options.indexOf('--body-file') + 1], 'utf8');
            return 'https://github.com/owner/repo/issues/1';
          }
          return '';
        } };
      assert.equal(publishDependencyStage(args).published, false);
      assert.match(body, /Missing controller validation/);
      assert.equal(publishDependencyStage(args).published, false);
      assert.equal(calls.filter((c) => c[1] === 'issue' && c[2] === 'create').length, 1);
      assert.equal(calls.some((c) => c[0] === 'git' || c[1] === 'pr'), false);
    } finally { f.cleanup(); }
  });

  it('caps dependency model turns separately and does not spend on fallback providers', async () => {
    const f = fixture();
    try {
      writeJson(f.root, 'selection.json', f.selection);
      fs.writeFileSync(path.join(f.root, 'config.yml'),
        'dependencies:\n  update_max_turns: 2\nengine:\n  fallback_providers: [claude]\n');
      let calls = 0;
      const result = await runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source,
        configPath: path.join(f.root, 'config.yml'), dependencySelectionFile: path.join(f.root, 'selection.json'),
        stateFile: path.join(f.root, 'state.json'), outputPath: path.join(f.root, 'result.json'),
        provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake', ANTHROPIC_API_KEY: 'fake' },
        spawnImpl: () => { calls++; return { status: 0, stdout: JSON.stringify({ name: 'read_file', arguments: { path: 'package.json' } }) }; } });
      assert.equal(calls, 2);
      assert.equal(result.status, 'failed');
      assert.equal(result.execution.stop_reason, 'max_turns');
      assert.equal(result.provider, 'copilot');
    } finally { f.cleanup(); }
  });

  it('validates a real frozen npm install and tests in a credential-free Docker worker', {
    skip: process.env.LIGHTS_ON_TEST_DOCKER !== 'true', timeout: 180000
  }, async () => {
    const f = fixture();
    try {
      const tarSource = path.join(f.root, 'tar-source'); fs.mkdirSync(tarSource);
      writeJson(tarSource, 'package.json', { name: 'demo', version: '1.0.1' });
      for (const dir of [f.source, f.candidate]) fs.mkdirSync(path.join(dir, 'fixtures'));
      execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', path.join(f.source, 'fixtures')],
        { cwd: tarSource, env: { PATH: process.env.PATH, HOME: f.root, NPM_CONFIG_UPDATE_NOTIFIER: 'false' }, stdio: 'pipe' });
      fs.copyFileSync(path.join(f.source, 'fixtures', 'demo-1.0.1.tgz'), path.join(f.candidate, 'fixtures', 'demo-1.0.1.tgz'));
      const lock = readJson(f.candidate, 'package-lock.json');
      lock.packages['node_modules/demo'].resolved = 'file:fixtures/demo-1.0.1.tgz';
      writeJson(f.candidate, 'package-lock.json', lock);
      const validation = await validateDependencyCandidate({ selection: f.selection, repoRoot: f.source,
        candidateRoot: f.candidate, config, fetchImpl: cleanAdvisory });
      assert.equal(validation.status, 'passed');
      assert.equal(validation.checks[0].exit_code, 0);
      assert.equal(fs.existsSync(path.join(f.candidate, 'node_modules')), false, 'Validation artifacts stay in the separate worker.');
      writeJson(f.root, 'selection.json', f.selection);
      let turn = 0;
      const actions = ['package.json', 'package-lock.json'].map((file) => ({ name: 'write_file',
        arguments: { path: file, content: fs.readFileSync(path.join(f.candidate, file), 'utf8') } }));
      actions.push({ name: 'finish_task', arguments: { summary: 'update candidate', action_taken: 'opened_pr' } });
      const result = await runAgent({ task: 'dependency-updater', repoRoot: ROOT, workingDir: f.source,
        dependencySelectionFile: path.join(f.root, 'selection.json'), stateFile: path.join(f.root, 'state.json'),
        outputPath: path.join(f.root, 'result.json'), provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake' },
        fetchImpl: cleanAdvisory,
        spawnImpl: () => ({ status: 0, stdout: JSON.stringify(actions[turn++]) }) });
      assert.equal(result.status, 'completed');
      assert.equal(result.dependency_validation.status, 'passed');
      assert.equal(readJson(f.source, 'package-lock.json').packages['node_modules/demo'].version, '1.0.1');
      assert.deepEqual(result.files_changed.sort(), ['package-lock.json', 'package.json']);
    } finally { f.cleanup(); }
  });
});

describe('Separate migration planning and execution', () => {
  const plan = { id: 'replace-demo', name: 'demo', ecosystem: 'npm', manifest: 'package.json',
    replacement: { name: 'stdlib' }, plan: 'Remove unused demo; preserve exports and add parity tests.',
    allowed_files: ['package.json', 'package-lock.json', 'test.js'],
    validation_commands: ['npm ci --offline --ignore-scripts && npm test && echo \'{"resolved":[]}\' > dependency-validation.json'] };
  it('requires an explicit trusted plan and never authorizes protected-file edits', () => {
    assert.throws(() => approvedMigration(config, plan.id), /requires a unique/);
    const approved = { ...config, dependencies: { ...config.dependencies, approved_migrations: [plan] } };
    assert.deepEqual(approvedMigration(approved, plan.id), plan);
    assert.throws(() => approvedMigration({ dependencies: { approved_migrations: [{ ...plan, allowed_files: ['THREAT_MODEL.md'] }] } }, plan.id), /protected files/);
    const f = fixture();
    try {
      assert.equal(selectDependencyWork({ report: report([{ ...dep, recommendedAction: 'migrate' }]),
        repoRoot: f.source, config, mode: 'migration-plan', now }).task, 'dependency-migration-planner');
      const execution = selectDependencyWork({ report: report(), repoRoot: f.source, config: approved, mode: 'migration', planId: plan.id, now });
      assert.equal(execution.task, 'dependency-migrator');
      assert.deepEqual(execution.plan, plan);
      assert.notEqual(execution.stateKey, dependencyKey(dep));
    } finally { f.cleanup(); }
  });

  it('migration planner and legacy alias cannot execute commands or export files', async () => {
    const f = fixture();
    try {
      for (const task of ['dependency-migration-planner', 'dependency-maintainer']) {
        let turn = 0;
        const result = await runAgent({ task, repoRoot: ROOT, workingDir: f.source, stateFile: path.join(f.root, 'state.json'),
          outputPath: path.join(f.root, 'result.json'), provider: 'copilot', env: { COPILOT_GITHUB_TOKEN: 'fake' },
          spawnImpl: (_cmd, _args, options) => {
            turn++;
            if (turn === 3) assert.match(options.input, /disabled in read-only/);
            return { status: 0, stdout: JSON.stringify(turn === 1
              ? { name: 'write_file', arguments: { path: 'package.json', content: 'bad' } }
              : turn === 2 ? { name: 'run_command', arguments: { command: 'echo should-not-run' } }
                : { name: 'finish_task', arguments: { summary: 'plan', action_taken: 'migration_plan', comment_body: 'Review this plan.' } }) };
          } });
        assert.equal(result.task, 'dependency-migration-planner');
        assert.deepEqual(result.files_changed, []);
        assert.equal(readJson(f.source, 'package.json').dependencies.demo, '^1.0.0');
      }
    } finally { f.cleanup(); }
  });

  it('validates approved migration file scope, lock updates and replacement-resolution evidence', async () => {
    const f = fixture();
    try {
      const approved = { ...config, dependencies: { ...config.dependencies, approved_migrations: [plan] } };
      const selection = selectDependencyWork({ report: report(), repoRoot: f.source, config: approved,
        mode: 'migration', planId: plan.id, now });
      const pkg = readJson(f.candidate, 'package.json'); delete pkg.dependencies.demo;
      const lock = readJson(f.candidate, 'package-lock.json'); delete lock.packages[''].dependencies.demo; delete lock.packages['node_modules/demo'];
      writeJson(f.candidate, 'package.json', pkg); writeJson(f.candidate, 'package-lock.json', lock);
      const validationRoot = path.join(f.root, 'validation');
      fs.cpSync(f.candidate, validationRoot, { recursive: true });
      const args = { selection, repoRoot: f.source, candidateRoot: f.candidate, config: approved, fetchImpl: cleanAdvisory };
      await assert.rejects(validateDependencyCandidate({ ...args, sandboxFactory: () => ({
        workspace: validationRoot, run: () => ({ exit_code: 0 }), dispose() {}
      }) }), /dependency-validation.json/);
      const passed = await validateDependencyCandidate({ ...args, sandboxFactory: () => ({
        workspace: validationRoot, run: (command) => {
          assert.equal(command, plan.validation_commands[0]);
          writeJson(validationRoot, 'dependency-validation.json', { resolved: [] });
          return { exit_code: 0 };
        }, dispose() {}
      }) });
      assert.equal(passed.status, 'passed');
      fs.writeFileSync(path.join(f.candidate, 'unapproved.js'), 'bad scope');
      assert.throws(() => verifyDependencyScope(args), /outside its approved plan/);
      fs.unlinkSync(path.join(f.candidate, 'unapproved.js'));
      await assert.rejects(validateDependencyCandidate({ ...args, config }), /requires a unique/);
      const replacementPlan = { ...plan, replacement: { name: 'replacement', version: '1.0.0' } };
      const replacementConfig = { ...approved, dependencies: { ...approved.dependencies, approved_migrations: [replacementPlan] } };
      assert.throws(() => verifyDependencyScope({ ...args, selection: { ...selection, plan: replacementPlan },
        config: replacementConfig }), /approved replacement version/);
    } finally { f.cleanup(); }
  });

  it('uses sequential stage labels and separate migration choices without a blanket diff publisher', () => {
    const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lights-on-schedule.yml'), 'utf8');
    const stages = [...workflow.matchAll(/^\s+- name: Step ([0A-I])\b/gm)].map((match) => match[1]);
    assert.deepEqual(stages, ['0', 'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    assert.doesNotMatch(workflow, /name: Step [A-I](?:[1-9]|\s+\([1-9]\))/);
    const start = workflow.indexOf('name: Step D ');
    const end = workflow.indexOf('name: Step G ');
    assert.ok(start >= 0 && end > start);
    const dependencyStages = workflow.slice(start, end);
    assert.ok(dependencyStages.indexOf('dependency-stage.mjs --select') < dependencyStages.indexOf('uses: $/.github/actions/lights-on-agent'));
    assert.ok(dependencyStages.includes('dependency_selection_file: /tmp/lights-on-dependency-selection.json'));
    assert.ok(dependencyStages.includes('dependency-stage.mjs --publish'));
    assert.ok(!dependencyStages.includes('git add -A'));
    assert.ok(workflow.includes("inputs.task != 'migration' || github.ref_name == github.event.repository.default_branch"));
    const events = parseSimpleYaml(workflow.split(/^concurrency:/m)[0]).on;
    assert.ok(events.workflow_dispatch.inputs.task.options.includes('migration-plan'));
    assert.ok(events.workflow_dispatch.inputs.task.options.includes('migration'));
    assert.equal(events.workflow_dispatch.inputs.migration_plan.type, 'string');
    const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    const example = readme.split('For example, an approved internal migration')[1].split('```yaml')[1].split('```')[0];
    assert.equal(approvedMigration(parseSimpleYaml(example), 'remove-unused-helper').replacement.name, 'stdlib');
  });
});
