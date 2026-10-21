import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { validatePolicy, NODE_IMAGE, image, grantedCapabilities, hash } from '../local/policy.mjs';
import { Runtime, CODE, docker, mount, privateDirectory } from '../local/runtime.mjs';
import { validateCandidate } from '../local/validation.mjs';
import { main } from '../local/lights-on.mjs';

const base = () => ({ version: 1, repository: 'owner/repo' });
test('local policy is operator-owned, strict and default-deny', () => {
  const policy = validatePolicy(base());
  assert.deepEqual(policy.capabilities, []);
  assert.deepEqual(policy.rules, []);
  assert.throws(() => validatePolicy({ ...base(), allowEverything: true }), /Unknown/);
  assert.throws(() => validatePolicy({ ...base(), repository: 'https://evil.test/o/r' }), /Repository/);
  assert.throws(() => image('node:latest'), /immutable/);
  assert.throws(() => grantedCapabilities(policy, ['publish']), /not granted/);
  assert.deepEqual(grantedCapabilities({ capabilities: ['publish', 'merge'] }, ['publish']), ['publish']);
});

test('local rules reject ambiguous URLs and unknown credentials', () => {
  const rule = { id: 'provider', host: 'api.anthropic.com', path: '/v1/messages',
    methods: ['POST'], roles: ['analysis'] };
  for (const change of [{ host: '*' }, { path: '/x/%2f' }, { roles: ['worker'] },
    { credential: 'MISSING', header: 'Authorization' }]) {
    assert.throws(() => validatePolicy({ ...base(), rules: [{ ...rule, ...change }] }));
  }
  assert.equal(validatePolicy({ ...base(), rules: [rule] }).rules.length, 1);
});

test('actual scoped egress runs real Node and Git against controlled TLS, without internet', {
  skip: process.platform !== 'linux' || process.env.LIGHTS_ON_TEST_LOCAL_DOCKER !== 'true',
  // This fixture executes several complete runs; each run retains its own operation deadlines.
  timeout: 600000
}, async () => {
  const root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-topology-test-')));
  const fixture = privateDirectory(path.join(root, 'fixture'));
  const network = `lights-on-test-${crypto.randomUUID()}`;
  const server = `lights-on-test-${crypto.randomUUID()}`;
  let runtime;
  try {
    docker(['network', 'create', '--internal', '--subnet', '11.254.231.0/24', network]);
    docker(['run', '-d', '--name', server, '--pull=never', '--network', network, '--ip', '11.254.231.3',
      '--user', `${process.getuid()}:${process.getgid()}`,
      '--network-alias', 'api.github.com', '--network-alias', 'github.com',
      '--network-alias', 'api.openai.com', '--network-alias', 'api.anthropic.com', '--network-alias', 'openrouter.ai',
      '--network-alias', 'packagefeedproxy.microsoft.io',
      ...mount(CODE, '/code', true), ...mount(fixture, '/fixture'),
      '--entrypoint', 'node', NODE_IMAGE, '/code/local/testing/tls-fixture.mjs']);
    for (let n = 0; n < 100 && !fs.existsSync(path.join(fixture, 'ready')); n++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(fs.existsSync(path.join(fixture, 'ready')), 'controlled TLS fixture is ready');
    const policy = validatePolicy({ version: 1, repository: 'scovetta/test-aw1',
      images: { controller: process.env.LIGHTS_ON_TEST_CONTROLLER_IMAGE || NODE_IMAGE },
      upstreamCaFile: path.join(fixture, 'ca.pem'), rules: [
        { id: 'metadata', host: 'api.github.com', path: '/repos/scovetta/test-aw1', methods: ['GET'], roles: ['fetch'] },
        { id: 'commits', host: 'api.github.com', path: '/repos/scovetta/test-aw1/commits/', methods: ['GET'], roles: ['fetch'] },
        { id: 'git-read', host: 'github.com', path: '/scovetta/test-aw1.git/', methods: ['GET', 'POST'], roles: ['fetch'] },
        { id: 'denial-fixture', host: 'example.com', path: '/only-this', methods: ['GET'], roles: ['fetch'] },
        { id: 'openai', host: 'api.openai.com', path: '/v1/', methods: ['POST'], roles: ['analysis'] },
        { id: 'anthropic', host: 'api.anthropic.com', path: '/v1/messages', methods: ['POST'], roles: ['analysis'] },
        { id: 'openrouter', host: 'openrouter.ai', path: '/api/v1/chat/completions', methods: ['POST'], roles: ['analysis'] }
      ] });
    runtime = new Runtime({ policy, work: path.join(root, 'work') });
    runtime.preflight();
    const gateway = await runtime.gateway('fetch');
    docker(['network', 'connect', network, gateway.name]);
    const result = await runtime.role('fetch', 'probe');
    assert.match(result.stdout, /PASS: real Node fetch and Git TLS/);
    const audit = fs.readFileSync(path.join(runtime.root, 'audit', 'fetch', 'network.jsonl'), 'utf8');
    assert.match(audit, /"outcome": "allowed"/);
    assert.match(audit, /"outcome": "denied"/);
    assert.doesNotMatch(audit, /REQUEST|authorization|\/repos\/scovetta/);
    fs.writeFileSync(path.join(runtime.work, 'policy.json'), JSON.stringify(policy));
    fs.writeFileSync(path.join(runtime.work, 'request.json'), JSON.stringify({ task: 'validate' }));
    fs.chmodSync(path.join(runtime.work, 'policy.json'), 0o644);
    fs.chmodSync(path.join(runtime.work, 'request.json'), 0o644);
    await runtime.role('fetch', 'fetch');
    const snapshot = JSON.parse(fs.readFileSync(path.join(runtime.work, 'snapshot.json')));
    assert.match(snapshot.sourceSha, /^[a-f0-9]{40}$/);
    await runtime.listen();
    const state = privateDirectory(path.join(root, 'state'));
    await runtime.role('analysis', 'controller', [], { control: true, extraMounts: [[state, '/state']] });
    const validation = await validateCandidate(runtime, { profiles: [
      { id: 'fixture', image: NODE_IMAGE, commands: ['node test.js'] }
    ] });
    assert.equal(validation.status, 'passed', JSON.stringify(validation));
    if (process.env.LIGHTS_ON_TEST_CONTROLLER_IMAGE) {
      const inference = await runtime.gateway('analysis');
      docker(['network', 'connect', network, inference.name]);
      const providers = await runtime.role('analysis', 'probe', ['--providers']);
      assert.match(providers.stdout, /PASS: all four inference adapters/);
      assert.match(providers.stdout, /PASS: Copilot SDK structured inference/);
    }
    const policyFile = path.join(root, 'operator-policy.json');
    const launchPolicy = { ...policy, provider: 'codex', capabilities: ['publish'],
      profiles: [{ id: 'fixture', image: NODE_IMAGE, commands: ['node test.js'] }],
      rules: [...policy.rules, { id: 'publication', host: 'api.github.com',
        path: '/repos/scovetta/test-aw1/', methods: ['GET', 'POST'], roles: ['publisher'] }] };
    fs.writeFileSync(policyFile, JSON.stringify(launchPolicy));
    class FixtureRuntime extends Runtime {
      async gateway(role) {
        const existing = this.gateways.has(role);
        const value = await super.gateway(role);
        if (!existing) docker(['network', 'connect', network, value.name]);
        return value;
      }
    }
    const createRuntime = (settings) => new FixtureRuntime(settings);
    const preparePolicyFile = path.join(root, 'preparation-policy.json');
    fs.writeFileSync(preparePolicyFile, JSON.stringify({ ...launchPolicy,
      credentials: { UNUSED: { env: 'LIGHTS_ON_TEST_UNUSED_SECRET' } }, bundles: [
      { name: 'offline.txt', url: 'https://packagefeedproxy.microsoft.io/npm/offline.txt', sha256: hash('offline bundle fixture') }
    ], rules: [...launchPolicy.rules, { id: 'proxyfeed', host: 'packagefeedproxy.microsoft.io',
      path: '/npm/', methods: ['GET'], roles: ['prepare'] },
      { id: 'unused-inference', host: 'api.openai.com', path: '/unused', methods: ['POST'],
        roles: ['analysis'], credential: 'UNUSED', header: 'Authorization' }] }));
    for (let attempt = 0; attempt < 2; attempt++) {
      await main({ command: 'prepare', policy: preparePolicyFile, output: path.join(root, 'prepared'), capabilities: [] }, { createRuntime });
    }
    assert.equal(fs.readFileSync(path.join(fixture, 'bundle-downloads.txt'), 'utf8'), 'download\n',
      'second preparation reuses the verified proxyfeed bundle without downloading again');
    const launched = await main({ command: 'run', policy: policyFile, output: path.join(root, 'runs'),
      task: 'docs-clarifier', capabilities: [] }, { createRuntime });
    assert.equal(launched.status, 'completed');
    assert.equal(launched.validation, 'passed');
    assert.ok(!fs.existsSync(path.join(fixture, 'mutations.json')), 'default launcher has zero remote mutations');
    const runPath = path.join(root, 'runs', launched.id);
    assert.match(fs.readFileSync(path.join(runPath, 'network.jsonl'), 'utf8'), /"outcome": "allowed"/);
    const published = await main({ command: 'publish', policy: policyFile, run: runPath,
      capabilities: ['publish'] }, { createRuntime });
    assert.equal(published.status, 'completed');
    const mutations = JSON.parse(fs.readFileSync(path.join(fixture, 'mutations.json'), 'utf8'));
    assert.equal(mutations.length, 5);
    assert.ok(mutations.every((item) => item.path.startsWith('/repos/scovetta/test-aw1/')));
    const proposal = mutations.find((item) => item.path.endsWith('/pulls'));
    assert.match(proposal.body.body, /^```text/);
    assert.match(proposal.body.body, /Changed files\n\n- README\.md/);
    assert.match(proposal.body.body, /Local validation: passed/);
    assert.match(proposal.body.body, /Command: node test\.js/);
    const publishedCommit = mutations.find((item) => item.path.endsWith('/git/commits'));
    assert.match(publishedCommit.body.message, /\n\nSummary\n\nfixture/);
    assert.match(publishedCommit.body.message, /Local validation: passed/);
    assert.doesNotMatch(publishedCommit.body.message, /upstream\/repo#123/);
    assert.doesNotMatch(proposal.body.title, /upstream\/repo#123/);
    assert.match(mutations.find((item) => item.path.endsWith('/git/refs')).body.ref, /^refs\/heads\/lights-on\/local-/);
    await assert.rejects(main({ command: 'publish', policy: policyFile, run: runPath,
      capabilities: ['publish'] }, { createRuntime }), /side effects/);
    const failedOutput = path.join(root, 'failed-runs');
    await assert.rejects(main({ command: 'run', policy: policyFile, output: failedOutput,
      ref: 'limited', task: 'docs-clarifier', capabilities: ['publish'] }, { createRuntime }), /Local agent failed/);
    const failedId = fs.readdirSync(failedOutput).find((name) => /^[a-f0-9-]{36}$/.test(name));
    const failedRun = path.join(failedOutput, failedId);
    assert.equal(JSON.parse(fs.readFileSync(path.join(failedRun, 'run.json'))).status, 'failed');
    assert.equal(JSON.parse(fs.readFileSync(path.join(failedRun, 'result.json'))).execution.stop_reason, 'max_turns');
    assert.equal(fs.readFileSync(path.join(failedRun, 'candidate', 'README.md'), 'utf8'), 'Controlled Lights On fixture.\n');
    assert.equal(fs.existsSync(path.join(failedRun, 'publication.json')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(fixture, 'mutations.json'))).length, mutations.length);
    const securityOutput = path.join(root, 'security-runs');
    const securityRun = await main({ command: 'run', policy: policyFile, output: securityOutput,
      task: 'security-fixer', capabilities: [] }, { createRuntime });
    const securityDirectory = path.join(securityOutput, securityRun.id);
    assert.equal(securityRun.task, 'security-remediator');
    assert.equal(JSON.parse(fs.readFileSync(path.join(securityDirectory, 'result.json'))).task, 'security-remediator');
    assert.equal(JSON.parse(fs.readFileSync(path.join(securityDirectory, 'dependencies.json'))).summary.total, 0);
  } finally {
    runtime?.dispose();
    docker(['rm', '--force', server], { allowFailure: true });
    docker(['network', 'rm', network], { allowFailure: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
