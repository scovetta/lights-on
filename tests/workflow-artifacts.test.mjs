import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ensureThreatModelSkills } from '../.github/lights-on/runner/ensure-threat-model.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(ROOT, '.github', file), 'utf8').replace(/\r\n/g, '\n');
const steps = (file) => read(`workflows/${file}`).split(/^      - name: /m).slice(1)
  .map((source) => ({ name: source.split('\n')[0], source }));
const field = (step, key) => step.source.match(new RegExp(`^        ${key}: (.*)$`, 'm'))?.[1];
function condition(step, values) {
  let expression = step.source.match(/^        if: >-\n((?:          .*\n)+)/m)?.[1].trim()
    || field(step, 'if') || 'true';
  expression = expression.replace(/\b(?:steps\.[\w-]+\.(?:outputs\.[\w-]+|outcome)|inputs\.[\w-]+)\b/g,
    (key) => JSON.stringify(values[key] ?? ''));
  return Boolean(new Function(`return (${expression});`)());
}
const fixture = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-artifacts-'));

test('every scheduled context/event/selection input has an earlier producer in every task lane', () => {
  const pipeline = steps('lights-on-schedule.yml');
  const producers = {
    '${{ steps.upstream-sync.outputs.context_file }}': 'Step 0',
    '/tmp/lights-on-deps.json': 'Step B',
    '/tmp/lights-on-actionable-issues.json': 'Fetch open actionable issues',
    '/tmp/lights-on-dependency-selection.json': 'Step D'
  };
  let inputs = 0;
  for (const [index, step] of pipeline.entries()) {
    if (!step.source.includes('uses: $/.github/actions/lights-on-agent')) continue;
    const files = [...step.source.matchAll(/^          (?:context_file|event_file|dependency_selection_file): (.+)$/gm)];
    inputs += files.length;
    for (const [, file] of files) {
      assert.ok(producers[file], `Unknown input contract: ${file}`);
      const before = pipeline.findIndex((producer) => producer.name.startsWith(producers[file]));
      assert.ok(before >= 0 && before < index, file);
      for (const task of ['', 'all', 'bootstrap', 'docs', 'issues', 'security', 'dependencies', 'migration-plan', 'migration', 'toolchains', 'release', 'upstream']) {
        for (const enabled of ['true', 'false']) for (const exists of ['true', 'false']) {
          for (const ready of ['true', 'false']) for (const count of ['', '0', '2']) {
            const values = { 'inputs.task': task, 'steps.config.outputs.enabled': enabled,
              'steps.threat-model-check.outputs.exists': exists, 'steps.dependency-selection.outputs.ready': ready,
              'steps.actionable-issues.outputs.count': count };
            for (const earlier of pipeline.slice(0, index)) {
              const id = field(earlier, 'id');
              if (id && !condition(earlier, values)) {
                for (const key of Object.keys(values)) if (key.startsWith(`steps.${id}.outputs.`)) values[key] = '';
              }
            }
            if (condition(step, values)) assert.ok(condition(pipeline[before], values), `${step.name}: ${task}: ${file}`);
          }
        }
      }
    }
  }
  assert.equal(inputs, 6);
});

test('event and PR input consumers cannot run before their guarded producers', () => {
  const events = steps('lights-on-events.yml');
  const authorize = events.find((s) => field(s, 'id') === 'authorize');
  const agent = events.find((s) => field(s, 'id') === 'agent');
  assert.match(authorize.source, /writeFileSync\('\/tmp\/lights-on-event\.json'/);
  assert.ok(events.indexOf(authorize) < events.indexOf(agent));
  for (const enabled of ['true', 'false']) for (const allowed of ['true', 'false', '']) {
    const values = { 'steps.config.outputs.enabled': enabled, 'steps.authorize.outputs.should_run_agent': allowed };
    if (condition(agent, values)) assert.ok(condition(authorize, values));
  }
  const prs = steps('lights-on-pr.yml');
  const metadata = prs.find((s) => field(s, 'id') === 'pr-data');
  const scan = prs.find((s) => s.name === 'Scan dependencies and downstream ecosystem dependents');
  const review = prs.find((s) => field(s, 'id') === 'review-agent');
  for (const file of ['pr.json', 'pr-files.json', 'pr.diff']) assert.ok(metadata.source.includes(`writeFileSync('/tmp/${file}'`));
  assert.match(scan.source, /--output \/tmp\/lights-on-deps\.json/);
  for (const hasPr of ['', 'true', 'false']) for (const safe of ['true', 'false']) {
    const values = { 'steps.config.outputs.enabled': 'true', 'steps.pr-data.outputs.has_pr': hasPr,
      'steps.pr-data.outputs.needs_review': 'true', 'steps.preflight.outputs.safeToReview': safe };
    if (condition(review, values)) {
      assert.ok(condition(metadata, values) && condition(scan, values));
      assert.ok(prs.indexOf(metadata) < prs.indexOf(scan) && prs.indexOf(scan) < prs.indexOf(review));
    }
  }
  const gate = prs.find((s) => field(s, 'id') === 'merge-gate');
  assert.match(gate.source, /REVIEW_RESULT_FILE: \$\{\{ steps\.review-agent\.outputs\.result_file \}\}/);
  assert.match(gate.source, /if \[ -n "\$REVIEW_RESULT_FILE" \]/);
});

test('scheduled source publishers require a completed result from their own agent', () => {
  const pipeline = steps('lights-on-schedule.yml');
  for (const [prefix, id] of [
    ['Open PR for THREAT_MODEL', 'bootstrap-agent'], ['Open Security Remediation', 'security-agent'],
    ['Open Documentation Clarification', 'docs-agent'], ['Open Actionable Issue Fix', 'issues-agent']
  ]) {
    const publisher = pipeline.find((step) => step.name.startsWith(prefix));
    for (const status of ['', 'skipped', 'blocked', 'failed', 'completed']) {
      assert.equal(condition(publisher, {
        'steps.config.outputs.enabled': 'true', 'inputs.task': 'all',
        'steps.threat-model-check.outputs.exists': 'false', [`steps.${id}.outputs.status`]: status
      }), status === 'completed', `${prefix}: ${status}`);
    }
  }
  const agent = pipeline.find((step) => field(step, 'id') === 'issues-agent');
  for (const count of ['', '0']) assert.equal(condition(agent, {
    'steps.config.outputs.enabled': 'true', 'inputs.task': 'issues', 'steps.actionable-issues.outputs.count': count
  }), false);
});

test('bootstrap always prepares its skill and incomplete skill caches fail at preparation', () => {
  const action = read('actions/lights-on-agent/action.yml');
  const install = action.split('    - name: Install alpha-omega-security/threat-model skills')[1].split('    - name:')[0];
  assert.match(install, /inputs\.task == 'bootstrap-threat-model' \|\| inputs\.install_threat_model_skills == 'true'/);
  const root = fixture();
  try {
    const cache = path.join(root, 'cache');
    fs.mkdirSync(path.join(cache, 'skills', 'threat-model'), { recursive: true });
    const options = { cacheDir: cache, repoRoot: root, installToWorkspace: false,
      execSyncImpl: () => assert.fail('Do not clone over a partial cache') };
    assert.throws(() => ensureThreatModelSkills(options), /cache is incomplete/);
    fs.mkdirSync(path.join(cache, 'skills', 'threat-model', 'SKILL.md'));
    assert.throws(() => ensureThreatModelSkills(options), /cache is incomplete/);
    fs.rmdirSync(path.join(cache, 'skills', 'threat-model', 'SKILL.md'));
    fs.writeFileSync(path.join(cache, 'skills', 'threat-model', 'SKILL.md'), '# fixture');
    assert.equal(ensureThreatModelSkills(options).ok, true);
    assert.equal(ensureThreatModelSkills(options).newThreatModelScript, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a disabled composite run still produces the structured result it advertises', { skip: process.platform === 'win32' }, () => {
  const root = fixture();
  try {
    const action = read('actions/lights-on-agent/action.yml');
    const script = action.split('      run: |\n').at(-1).replace(/^        /gm, '');
    const resultFile = path.join(root, 'result.json'), githubOutput = path.join(root, 'github-output');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: ROOT, encoding: 'utf8', timeout: 15000,
      env: { PATH: process.env.PATH, HOME: root, LIGHTS_ON_ENABLED: 'false',
        INPUT_TASK: 'bootstrap-threat-model', INPUT_TIER: 'default', INPUT_OUTPUT_FILE: resultFile,
        INPUT_CONTEXT_FILE: path.join(root, 'missing-context.json'), GITHUB_OUTPUT: githubOutput }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(fs.readFileSync(resultFile)).status, 'skipped');
    assert.match(fs.readFileSync(githubOutput, 'utf8'), /status=skipped/);
    assert.ok(fs.readFileSync(githubOutput, 'utf8').includes(`result_file=${resultFile}`));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('publishers surface a missing promised result instead of reporting a successful skip', () => {
  for (const [file, prefix] of [
    ['lights-on-events.yml', 'Apply Triage'], ['lights-on-pr.yml', 'Post structured']
  ]) {
    const step = steps(file).find((s) => s.name.startsWith(prefix));
    const guard = step.source.match(/if \(!fs\.existsSync\((\w+)\)\) \{([\s\S]*?)\n          \}/);
    assert.ok(guard, prefix);
    const run = new Function('fs', guard[1], guard[2]);
    assert.throws(() => run({ existsSync: () => false }, 'missing.json'), /Expected agent .*file is missing/);
  }
  const issues = steps('lights-on-schedule.yml').find((s) => s.name.startsWith('Open Actionable Issue Fix'));
  assert.match(issues.source, /const result = JSON\.parse\(fs\.readFileSync\(resultFile, 'utf8'\)\)/);
  assert.doesNotMatch(issues.source, /:\s*\{\}/);
});

test('local context is written before analysis and dependency inputs are created in their producing lanes', () => {
  const source = fs.readFileSync(path.join(ROOT, 'local', 'fetch.mjs'), 'utf8');
  const controller = fs.readFileSync(path.join(ROOT, 'local', 'controller.mjs'), 'utf8');
  const launcher = fs.readFileSync(path.join(ROOT, 'local', 'lights-on.mjs'), 'utf8');
  assert.match(source, /writeJson\('\/work\/context\.json', context\)/);
  assert.ok(launcher.indexOf("await runtime.role('fetch', 'fetch'") < launcher.indexOf("await runtime.role('analysis', 'controller'"));
  for (const name of ['dependencies', 'selection']) {
    assert.ok(controller.indexOf(`writeJson('/work/${name}.json'`) < controller.indexOf('result = await runAgent('));
    assert.ok(controller.includes(`fs.existsSync('/work/${name}.json')`));
  }
  assert.match(controller, /writeJson\('\/work\/result\.json'/);
});

test('merge gate permits absent optional review but rejects lost or corrupt explicitly supplied evidence', () => {
  const root = fixture();
  try {
    const pr = path.join(root, 'pr.json'), files = path.join(root, 'files.json'), diff = path.join(root, 'pr.diff');
    fs.writeFileSync(pr, JSON.stringify({ number: 1, state: 'open', changed_files: 1,
      user: { login: 'github-actions[bot]' }, labels: [] }));
    fs.writeFileSync(files, JSON.stringify([{ filename: 'README.md', status: 'modified' }]));
    fs.writeFileSync(diff, '');
    const cli = (...args) => spawnSync(process.execPath, [
      path.join(ROOT, '.github', 'lights-on', 'runner', 'verify-pr-safety.mjs'),
      '--pr-file', pr, '--files-file', files, '--diff-file', diff, ...args
    ], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot } });
    const noReview = cli();
    assert.equal(noReview.status, 0, noReview.stderr);
    assert.equal(JSON.parse(noReview.stdout).allowAutoMerge, false);
    const review = path.join(root, 'review.json');
    assert.notEqual(cli('--review-file', review).status, 0);
    fs.writeFileSync(review, '{broken');
    assert.notEqual(cli('--review-file', review).status, 0);
    fs.unlinkSync(diff);
    assert.notEqual(cli().status, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
