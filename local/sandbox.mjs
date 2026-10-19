import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { inventory, applyCandidate } from '../.github/lights-on/runner/agent-sandbox.mjs';

function request(value) {
  const result = spawnSync(process.execPath, ['/code/local/worker-client.mjs', JSON.stringify(value)],
    { encoding: 'utf8', timeout: 130000, maxBuffer: 200000, env: { PATH: process.env.PATH } });
  if (result.status !== 0) throw new Error(`Protected worker failed: ${(result.stdout || result.stderr).slice(0, 2000)}`);
  return JSON.parse(result.stdout);
}

export function createLocalSandbox({ repoRoot }) {
  const source = repoRoot === '/work/candidate' ? 'candidate' :
    /^\/work\/sandboxes\/[a-f0-9-]{36}$/.test(repoRoot) ? path.basename(repoRoot) : null;
  if (!source) throw new Error('Unregistered sandbox source.');
  const baseline = inventory(repoRoot, { omitLocal: true });
  const { id, workspace } = request({ operation: 'create', source });
  return {
    workspace,
    run(command) { return request({ operation: 'run', id, command }); },
    apply({ allowThreatModel = false } = {}) {
      return applyCandidate({ candidate: workspace, target: repoRoot, baseline, allowThreatModel });
    },
    dispose() { request({ operation: 'dispose', id }); }
  };
}
