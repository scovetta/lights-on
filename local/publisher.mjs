import fs from 'node:fs';
import path from 'node:path';
import { assert, digestObject } from './policy.mjs';
import { github, pages, proxyFetch, writeJson } from './network/fetch.mjs';
import { literalPublicationBody, plainPublicationText, commitPublicationText } from '../.github/lights-on/runner/publication-text.mjs';
import { describeChange } from '../.github/lights-on/runner/describe-change.mjs';
import { evaluatePrSafety } from '../.github/lights-on/runner/verify-pr-safety.mjs';
import { evaluateCi } from '../.github/lights-on/runner/verify-ci.mjs';
import { loadConfig } from '../.github/lights-on/runner/load-config.mjs';
import { inventory } from '../.github/lights-on/runner/agent-sandbox.mjs';
import { uploadLocalArtifacts } from './release.mjs';
import { readCurrentManifestVersion } from '../.github/lights-on/runner/prepare-release.mjs';

const read = (name) => JSON.parse(fs.readFileSync(`/work/${name}.json`, 'utf8'));
const policy = read('policy'), request = read('request'), snapshot = read('snapshot');
const run = read('run'), result = read('result'), validation = read('validation');
const capabilities = read('grants');
const config = loadConfig({ repoRoot: '/work/source', env: {} });
const repo = policy.repository;
const prefix = `repos/${repo}`;
const actions = [];
const record = (action) => {
  if (action.url) {
    const url = new URL(action.url);
    assert(url.protocol === 'https:' && url.host === 'github.com' && !url.username && !url.password &&
      url.pathname.toLowerCase().startsWith(`/${repo}/`), 'Publication returned a foreign URL.');
  }
  actions.push(action);
  writeJson('/work/publication.json', { actions });
};
assert(config.enabled !== false, 'Repository has disabled Lights On.');
assert(run.policyDigest === digestObject(policy) && run.repository === repo, 'Run policy identity changed.');
assert(run.candidateDigest === digestObject([...inventory('/work/candidate', { omitLocal: true })]), 'Candidate changed after validation.');
assert(snapshot.sourceDigest === digestObject([...inventory('/work/source', { omitLocal: true })]), 'Trusted source changed.');
assert(!result.dry_run && !['skipped', 'failed'].includes(result.status), 'Synthetic, skipped or failed results cannot be published.');
if (capabilities.includes('merge')) assert(request.task === 'pr-reviewer', 'Merge requires a PR-review run.');
if (capabilities.includes('release') || capabilities.includes('registry-publish')) {
  assert(request.task === 'release' && request.version, 'Release capabilities require an explicit committed release version.');
}
if (capabilities.includes('registry-publish')) assert(request.ecosystem, 'Package publishing requires a selected ecosystem.');
const fresh = await github(`${prefix}/commits/${encodeURIComponent(snapshot.ref)}`);
assert(fresh.sha === snapshot.sourceSha, 'Source ref changed; rerun before publishing.');
assert(snapshot.ref === snapshot.defaultBranch, 'Publication requires the trusted default branch as its source.');

async function ci(sha) {
  const checks = [];
  for (let page = 1; page <= 30; page++) {
    const response = await github(`${prefix}/commits/${sha}/check-runs?filter=latest&per_page=100&page=${page}`);
    assert(Array.isArray(response.check_runs), 'Invalid remote checks response.');
    checks.push(...response.check_runs);
    if (response.check_runs.length < 100) break;
    assert(page < 30, 'Check inventory exceeded limit.');
  }
  const statuses = await pages(`${prefix}/commits/${sha}/statuses`);
  return evaluateCi({ checks, statuses, sha, requiredChecks: config.autonomy.required_checks });
}

if (capabilities.includes('publish')) {
  if (request.task === 'pr-reviewer') {
    const current = await github(`${prefix}/pulls/${request.item}`);
    assert(current.state === 'open' && !current.merged && current.head.sha === snapshot.headSha, 'Review is stale.');
    const review = await github(`${prefix}/pulls/${request.item}/reviews`, { method: 'POST',
      body: { commit_id: snapshot.headSha, event: 'COMMENT', body: literalPublicationBody(result.summary || 'Local review completed.') } });
    assert(review.commit_id === snapshot.headSha, 'Review commit was not confirmed.');
    record({ operation: 'review', url: review.html_url, sha: review.commit_id });
  } else {
    const original = new Map(read('candidate-original'));
    const after = inventory('/work/candidate', { omitLocal: true });
    const changes = [...new Set([...original.keys(), ...after.keys()])].filter((name) =>
      original.get(name)?.hash !== after.get(name)?.hash || original.get(name)?.mode !== after.get(name)?.mode);
    if (changes.length) {
      assert(result.status === 'completed' && validation.status === 'passed' &&
        validation.candidate === run.candidateDigest, 'Candidate lacks mandatory local validation.');
      if (['dependencies', 'migration'].includes(request.task)) {
        assert(result.dependency_validation?.status === 'passed', 'Dependency publication requires controller validation.');
      }
      const title = plainPublicationText(result.pr_title || result.prTitle || `chore: local Lights On ${request.task}`);
      const description = describeChange({ result, files: changes, validation,
        notes: result.hold ? ['Maintainer review required; created as a draft.'] : [],
        env: { GITHUB_REPOSITORY: repo } });
      const branch = `lights-on/local-${run.id}`;
      const commit = await github(`${prefix}/git/commits/${snapshot.sourceSha}`);
      const tree = [];
      for (const name of changes) {
        const file = after.get(name);
        const blob = file ? await github(`${prefix}/git/blobs`, { method: 'POST',
          body: { encoding: 'base64', content: fs.readFileSync(path.join('/work/candidate', name)).toString('base64') } }) : null;
        tree.push({ path: name, mode: file && file.mode & 0o111 ? '100755' : '100644', type: 'blob', sha: blob?.sha || null });
      }
      const createdTree = await github(`${prefix}/git/trees`, { method: 'POST', body: { base_tree: commit.tree.sha, tree } });
      const createdCommit = await github(`${prefix}/git/commits`, { method: 'POST',
        body: { message: `${title}\n\n${commitPublicationText(description)}`, tree: createdTree.sha, parents: [snapshot.sourceSha] } });
      await github(`${prefix}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: createdCommit.sha } });
      record({ operation: 'branch', branch, sha: createdCommit.sha });
      const pr = await github(`${prefix}/pulls`, { method: 'POST', body: {
        head: branch, base: snapshot.defaultBranch, title, draft: Boolean(result.hold),
        body: literalPublicationBody(description)
      } });
      assert(pr.head?.sha === createdCommit.sha && pr.base?.repo?.full_name?.toLowerCase() === repo, 'Published PR identity not confirmed.');
      record({ operation: 'proposal', url: pr.html_url, number: pr.number, sha: createdCommit.sha });
    } else if (request.item && result.comment_body) {
      const comment = await github(`${prefix}/issues/${request.item}/comments`, { method: 'POST',
        body: { body: literalPublicationBody(result.comment_body) } });
      record({ operation: 'comment', url: comment.html_url });
    } else {
      const issue = await github(`${prefix}/issues`, { method: 'POST', body: {
        title: plainPublicationText(`Lights On ${request.task} report`),
        body: literalPublicationBody(result.comment_body || result.summary || JSON.stringify(result))
      } });
      record({ operation: 'report', url: issue.html_url });
    }
  }
}
if (capabilities.includes('merge')) {
  assert(request.task === 'pr-reviewer' && result.status === 'completed', 'Merge requires a separate completed independent PR review run.');
  assert(validation.status === 'passed', 'Required local validation did not pass.');
  const pr = await github(`${prefix}/pulls/${request.item}`);
  assert(pr.state === 'open' && !pr.merged && !pr.draft && pr.head.sha === snapshot.headSha &&
    pr.base.repo.full_name.toLowerCase() === repo, 'PR changed during review.');
  const files = await pages(`${prefix}/pulls/${request.item}/files`);
  const context = read('context');
  const safety = evaluatePrSafety({ pr, changedFiles: files, diffText: context.diff,
    reviewResult: result, ciStatus: await ci(snapshot.headSha), config });
  assert(safety.allowAutoMerge, `Merge blocked: ${safety.reasons.join(', ')}`);
  const merged = await github(`${prefix}/pulls/${request.item}/merge`, { method: 'PUT', body: {
    sha: snapshot.headSha, merge_method: safety.mergeMethod,
    commit_title: plainPublicationText(pr.title || `Merge PR ${request.item}`),
    commit_message: `${commitPublicationText(pr.body || result.summary)}\n\nReviewed head: ${snapshot.headSha}`
  } });
  assert(merged.merged === true, 'GitHub did not confirm the merge.');
  record({ operation: 'merge', sha: merged.sha });
}
if (capabilities.includes('release') || capabilities.includes('registry-publish')) {
  assert(request.task === 'release' && request.version && config.release.enabled &&
    readCurrentManifestVersion('/work/source') === request.version,
  'Release publication requires an explicit version already committed to the trusted source.');
  assert(validation.status === 'passed' && await ci(snapshot.sourceSha) === 'success', 'Release requires local validation and trusted source CI.');
  if (capabilities.includes('release')) {
    assert(config.release.create_github_release !== false, 'Repository policy disables GitHub releases.');
    const tagName = `v${request.version}`;
    const reference = await github(`${prefix}/git/ref/tags/${tagName}`, { allowNotFound: true });
    if (reference) {
      let object = reference.object;
      for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
        assert(/^[a-f0-9]{40}$/.test(object.sha), 'Invalid annotated tag identity.');
        object = (await github(`${prefix}/git/tags/${object.sha}`)).object;
      }
      assert(object?.type === 'commit' && object.sha === snapshot.sourceSha, 'Existing release tag does not identify the verified source.');
    } else {
      await github(`${prefix}/git/refs`, { method: 'POST',
        body: { ref: `refs/tags/${tagName}`, sha: snapshot.sourceSha } });
      record({ operation: 'tag', tag: tagName, sha: snapshot.sourceSha });
    }
    const released = await github(`${prefix}/releases`, { method: 'POST', body: {
      tag_name: tagName, target_commitish: snapshot.sourceSha,
      name: plainPublicationText(`Release ${request.version}`),
      body: literalPublicationBody(result.summary || `Release ${request.version}`), draft: false
    } });
    record({ operation: 'release', url: released.html_url });
  }
  if (capabilities.includes('registry-publish')) {
    assert(config.release.auto_publish !== false, 'Repository policy disables automatic package publication.');
    const artifact = read('artifact');
    assert(artifact.version === request.version && artifact.ecosystem === request.ecosystem, 'Artifact identity mismatch.');
    const secrets = JSON.parse(fs.readFileSync('/publication/secrets.json', 'utf8'));
    await uploadLocalArtifacts({ repoRoot: '/work/source', directory: '/work/artifacts', version: request.version,
      ecosystem: artifact.ecosystem, token: secrets.REGISTRY_TOKEN, fetchImpl: proxyFetch });
    record({ operation: 'registry-publish', ecosystem: artifact.ecosystem, version: artifact.version });
  }
}
assert(actions.length > 0, 'No publication capability/action selected.');
