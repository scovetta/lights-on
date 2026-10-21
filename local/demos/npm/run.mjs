#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../../lights-on.mjs';
import { assert, readPolicy, digestObject } from '../../policy.mjs';
import { parseOptions, forwardWindows, readJson, runOutcome } from './common.mjs';

export async function runDemo(options, { run = main } = {}) {
  assert(['validate', 'scan', 'docs-clarifier'].includes(options.task), 'Unsupported demo task.');
  const directory = path.resolve(options.directory);
  const demo = readJson(path.join(directory, 'demo.json'));
  assert(demo.version === 1 && /^[a-f0-9]{40}$/.test(demo.sourceSha), 'Invalid or incomplete demo setup.');
  assert(demo.repository !== 'scovetta/lights-on', 'Do not target the Lights On source repository.');
  assert(options.task !== 'scan' || demo.lockfile?.source !== 'generated',
    'The scan task requires a committed npm lockfile. The generated demo lock is only a validation input, not an authoritative repository scan input.');
  const inference = options.task === 'docs-clarifier';
  assert(!inference || options['allow-inference'], 'Pass --allow-inference to authorize provider charges.');
  const name = inference ? 'agent' : 'read';
  const policyFile = path.join(directory, `${name}-policy.json`);
  const policy = readPolicy(policyFile);
  assert(policy.repository === demo.repository && !policy.capabilities.length &&
    !policy.rules.some((rule) => rule.roles.includes('publisher')) && digestObject(policy) === demo.policies[name],
  'Demo policy changed; create a new demo rather than expanding this run.');
  const output = path.join(directory, 'runs');
  await run({ command: 'prepare', policy: policyFile, output, capabilities: [] });
  const result = await run({ command: 'run', policy: policyFile, output, repo: demo.repository,
    ref: demo.sourceSha, task: options.task, capabilities: [] });
  assert(result.sourceSha === demo.sourceSha && result.repository === demo.repository && result.task === options.task,
    'The run did not confirm the selected repository, commit and task.');
  const runDirectory = path.join(output, result.id);
  const outcome = runOutcome(runDirectory);
  console.log(JSON.stringify({
    task: options.task, sourceSha: demo.sourceSha, status: outcome.result.status,
    dependencyLock: demo.lockfile?.source || 'repository',
    validation: outcome.validation.status, published: false, runDirectory,
    summary: path.join(runDirectory, 'summary.md'), candidate: path.join(runDirectory, 'candidate'),
    networkAudit: path.join(runDirectory, 'network.jsonl')
  }, null, 2));
  return runDirectory;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseOptions(process.argv.slice(2), 'run');
    if (options.help) console.log('run.mjs --directory DIR [--task validate|scan|docs-clarifier] [--allow-inference]');
    else if (!forwardWindows('run.mjs', process.argv.slice(2), options)) await runDemo(options);
  } catch (error) { console.error(`npm demo failed: ${error.message}`); process.exitCode = 1; }
}
