import fs from 'node:fs';
import path from 'node:path';
import { assert, digestObject } from './policy.mjs';
import { github, pages, command, writeJson } from './network/fetch.mjs';
import { inventory } from '../.github/lights-on/runner/agent-sandbox.mjs';
import { parseLatestSemverTag } from '../.github/lights-on/runner/prepare-release.mjs';

const request = JSON.parse(fs.readFileSync('/work/request.json', 'utf8'));
const policy = JSON.parse(fs.readFileSync('/work/policy.json', 'utf8'));
const repo = policy.repository;
const metadata = await github(`repos/${repo}`);
assert(metadata.full_name?.toLowerCase() === repo, 'Repository identity mismatch.');
const ref = request.ref || metadata.default_branch;
assert(typeof ref === 'string' && ref.length <= 200 && !ref.startsWith('-') && !/[\x00-\x20]/.test(ref), 'Invalid source ref.');
const resolved = await github(`repos/${repo}/commits/${encodeURIComponent(ref)}`);
const sha = resolved.sha;
assert(/^[a-f0-9]{40}$/.test(sha), 'Invalid resolved source SHA.');
fs.mkdirSync('/tmp/home', { recursive: true });
const git = (args) => command('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'credential.helper=',
  '-c', 'protocol.file.allow=never', '-c', 'protocol.ext.allow=never', ...args], { env: process.env });
git(['init', '/work/source']);
git(['-C', '/work/source', 'fetch', '--depth=1', '--no-tags', `https://github.com/${repo}.git`, sha]);
git(['-C', '/work/source', 'checkout', '--detach', '--force', sha]);
const files = inventory('/work/source', { omitLocal: true });
const snapshot = { repository: repo, sourceSha: sha, ref, defaultBranch: metadata.default_branch,
  files: [...files], sourceDigest: digestObject([...files]), fetchedAt: new Date().toISOString(), remoteCi: [] };
const context = {};
if (request.item) {
  const endpoint = request.task === 'pr-reviewer' ? 'pulls' : 'issues';
  context.event = await github(`repos/${repo}/${endpoint}/${request.item}`);
  if (endpoint === 'pulls') {
    assert(context.event.base?.repo?.full_name?.toLowerCase() === repo && context.event.state === 'open',
      'PR is not open in the installed repository.');
    const head = context.event.head?.sha;
    assert(/^[a-f0-9]{40}$/.test(head), 'Invalid PR head.');
    git(['-C', '/work/source', 'fetch', '--depth=1', '--no-tags', `https://github.com/${repo}.git`, `refs/pull/${request.item}/head`]);
    assert(git(['-C', '/work/source', 'rev-parse', 'FETCH_HEAD']).trim() === head, 'PR head changed while fetching.');
    git(['-C', '/work/source', 'worktree', 'add', '--detach', '/work/head', head]);
    context.files = await pages(`repos/${repo}/pulls/${request.item}/files`);
    context.diff = git(['-C', '/work/source', 'diff', sha, head]);
    snapshot.headSha = head;
  }
}
if (['dependencies', 'migration-plan', 'migration'].includes(request.task)) {
  const pulls = await pages(`repos/${repo}/pulls?state=open`);
  context.openPrs = [];
  for (const pr of pulls) {
    context.openPrs.push({ headRefName: pr.head.ref,
      files: (await pages(`repos/${repo}/pulls/${pr.number}/files`)).map((file) => file.filename) });
  }
  context.issues = await pages(`repos/${repo}/issues?state=open`);
}
if (request.task === 'upstream') {
  context.upstreams = [];
  for (const upstream of policy.upstreams) {
    context.upstreams.push({ repository: upstream,
      issues: await pages(`repos/${upstream}/issues?state=open`),
      metadata: await github(`repos/${upstream}`) });
  }
}
if (request.task === 'release') {
  context.tags = (await pages(`repos/${repo}/tags`)).map((tag) => tag.name);
  // Fetch full history explicitly for release analysis; no repository scripts run here.
  git(['-C', '/work/source', 'fetch', '--unshallow', '--tags', `https://github.com/${repo}.git`]);
  const latest = parseLatestSemverTag(context.tags);
  const log = git(['-C', '/work/source', 'log', '--no-merges', '--pretty=format:%B%x00',
    latest ? `${latest.tag}..${sha}` : sha]).trim();
  context.commits = log ? log.split('\0').map((message) => message.trim()).filter(Boolean) : [];
}
const selected = snapshot.headSha ? '/work/head' : '/work/source';
fs.mkdirSync('/work/candidate');
for (const [name, entry] of inventory(selected, { omitLocal: true })) {
  const output = path.join('/work/candidate', name);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(path.join(selected, name), output);
  fs.chmodSync(output, entry.mode & 0o755);
}
writeJson('/work/snapshot.json', snapshot);
writeJson('/work/context.json', context);
writeJson('/work/candidate-original.json', [...inventory('/work/candidate')]);
