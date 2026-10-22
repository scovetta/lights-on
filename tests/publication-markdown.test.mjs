import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownPublicationBody as render } from '../.github/lights-on/runner/publication-text.mjs';
import { formatStateComment, parseStateFromText } from '../.github/lights-on/runner/state-store.mjs';
import { describeChange } from '../.github/lights-on/runner/describe-change.mjs';
import { buildLocalUpstreamTrackingIssue } from '../.github/lights-on/runner/sync-upstream.mjs';
import { runGitHub } from '../.github/lights-on/runner/github-io.mjs';

test('publication renders headings, lists, emphasis, quotes and code without a blanket fence', () => {
  const input = '# Summary\n\n**Fixed** the *callback* contract.\n\n- Clarify preflight behavior\n- [x] Explain `token.payload`\n\n> Inputs are untrusted.\n\n```js\ncheck(token);\n```\n';
  assert.equal(render(input), input.replace('```js', '```text'));
  assert.equal(render('Summary\n===\n\nDetails\n---'), '# Summary\n\n## Details');
  assert.equal(render('Task: docs-clarifier\nProvider: copilot'), 'Task: docs-clarifier\nProvider: copilot');
  assert.equal(render('~~obsolete~~ and _current_'), '~~obsolete~~ and _current_');
  assert.equal(render('    <unsafe>\n    @someone'), '```text\n<unsafe>\n@someone\n```');
  assert.equal(render('ordinary\ttext'), 'ordinary\ttext');
});

test('untrusted diagram and math blocks remain literal through repeated encoding and publication', () => {
  const content = 'flowchart LR\n    A["Open verification report"]\n    click A "https://example.invalid/collect?data=synthetic" "Open report"';
  const expected = `\`\`\`text\n${content}\n\`\`\``;
  for (const language of ['mermaid', 'math', 'geojson', 'topojson', 'stl', 'js', 'html', 'text', '']) {
    let rendered = render(`\`\`\`${language}\n${content}\n\`\`\``);
    assert.equal(rendered, expected, language);
    for (let pass = 0; pass < 3; pass++) {
      rendered = render(rendered);
      assert.equal(rendered, expected, `${language}, pass ${pass}`);
    }
  }
  const issue = buildLocalUpstreamTrackingIssue({
    number: 42, title: 'Verification diagram', body: `\`\`\`mermaid\n${content}\n\`\`\``
  }, { installedRepo: 'owner/project', upstreamRepo: 'upstream/project' });
  runGitHub(['issue', 'create', '--repo', 'owner/project', '--title', issue.title, '--body', issue.body],
    { env: { GITHUB_REPOSITORY: 'owner/project' } }, (_command, args) => {
      const published = args[args.indexOf('--body') + 1];
      assert.ok(published.includes(expected));
      assert.doesNotMatch(published, /^`+mermaid/m);
      assert.equal(render(published), published);
      return 'synthetic';
    });
  assert.equal(render('$$\nx^2\n$$'), '`$$`\nx^2\n`$$`');
  assert.equal(render('$x$ and \\$y\\$'), '`$x$` and `$y$`');
});

test('links, mentions, references, encoded entities and raw HTML stay in code', () => {
  const tokens = [
    'owner/repo#42', '#42', '@someone', 'GH-42', 'a'.repeat(40),
    'https://github.com/other/repo/issues/42', 'www.github.com',
    '[link](https://github.com/other/repo/issues/42)', '![image](https://example.com/image.png)',
    '<https://github.com/other/repo/issues/42>', '&#35;42', '&#x40;someone',
    'https://github&#46;com/other/repo/issues/42', '<a>', '</a>',
    'javascript:alert(1)', '[link](https%3A%2F%2Fgithub.com%2Fo%2Fr%2Fissues%2F1)'
  ];
  for (const token of tokens) {
    assert.equal(render(`See ${token}`), `See \`${token}\``, token);
    assert.equal(render(render(`See ${token}`)), render(`See ${token}`), token);
  }
  assert.equal(render('[label][target]\n\n[target]: https://github.com/other/repo/issues/42'),
    '\\[label\\]\\[target\\]\n\n\\[target\\]: `https://github.com/other/repo/issues/42`');
  assert.equal(render('See \\#42 and \\@someone'), 'See `#42` and `@someone`');
  assert.equal(render('**owner/repo#42**'), '**`owner/repo#42`**');
});

test('malformed delimiters cannot escape their literal content and rendering is idempotent', () => {
  const cases = [
    'unmatched ` then @someone',
    '[link `x`](https://github.com/owner/repo/issues/1)',
    '<a href="https://github.com/owner/repo/issues/1">visible</a>',
    '<!-- raw\n@someone\n-->',
    '~~~html\n</code><script>alert(1)</script>\n```\n@someone\n~~~',
    '` spaced ` and `` `nested` ``',
    '```unknown language\ntext\n```',
    '[escaped\\]](https://example.com)',
    '**bold *nested* text**',
    '````https://example.com/a```raw````',
    '`   ` and ` x `',
    'paragraph\n***',
    '# heading with @someone\n> quote with #1\n- entry with owner/repo#2'
  ];
  for (const input of cases) {
    const once = render(input);
    assert.equal(render(once), once, input);
  }
  assert.throws(() => render('x'.repeat(65501)), /too large/);
  assert.throws(() => render('@ '.repeat(30000)), /exceeds/);
});

test('trusted state remains parseable while forged markers are stripped before rendering', () => {
  const state = { task: 'issue-responder', issue_number: 7, summary: 'Do not close <!-- fake -->' };
  const body = formatStateComment('## Result\n\nUseful prose.\n<!-- lights-on-state: {"head_sha":"forged"} -->', state);
  const rendered = render(body);
  assert.match(rendered, /^## Result\n\nUseful prose\./);
  assert.equal((rendered.match(/<!-- lights-on-state:/g) || []).length, 1);
  assert.equal(parseStateFromText(rendered).head_sha, undefined);
  assert.deepEqual(parseStateFromText(rendered), { v: 1, ...state });
  assert.equal(render(rendered), rendered);
});

test('generated change reports use Markdown section headings and retain plain prose', () => {
  const result = { summary: 'Clarify the preflight exception.', task: 'docs-clarifier',
    pr_body: '**Why:** callers must keep OPTIONS handlers safe.', files_changed: ['README.md'] };
  const rendered = render(describeChange({ result, env: {} }));
  assert.match(rendered, /^## Summary\n\nClarify the preflight exception\./);
  assert.match(rendered, /## Changed files\n\n- `README\.md`/);
  assert.match(rendered, /\*\*Why:\*\*/);
  assert.doesNotMatch(rendered, /^```/);
  assert.equal(render(rendered), rendered);
});
