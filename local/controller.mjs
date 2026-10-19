import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runAgent } from '../.github/lights-on/runner/run-agent.mjs';
import { loadConfig } from '../.github/lights-on/runner/load-config.mjs';
import { scanRepositoryDependencies } from '../.github/lights-on/runner/scan-dependencies.mjs';
import { selectDependencyWork } from '../.github/lights-on/runner/dependency-work.mjs';
import { maintainToolchains } from '../.github/lights-on/runner/maintain-toolchains.mjs';
import { prepareRelease, readCurrentManifestVersion } from '../.github/lights-on/runner/prepare-release.mjs';
import { evaluatePrSafety } from '../.github/lights-on/runner/verify-pr-safety.mjs';
import { loadState, saveState, parseStateFromText, isTrustedStateAuthor } from '../.github/lights-on/runner/state-store.mjs';
import { createLocalSandbox } from './sandbox.mjs';
import { writeJson } from './network/fetch.mjs';
import { assert, hash, normalizeTask } from './policy.mjs';
import { cachedFetch } from './network/cache.mjs';

const read = (name) => JSON.parse(fs.readFileSync(`/work/${name}.json`, 'utf8'));
const policy = read('policy'), request = read('request'), context = read('context'), snapshot = read('snapshot');
const stateFile = '/state/state.json';
const env = { ...process.env, GITHUB_REPOSITORY: policy.repository, GITHUB_SERVER_URL: 'https://github.com',
  LIGHTS_ON_STATE_FILE: stateFile, LIGHTS_ON_PROVIDER: policy.provider,
  ANTHROPIC_API_KEY: 'gateway-managed', OPENAI_API_KEY: 'gateway-managed', OPENROUTER_API_KEY: 'gateway-managed' };
process.env.LIGHTS_ON_STATE_FILE = stateFile;
const config = loadConfig({ repoRoot: '/work/source', env });
let task = normalizeTask(request.task);
let tier = request.tier;
let result;
if (config.enabled === false) result = { status: 'skipped', summary: 'Lights On is disabled by repository configuration.' };
else if (task === 'validate') result = { status: 'completed', summary: 'Offline validation requested; no inference.' };
else if (task === 'upstream') result = { status: 'completed', summary: 'Read-only upstream snapshots acquired.', upstreams: context.upstreams };
else if (task === 'toolchains') {
  result = await maintainToolchains({ repoRoot: '/work/candidate', config, publish: false, env, fetchImpl: cachedFetch });
  for (const change of result.changes || []) {
    const file = path.join('/work/candidate', change.file);
    assert(hash(fs.readFileSync(file)) === change.before_sha256, 'Toolchain source changed.');
    fs.writeFileSync(file, change.content);
  }
  result.hold = true;
} else if (task === 'release') {
  if (request.version) {
    assert(config.release.enabled && readCurrentManifestVersion('/work/source') === request.version,
      'Release version must already be committed and releases enabled.');
    result = { status: 'completed', version: request.version, summary: `Validate committed release ${request.version}.` };
  } else {
    result = prepareRelease({ repoRoot: '/work/candidate', config, tags: context.tags, commits: context.commits, dryRun: false });
    result.status = result.shouldRelease ? 'completed' : 'skipped';
  }
  result.hold = true;
} else {
  if (['dependencies', 'migration-plan', 'migration', 'scan', 'security-remediator'].includes(task)) {
    const state = loadState({ stateFile });
    const report = await scanRepositoryDependencies({ repoRoot: '/work/candidate', config, state, fetchImpl: cachedFetch });
    saveState(state, { stateFile });
    writeJson('/work/dependencies.json', report);
    if (task === 'scan') {
      const missing = report.dependencies.filter((dep) => !dep.evidence.advisory_checked || !dep.evidence.metadata_available);
      result = { status: missing.length ? 'blocked' : 'completed', summary: report.summary,
        missingEvidence: missing.map((d) => d.name) };
    } else if (task !== 'security-remediator') {
      const selection = selectDependencyWork({ repoRoot: '/work/candidate', report, config, state,
        mode: task === 'migration-plan' ? 'migration-plan' : task === 'migration' ? 'migration' : 'updates',
        planId: request.planId || '', openPrs: context.openPrs,
        openPlans: (context.issues || []).filter((i) => isTrustedStateAuthor(i.user))
          .map((i) => parseStateFromText(i.body))
          .filter((entry) => entry?.task === 'dependency-migration-planner')
          .map((entry) => entry.dependency_key) });
      writeJson('/work/selection.json', selection);
      if (selection.status !== 'ready') result = selection;
      else { task = selection.task; tier ||= selection.tier; }
    }
  }
  if (!result && task === 'pr-reviewer') {
    const safety = evaluatePrSafety({ pr: context.event, changedFiles: context.files, diffText: context.diff, config });
    if (!safety.safeToReview) result = { status: 'blocked', summary: safety.reasons.join(', ') };
  }
  if (!result) {
    if (policy.provider === 'copilot') {
      // This optional file is mounted only into inference, never into a command worker.
      assert(fs.existsSync('/inference/token'), 'Copilot needs an explicitly scoped inference credential.');
      env.COPILOT_GITHUB_TOKEN = fs.readFileSync('/inference/token', 'utf8').trim();
      if (config.engine.copilot_backend === 'cli') {
        const cli = spawnSync('copilot', ['--version'], { env: { PATH: process.env.PATH }, encoding: 'utf8' });
        assert(cli.status === 0 && /\b1\.0\.98\b/.test(cli.stdout), 'Local controller image must include pinned Copilot CLI 1.0.98.');
      }
    }
    const proxyKeys = ['HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE'];
    result = await runAgent({ task, tier: tier || 'default', provider: policy.provider, model: policy.model,
      repoRoot: '/work/source', workingDir: '/work/candidate', env, stateFile, fetchImpl: cachedFetch,
      promptRoot: '/code/.github/lights-on/prompts', sandboxFactory: createLocalSandbox,
      contextFiles: ['/work/context.json', ...(fs.existsSync('/work/dependencies.json') ? ['/work/dependencies.json'] : [])],
      dependencySelectionFile: fs.existsSync('/work/selection.json') ? '/work/selection.json' : undefined,
      eventPayload: context.event, outputPath: '/work/result.json',
      spawnImpl: (cmd, args, options) => spawnSync(cmd, args, { ...options,
        env: { ...options.env, ...Object.fromEntries(proxyKeys.map((key) => [key, process.env[key]])) } })
    });
  }
}
writeJson('/work/result.json', { ...result, task, sourceSha: snapshot.sourceSha, headSha: snapshot.headSha || null });
if (result.status === 'failed') {
  console.error(`Local agent failed: ${result.summary}`);
  process.exitCode = 1;
}
