import fs from 'node:fs';
import https from 'node:https';
import { execFileSync } from 'node:child_process';

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
  '-keyout', '/fixture/key.pem', '-out', '/fixture/ca.pem', '-days', '1',
  '-subj', '/CN=api.github.com', '-addext', 'subjectAltName=DNS:api.github.com,DNS:github.com,DNS:api.openai.com,DNS:api.anthropic.com,DNS:openrouter.ai,DNS:packagefeedproxy.microsoft.io'], { stdio: 'ignore' });
const git = (args, options = {}) => execFileSync('git', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options });
git(['init', '-b', 'main', '/fixture/repository']);
fs.writeFileSync('/fixture/repository/README.md', 'Controlled Lights On fixture.\n');
fs.writeFileSync('/fixture/repository/test.js', 'console.log("fixture validation passed");\n');
if (process.env.LIGHTS_ON_TEST_NPM === 'true') {
  const pkg = { name: 'lights-on-fixture-project', version: '1.0.0', scripts: { test: 'node test.js' } };
  fs.writeFileSync('/fixture/repository/package.json', JSON.stringify(pkg));
  fs.writeFileSync('/fixture/repository/package-lock.json',
    JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': pkg } }));
}
git(['-C', '/fixture/repository', 'add', '.']);
git(['-C', '/fixture/repository', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
const sha = git(['-C', '/fixture/repository', 'rev-parse', 'HEAD']).trim();
git(['-C', '/fixture/repository', 'checkout', '-b', 'limited']);
fs.mkdirSync('/fixture/repository/.github');
fs.writeFileSync('/fixture/repository/.github/lights-on.yml', 'limits:\n  max_turns_per_run: 1\n');
git(['-C', '/fixture/repository', 'add', '.github/lights-on.yml']);
git(['-C', '/fixture/repository', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
  'commit', '-m', 'bounded fixture']);
const limitedSha = git(['-C', '/fixture/repository', 'rev-parse', 'HEAD']).trim();
git(['-C', '/fixture/repository', 'checkout', 'main']);
git(['clone', '--bare', '/fixture/repository', '/fixture/repo.git']);
let copilotCalls = 0;
const mutations = [];
https.createServer({ key: fs.readFileSync('/fixture/key.pem'), cert: fs.readFileSync('/fixture/ca.pem') }, async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  if (req.url === '/npm/fixture-lock-dep') {
    fs.writeFileSync('/fixture/npm-connection.json', JSON.stringify(req.headers.connection));
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ name: 'fixture-lock-dep', 'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': { name: 'fixture-lock-dep', version: '1.0.0',
        scripts: { prepare: 'exit 9', install: 'exit 9' },
        dist: { tarball: 'https://packagefeedproxy.microsoft.io/npm/fixture-lock-dep/-/fixture-lock-dep-1.0.0.tgz',
          integrity: `sha512-${Buffer.alloc(64).toString('base64')}` } } } }));
    return;
  }
  if (req.url.startsWith('/npm/fixture-lock-dep/')) {
    fs.writeFileSync('/fixture/tarball-requested', 'unexpected');
    res.writeHead(404); res.end(); return;
  }
  if (req.url === '/npm/offline.txt') {
    fs.appendFileSync('/fixture/bundle-downloads.txt', 'download\n');
    res.end('offline bundle fixture');
    return;
  }
  if (req.url.startsWith('/repos/scovetta/test-aw1/') && req.method === 'POST') {
    mutations.push({ path: req.url, body: JSON.parse(body) });
    fs.writeFileSync('/fixture/mutations.json', JSON.stringify(mutations));
    res.setHeader('Content-Type', 'application/json');
    const response = req.url.endsWith('/pulls') ? { number: 7, html_url: 'https://github.com/scovetta/test-aw1/pull/7',
      head: { sha: 'd'.repeat(40) }, base: { repo: { full_name: 'scovetta/test-aw1' } } } :
      req.url.endsWith('/issues') ? { html_url: 'https://github.com/scovetta/test-aw1/issues/7' } : { sha: 'd'.repeat(40) };
    res.end(JSON.stringify(response));
    return;
  }
  if (req.url === '/repos/scovetta/test-aw1') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ full_name: 'scovetta/test-aw1', default_branch: 'main' }));
  } else if (req.url.startsWith('/repos/scovetta/test-aw1/commits/')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sha: req.url.endsWith('/limited') ? limitedSha : sha }));
  } else if (req.url.startsWith('/repos/scovetta/test-aw1/git/commits/')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ sha, tree: { sha: 'c'.repeat(40) } }));
  } else if (req.url.startsWith('/scovetta/test-aw1.git/')) {
    const url = new URL(req.url, 'https://github.com');
    const output = execFileSync('/usr/lib/git-core/git-http-backend', [], {
      input: body, env: { PATH: process.env.PATH, GIT_PROJECT_ROOT: '/fixture', GIT_HTTP_EXPORT_ALL: '1',
        PATH_INFO: url.pathname.replace('/scovetta/test-aw1.git', '/repo.git'),
        QUERY_STRING: url.search.slice(1), REQUEST_METHOD: req.method, CONTENT_TYPE: req.headers['content-type'] || '',
        CONTENT_LENGTH: String(body.length), REMOTE_ADDR: '127.0.0.1' }
    });
    const split = output.indexOf('\r\n\r\n');
    for (const header of output.subarray(0, split).toString().split('\r\n')) {
      const index = header.indexOf(':');
      if (index > 0 && header.slice(0, index).toLowerCase() !== 'status') res.setHeader(header.slice(0, index), header.slice(index + 1).trim());
    }
    res.end(output.subarray(split + 4));
  } else if (req.url === '/v1/messages') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'tool_use', id: 'test', name: 'finish_task', input: { summary: 'fixture', action_taken: 'none' } }] }));
  } else if (req.url === '/v1/responses') {
    const request = JSON.parse(body);
    if (JSON.stringify(request.input).includes('Task Instructions (security-remediator)') &&
        !JSON.stringify(request.input).includes('/work/dependencies.json')) {
      res.statusCode = 400;
      res.end('Security remediation requires dependency/advisory context.');
      return;
    }
    const docs = JSON.stringify(request.input).includes('Task Instructions (docs-clarifier)');
    const written = request.input.some((item) => item.type === 'function_call_output');
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ usage: { input_tokens: 10, output_tokens: 5 }, output: [
      docs && !written
        ? { type: 'function_call', call_id: 'write', name: 'write_file',
          arguments: '{"path":"README.md","content":"Updated controlled documentation.\\n"}' }
        : { type: 'function_call', call_id: 'finish', name: 'finish_task',
          arguments: '{"summary":"fixture","action_taken":"docs_updated","pr_title":"Docs upstream/repo#123","pr_body":"[external](https://github.com/upstream/repo/issues/1)"}' }
    ] }));
  } else if (req.url === '/api/v1/chat/completions' || req.url === '/v1/chat/completions') {
    const request = JSON.parse(body);
    const copilot = req.url === '/v1/chat/completions';
    if (copilot && (request.tools || []).length) { res.statusCode = 400; res.end('Native tools exposed'); return; }
    let text = copilot && ++copilotCalls === 1 ? '<invoke name="finish_task"/>' :
      '{"name":"finish_task","arguments":{"summary":"fixture","action_taken":"none"}}';
    if (request.response_format?.type === 'json_schema') {
      text = JSON.stringify({ name: 'finish_task', arguments_json: '{"summary":"fixture","action_taken":"none"}' });
    }
    if (request.stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const event = (delta, finish_reason = null) => 'data: ' + JSON.stringify({
        id: 'test', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
        ...(finish_reason ? { usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } } : {})
      }) + '\n\n';
      res.end(event({ role: 'assistant', content: text }) + event({}, 'stop') + 'data: [DONE]\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ choices: [{ index: 0, finish_reason: copilot ? 'stop' : 'tool_calls',
        message: copilot ? { role: 'assistant', content: text } : { role: 'assistant',
          tool_calls: [{ id: 'test', type: 'function', function: { name: 'finish_task', arguments: '{"summary":"fixture","action_taken":"none"}' } }]
        } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }));
    }
  } else { res.statusCode = 404; res.end('{}'); }
}).listen(443, '0.0.0.0', () => fs.writeFileSync('/fixture/ready', 'ready'));
