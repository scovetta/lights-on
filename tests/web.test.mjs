import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimpleYaml } from '../.github/lights-on/runner/load-config.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(WEB, 'assets', 'site.css'), 'utf8');
const tags = [...html.matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)].map(([, name, source]) => ({
  name: name.toLowerCase(),
  attributes: Object.fromEntries([...source.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)]
    .map(([, key, value]) => [key, value]))
}));
const ids = tags.filter((tag) => tag.attributes.id).map((tag) => tag.attributes.id);
const references = tags.flatMap((tag) => ['href', 'src']
  .filter((key) => tag.attributes[key]).map((key) => tag.attributes[key]));
const localReferences = references.filter((value) => !value.startsWith('https://'));
const workflow = parseSimpleYaml(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8'));

test('website has unique navigation targets and accessible static structure', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.equal(tags.find((tag) => tag.name === 'html').attributes.lang, 'en');
  assert.equal(tags.filter((tag) => tag.name === 'main').length, 1);
  assert.equal(tags.filter((tag) => tag.name === 'h1').length, 1);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  assert.match(tags.find((tag) => tag.attributes.name === 'viewport').attributes.content, /width=device-width/);
  assert.equal(tags.find((tag) => tag.name === 'a').attributes.href, '#main', 'First link skips navigation');
  for (const tag of tags) {
    if (tag.name === 'img') assert.ok(Object.hasOwn(tag.attributes, 'alt'), 'Every image needs alt text');
    if (tag.name === 'nav') assert.ok(tag.attributes['aria-label'], 'Name each navigation landmark');
    if (tag.name === 'pre') assert.equal(tag.attributes.tabindex, '0', 'Overflowing code must be keyboard scrollable');
    for (const id of (tag.attributes['aria-labelledby'] || '').split(/\s+/).filter(Boolean)) {
      assert.ok(ids.includes(id), `Missing accessible label: ${id}`);
    }
  }
  for (const reference of localReferences) {
    assert.ok(!reference.startsWith('/'), `Root-relative reference breaks repository Pages: ${reference}`);
    const url = new URL(reference, 'https://pages.invalid/lights-on/');
    assert.equal(url.origin, 'https://pages.invalid');
    assert.ok(url.pathname.startsWith('/lights-on/'), reference);
    if (url.hash) assert.ok(ids.includes(decodeURIComponent(url.hash.slice(1))), `Missing fragment: ${reference}`);
  }
  assert.equal(tags.filter((tag) => ['script', 'iframe', 'base'].includes(tag.name)).length, 0,
    'Site content and navigation must not depend on scripts, frames or a fixed base URL');
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion:\s*no-preference/);
  assert.match(css, /@media \(max-width: 540px\)/);
});

test('all runtime assets stay inside web and need no third-party requests', () => {
  const assets = tags.filter((tag) => tag.name === 'img' || tag.name === 'link')
    .map((tag) => tag.attributes.src || tag.attributes.href);
  for (const [, value] of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) assets.push(value);
  assert.ok(assets.length >= 3);
  for (const asset of assets) {
    assert.ok(asset.startsWith('./'), `Use a local relative asset: ${asset}`);
    const file = path.resolve(WEB, asset);
    assert.ok(file.startsWith(`${WEB}${path.sep}`), `Asset escaped web: ${asset}`);
    assert.ok(fs.statSync(file).isFile(), `Missing asset: ${asset}`);
  }
  assert.doesNotMatch(css, /@import\b/);
  assert.ok(fs.existsSync(path.join(WEB, '.nojekyll')));
});

test('GitHub documentation links resolve to existing source files and heading anchors', () => {
  const prefix = 'https://github.com/scovetta/lights-on/blob/main/';
  const documentation = [...new Set(references.filter((value) => value.startsWith(prefix)))];
  assert.ok(documentation.length >= 10, 'Keep links to the detailed guides');
  for (const reference of documentation) {
    const [relative, fragment] = reference.slice(prefix.length).split('#');
    const file = path.resolve(ROOT, relative);
    assert.ok(file.startsWith(`${ROOT}${path.sep}`), reference);
    const source = fs.readFileSync(file, 'utf8');
    if (!fragment) continue;
    const anchors = [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, heading]) => heading.trim()
      .toLowerCase().replace(/[^\p{L}\p{N}_ -]/gu, '').replace(/ /g, '-'));
    assert.ok(anchors.includes(fragment), `Missing documentation anchor: ${reference}`);
  }
  for (const reference of references.filter((value) => value.startsWith('https://'))) {
    assert.equal(new URL(reference).hostname, 'github.com');
  }
});

test('adoption example keeps rollout settings distinct from shipped defaults', () => {
  const example = html.match(/aria-label="Recommended initial rollout configuration"><code>([\s\S]+?)<\/code>/)?.[1];
  assert.ok(example);
  const config = parseSimpleYaml(example);
  assert.equal(config.autonomy.mode, 'review-only');
  assert.equal(config.autonomy.require_ci_pass, true);
  assert.equal(config.autonomy.require_independent_agent_review, true);
  assert.deepEqual(config.autonomy.required_checks, []);
  assert.equal(config.release.enabled, false);
  assert.equal(config.toolchains.enabled, false);
  for (const secret of ['COPILOT_GITHUB_TOKEN', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY']) {
    assert.ok(html.includes(secret));
  }
  assert.match(html, /25 tool-loop turns per provider attempt/);
  assert.match(html, /100-project evaluation has not run/);
  assert.match(html, /recommended rollout settings, not all shipped defaults/);
});

test('the static site serves navigation and assets at domain root and repository subpaths', async (t) => {
  for (const prefix of ['/', '/lights-on/']) {
    await t.test(prefix, async () => {
      const server = http.createServer((request, response) => {
        const url = new URL(request.url, 'http://localhost');
        if (!url.pathname.startsWith(prefix)) {
          response.writeHead(404).end();
          return;
        }
        const relative = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
        const file = path.resolve(WEB, relative);
        if (!file.startsWith(`${WEB}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
          response.writeHead(404).end();
          return;
        }
        const type = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
        response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
        response.end(fs.readFileSync(file));
      });
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      try {
        const base = `http://127.0.0.1:${server.address().port}${prefix}`;
        for (const reference of new Set(['./', ...localReferences])) {
          const url = new URL(reference, base);
          const response = await fetch(url);
          assert.equal(response.status, 200, `${prefix}: ${reference}`);
          const content = await response.text();
          assert.ok(content.length > 0, reference);
          if (url.pathname === prefix) assert.equal(content, html);
          if (url.pathname.endsWith('.css')) assert.match(response.headers.get('content-type'), /text\/css/);
          if (url.pathname.endsWith('.svg')) assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
        }
        if (prefix !== '/') {
          const response = await fetch(new URL('/assets/site.css', base));
          assert.equal(response.status, 404, 'Do not accidentally serve assets from the domain root');
        }
      } finally {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    });
  }
});

test('Pages publication is manual, default-branch-only and isolated from maintenance permissions', () => {
  assert.deepEqual(workflow.on, { workflow_dispatch: {} });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(Object.keys(workflow.jobs), ['build', 'deploy']);
  assert.equal(workflow.jobs.build.if, "github.ref == format('refs/heads/{0}', github.event.repository.default_branch)");
  assert.deepEqual(workflow.jobs.build.permissions, { contents: 'read' });
  assert.deepEqual(workflow.jobs.deploy.permissions, { pages: 'write', 'id-token': 'write' });
  assert.equal(workflow.jobs.deploy.needs, 'build');
  assert.equal(workflow.jobs.deploy.environment.name, 'github-pages');
  assert.equal(workflow.jobs.deploy.environment.url, '${{ steps.deployment.outputs.page_url }}');
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const source = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  const uses = [...source.matchAll(/uses: ([^\s]+)/g)].map(([, value]) => value);
  assert.equal(uses.length, 4);
  for (const action of uses) assert.match(action, /^actions\/[\w-]+@[a-f0-9]{40}$/);
  assert.match(source, /persist-credentials: false/);
  assert.match(source, /package-manager-cache: false/);
  assert.match(source, /run: node --test tests\/web\.test\.mjs/);
  assert.match(source, /path: web\b/);
  assert.doesNotMatch(source, /secrets\.|enablement:\s*true/);
});
