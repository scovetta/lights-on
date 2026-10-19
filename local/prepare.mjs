import fs from 'node:fs';
import path from 'node:path';
import { hash, assert } from './policy.mjs';
import { proxyFetch, writeJson } from './network/fetch.mjs';

const policy = JSON.parse(fs.readFileSync('/work/policy.json', 'utf8'));
fs.mkdirSync('/work/bundles', { recursive: true });
const acquired = [];
for (const bundle of policy.bundles) {
  const output = path.join('/work/bundles', bundle.name);
  if (fs.existsSync(output) && hash(fs.readFileSync(output)) === bundle.sha256) {
    acquired.push({ name: bundle.name, sha256: bundle.sha256, cached: true });
    continue;
  }
  const response = await proxyFetch(bundle.url);
  const content = Buffer.from(await response.arrayBuffer());
  assert(hash(content) === bundle.sha256, `Bundle digest mismatch: ${bundle.name}`);
  fs.writeFileSync(output, content, { mode: 0o600 });
  acquired.push({ name: bundle.name, sha256: bundle.sha256, cached: false });
}
writeJson('/work/preparation.json', { acquired, registry: policy.npmRegistry || null,
  note: 'Downloads are inert bundles. Installation/build commands run only in offline workers.' });
