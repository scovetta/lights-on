import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { nodeReleaseStatus, planToolchainMaintenance, maintainToolchains, NODE_SCHEDULE_URL } from '../.github/lights-on/runner/maintain-toolchains.mjs';
import { loadConfig, parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';
import { evaluatePrSafety } from '../.github/lights-on/runner/verify-pr-safety.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = Date.parse('2026-10-18T12:00:00Z');
const schedule = {
  v20: { start: '2023-04-18', lts: '2023-10-24', maintenance: '2024-10-22', end: '2026-04-30' },
  v22: { start: '2024-04-24', lts: '2024-10-29', maintenance: '2025-10-21', end: '2027-04-30' },
  v24: { start: '2025-05-06', lts: '2025-10-28', maintenance: '2026-10-20', end: '2028-04-30' },
  v26: { start: '2026-05-05', lts: '2026-10-28', maintenance: '2027-10-20', end: '2029-04-30' },
  v27: { start: '2027-04-22', end: '2030-04-30' }
};
const config = { ...loadConfig(ROOT, {}), toolchains: { enabled: true, node: {
  support_policy: 'supported', update_ci: true, update_runtime_files: true, build_files: []
} } };
const workflow = `name: Test
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        node: [20, 22, 24]
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@${'a'.repeat(40)}
        with:
          node-version: \${{ matrix.node }}
      - run: npm test
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Node build runtime
        uses: actions/setup-node@${'a'.repeat(40)}
        with:
          node-version: '20' # retired
      - run: npm run build
`;
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-toolchains-'));
  fs.mkdirSync(path.join(root, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, '.github', 'workflows', 'test.yml'), workflow);
  fs.writeFileSync(path.join(root, 'package.json'), '{"engines":{"node":">=20"},"scripts":{"test":"node --test"}}');
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('Configurable Node toolchain lifecycle maintenance', () => {
  it('is opt-in and does not fetch or mutate anything when disabled', async () => {
    const f = fixture();
    try {
      const disabled = loadConfig(ROOT, {});
      assert.equal(disabled.toolchains.enabled, false);
      const result = await maintainToolchains({ repoRoot: f.root, config: disabled, publish: true, env: {},
        fetchImpl: () => assert.fail('disabled feature must not fetch'),
        execFileImpl: () => assert.fail('disabled feature must not invoke git/gh') });
      assert.equal(result.status, 'skipped');
      assert.equal(fs.readFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), 'utf8'), workflow);
    } finally { f.cleanup(); }
  });

  it('distinguishes active LTS, maintenance, EOL and future releases at date boundaries', () => {
    assert.equal(nodeReleaseStatus(schedule.v20, now), 'end-of-life');
    assert.equal(nodeReleaseStatus(schedule.v22, now), 'maintenance');
    assert.equal(nodeReleaseStatus(schedule.v24, now), 'active-lts');
    assert.equal(nodeReleaseStatus(schedule.v26, now), 'current');
    assert.equal(nodeReleaseStatus(schedule.v27, now), 'future');
    assert.equal(nodeReleaseStatus(schedule.v20, Date.parse('2026-04-29T23:59:59Z')), 'maintenance');
    assert.equal(nodeReleaseStatus(schedule.v20, Date.parse('2026-04-30T00:00:00Z')), 'end-of-life');
    assert.equal(nodeReleaseStatus(schedule.v24, Date.parse('2026-10-20T00:00:00Z')), 'maintenance');
    assert.throws(() => nodeReleaseStatus({ start: 'bad', end: '2027-01-01' }), /Invalid/);
  });

  it('removes only EOL matrix versions by default and updates fixed build runtime without changing engines', () => {
    const f = fixture();
    try {
      const result = planToolchainMaintenance({ repoRoot: f.root, schedule, config, now });
      assert.equal(result.target, 24, 'Do not target Node 26 before its LTS date.');
      assert.equal(result.changes.length, 1);
      assert.match(result.changes[0].content, /node: \[22, 24\]/);
      assert.match(result.changes[0].content, /node-version: '24' # retired/);
      assert.ok(result.changes[0].content.includes('node-version: ${{ matrix.node }}'));
      assert.ok(result.changes[0].content.includes(`actions/setup-node@${'a'.repeat(40)}`));
      assert.ok(!result.changes.some((change) => change.file === 'package.json'));
      assert.ok(result.changes[0].reasons.some((reason) => reason.includes('removed 20')));
      assert.equal(fs.readFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), 'utf8'), workflow, 'Planning must be read-only.');
    } finally { f.cleanup(); }
  });

  it('supports active-LTS-only policy and never leaves an empty matrix', () => {
    const f = fixture();
    try {
      const active = { ...config, toolchains: { ...config.toolchains, node: { support_policy: 'active-lts' } } };
      assert.match(planToolchainMaintenance({ repoRoot: f.root, schedule, config: active, now }).changes[0].content, /node: \[24\]/);
      fs.writeFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), workflow.replace('[20, 22, 24]', '[20]'));
      assert.match(planToolchainMaintenance({ repoRoot: f.root, schedule, config, now }).changes[0].content, /node: \[24\]/);
      assert.throws(() => planToolchainMaintenance({ repoRoot: f.root, schedule, config: active,
        now: Date.parse('2026-10-22T00:00:00Z') }), /No released LTS/);
    } finally { f.cleanup(); }
  });

  it('handles block lists, keeps unrelated jobs/scalars intact, and skips complex matrix forms', () => {
    const f = fixture();
    try {
      const text = workflow.replace('node: [20, 22, 24]', 'node-version:\n          - "20"\n\n          # still supported\n          - "22" # maintenance\n          - "24"')
        .replace('matrix.node }}', 'matrix.node-version }}') +
        `  other:\n    strategy:\n      matrix:\n        node: [20, 22]\n    steps:\n      - run: |\n          matrix:\n            node: [20]\n          node-version: '20'\n`;
      fs.writeFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), text);
      const result = planToolchainMaintenance({ repoRoot: f.root, schedule, config, now });
      assert.ok(result.changes[0].content.includes('node-version:\n\n          # still supported\n          - "22" # maintenance\n          - "24"'));
      assert.ok(result.changes[0].content.includes('node: [20, 22]'));
      assert.ok(result.changes[0].content.includes("          node-version: '20'"));
      fs.writeFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'),
        workflow.replace('node: [20, 22, 24]', 'node: [20, 22, 24]\n        exclude:\n          - node: 22'));
      const complex = planToolchainMaintenance({ repoRoot: f.root, schedule, config, now });
      assert.ok(complex.notes.some((note) => note.includes('include/exclude')));
      assert.match(complex.changes[0].content, /node: \[20, 22, 24\]/);
    } finally { f.cleanup(); }
  });

  it('maintains explicitly listed build files and runtime files, preserving pinned/unsupported declarations', () => {
    const f = fixture();
    try {
      fs.mkdirSync(path.join(f.root, 'scripts'));
      fs.writeFileSync(path.join(f.root, '.nvmrc'), 'v20\n');
      fs.writeFileSync(path.join(f.root, '.node-version'), '20.19.0\n');
      fs.writeFileSync(path.join(f.root, '.tool-versions'), 'nodejs 20\nruby 3.3\n');
      fs.writeFileSync(path.join(f.root, 'scripts', 'build.sh'), "export NODE_VERSION='20'\necho Node 20 is an example\n");
      fs.writeFileSync(path.join(f.root, 'scripts', 'build.ps1'), '$NodeVersion = "20"\n');
      fs.writeFileSync(path.join(f.root, 'Dockerfile'), 'FROM node:20-bookworm AS build\nFROM node:20@sha256:abc AS pinned\n');
      const settings = { ...config, toolchains: { enabled: true, node: { update_ci: false,
        build_files: ['scripts/build.sh', 'scripts/build.ps1', 'Dockerfile'] } } };
      const result = planToolchainMaintenance({ repoRoot: f.root, schedule, config: settings, now });
      const changed = Object.fromEntries(result.changes.map((change) => [change.file, change.content]));
      assert.equal(changed['.nvmrc'], 'v24\n');
      assert.equal(changed['.tool-versions'], 'nodejs 24\nruby 3.3\n');
      assert.equal(changed['scripts/build.sh'], "export NODE_VERSION='24'\necho Node 20 is an example\n");
      assert.equal(changed['scripts/build.ps1'], '$NodeVersion = "24"\n');
      assert.equal(changed.Dockerfile, 'FROM node:24-bookworm AS build\nFROM node:20@sha256:abc AS pinned\n');
      assert.equal(changed['.node-version'], undefined);
      assert.ok(result.notes.some((note) => note.includes('Exact patch-version')));
      assert.equal(changed['.github/workflows/test.yml'], undefined);
      assert.throws(() => planToolchainMaintenance({ repoRoot: f.root, schedule, now,
        config: { toolchains: { enabled: true, node: { build_files: ['../outside.sh'] } } } }), /Unsafe toolchain/);
    } finally { f.cleanup(); }
  });

  it('does not modify Lights On control workflows and fails closed on unavailable lifecycle data', async () => {
    const f = fixture();
    try {
      fs.writeFileSync(path.join(f.root, '.github', 'workflows', 'lights-on-schedule.yml'), workflow);
      const result = planToolchainMaintenance({ repoRoot: f.root, schedule, config, now });
      assert.ok(!result.changes.some((change) => change.file.includes('lights-on-schedule')));
      await assert.rejects(maintainToolchains({ repoRoot: f.root, config, now, publish: true,
        fetchImpl: async () => ({ ok: false }), execFileImpl: () => assert.fail('Must not mutate on fetch failure') }), /Could not fetch/);
      assert.equal(fs.readFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), 'utf8'), workflow);
    } finally { f.cleanup(); }
  });

  it('reuses an existing proposal without rewriting files or pushing another commit', async () => {
    const f = fixture();
    try {
      const calls = [];
      const result = await maintainToolchains({ repoRoot: f.root, config, now, publish: true,
        env: { GITHUB_REPOSITORY: 'owner/repo', DEFAULT_BRANCH: 'main' },
        fetchImpl: async () => ({ ok: true, json: async () => schedule }),
        execFileImpl: (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === 'git' || args[0] === 'label') return '';
          assert.equal(args[1], 'list');
          return JSON.stringify([{ headRefName: args[args.indexOf('--head') + 1], baseRefName: 'main',
            headRepositoryOwner: { login: 'owner' }, isCrossRepository: false, number: 4,
            title: 'existing proposal', url: 'https://github.com/owner/repo/pull/4' }]);
        } });
      assert.equal(result.pr.created, false);
      assert.ok(!calls.some((call) => ['push', 'commit', 'add'].includes(call[1])));
      assert.equal(fs.readFileSync(path.join(f.root, '.github', 'workflows', 'test.yml'), 'utf8'), workflow);
    } finally { f.cleanup(); }
  });

  it('refuses dirty workspaces and preserves aliases and future-version matrix entries', async () => {
    const f = fixture();
    try {
      await assert.rejects(maintainToolchains({ repoRoot: f.root, config, now, publish: true,
        env: { GITHUB_REPOSITORY: 'owner/repo', DEFAULT_BRANCH: 'main' },
        fetchImpl: async () => ({ ok: true, json: async () => schedule }),
        execFileImpl: () => ' M package.json'
      }), /clean checkout/);
      const file = path.join(f.root, '.github', 'workflows', 'test.yml');
      fs.writeFileSync(file, workflow.replace('[20, 22, 24]', "['lts/*', 20]"));
      assert.ok(planToolchainMaintenance({ repoRoot: f.root, schedule, config, now }).changes[0].content.includes("['lts/*', 20]"));
      fs.writeFileSync(file, workflow.replace('[20, 22, 24]', '[20, 24, 27, 99]'));
      const result = planToolchainMaintenance({ repoRoot: f.root, schedule, config, now });
      assert.match(result.changes[0].content, /node: \[24, 27, 99\]/);
      assert.ok(result.notes.some((note) => note.includes('missing from the lifecycle schedule')));
    } finally { f.cleanup(); }
  });

  it('publishes only planned files on the installed repository with a review hold and source citations', async () => {
    const f = fixture();
    try {
      const calls = [];
      const result = await maintainToolchains({ repoRoot: f.root, config, now, publish: true,
        env: { GITHUB_REPOSITORY: 'owner/repo', DEFAULT_BRANCH: 'main' },
        fetchImpl: async (url) => { assert.equal(url, NODE_SCHEDULE_URL); return { ok: true, json: async () => schedule }; },
        execFileImpl: (cmd, args) => {
          calls.push([cmd, ...args]);
          if (cmd === 'git') return '';
          assert.equal(args[args.indexOf('--repo') + 1], 'owner/repo');
          if (args[0] === 'label') return '';
          if (args[1] === 'list') return '[]';
          assert.ok(args[args.indexOf('--label') + 1].includes('lights-on:hold'));
          const body = args[args.indexOf('--body') + 1];
          assert.ok(body.includes(NODE_SCHEDULE_URL));
          assert.ok(body.includes('required_checks'));
          return 'https://github.com/owner/repo/pull/1';
        } });
      assert.equal(result.pr.created, true);
      const add = calls.find((call) => call[0] === 'git' && call[1] === 'add');
      assert.deepEqual(add.slice(2), ['--', '.github/workflows/test.yml']);
      assert.equal(fs.readFileSync(path.join(f.root, 'package.json'), 'utf8'), '{"engines":{"node":">=20"},"scripts":{"test":"node --test"}}');
      const gate = evaluatePrSafety({ pr: { number: 1, changed_files: 1, labels: ['lights-on:hold'], user: { login: 'github-actions[bot]' } },
        changedFiles: ['.github/workflows/test.yml'], config, ciStatus: 'success',
        reviewResult: { verdict: 'APPROVE', gate_results: { threat_model: 'PASS', intended_use: 'PASS', dependent_packages: 'PASS', tests: 'PASS' } } });
      assert.equal(gate.allowAutoMerge, false);
      assert.ok(gate.reasons.includes('held-by-label'));
      assert.ok(gate.reasons.includes('protected-path-modified'));
    } finally { f.cleanup(); }
  });

  it('exposes a separate manual toolchains lane alongside configured dependency maintenance', () => {
    const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'lights-on-schedule.yml'), 'utf8');
    assert.ok(parseSimpleYaml(text.split(/^concurrency:/m)[0]).on.workflow_dispatch.inputs.task.options.includes('toolchains'));
    assert.ok(text.includes('maintain-toolchains.mjs --publish'));
    assert.ok(text.includes("inputs.task == 'dependencies' || inputs.task == 'toolchains'"));
  });
});
