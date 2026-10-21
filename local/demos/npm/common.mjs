import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, repository, image, validatePolicy, NODE_IMAGE } from '../../policy.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PROVIDERS = {
  codex: ['OPENAI_API_KEY', 'api.openai.com', '/v1/responses', 'Authorization', 'Bearer '],
  claude: ['ANTHROPIC_API_KEY', 'api.anthropic.com', '/v1/messages', 'x-api-key', ''],
  openrouter: ['OPENROUTER_API_KEY', 'openrouter.ai', '/api/v1/chat/completions', 'Authorization', 'Bearer '],
  copilot: ['COPILOT_GITHUB_TOKEN', 'api.github.com', '/copilot_internal/v2/token', 'Authorization', 'token ']
};
export const TEST_COMMAND = 'npm ci --offline --ignore-scripts --no-audit --no-fund && npm run build --if-present && npm run lint --if-present && npm test';
export const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
export const saveJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });

export function parseOptions(args, command) {
  const names = command === 'setup'
    ? ['directory', 'repo', 'ref', 'registry', 'provider', 'model', 'controller-image']
    : ['directory', 'task'];
  const flags = command === 'setup' ? ['github-auth', 'help'] : ['allow-inference', 'help'];
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, '');
    assert(args[i] === `--${key}` && !Object.hasOwn(options, key), `Unknown or duplicate argument: ${args[i]}`);
    if (flags.includes(key)) options[key] = true;
    else {
      assert(names.includes(key) && args[i + 1] && !args[i + 1].startsWith('--'), `Unknown or incomplete argument: ${args[i]}`);
      options[key] = args[++i];
    }
  }
  if (options.help) return options;
  assert(options.directory, 'Specify --directory outside the Lights On checkout.');
  if (command === 'setup') {
    options.repo = repository(options.repo);
    assert(options.repo !== 'scovetta/lights-on', 'Do not run maintenance against the Lights On source repository.');
    options.provider ||= 'codex';
    assert(Object.hasOwn(PROVIDERS, options.provider), 'Provider must be codex, claude, openrouter or copilot.');
    if (options.registry) options.registry = registryUrl(options.registry);
    if (options['controller-image']) image(options['controller-image']);
  } else {
    options.task ||= 'validate';
    assert(['validate', 'scan', 'docs-clarifier'].includes(options.task), 'Demo task must be validate, scan or docs-clarifier.');
    assert(options.task !== 'docs-clarifier' || options['allow-inference'],
      'The agent can incur provider charges. Pass --allow-inference explicitly.');
  }
  return options;
}

export function registryUrl(value) {
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.href.includes('?') && !url.href.includes('#'),
    'The npm registry must be an HTTPS URL without embedded credentials, query or fragment.');
  return url.href.endsWith('/') ? url.href : `${url.href}/`;
}

export function configuredRegistry() {
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm config get registry'], { encoding: 'utf8' })
    : spawnSync('npm', ['config', 'get', 'registry'], { encoding: 'utf8' });
  assert(result.status === 0, 'Could not read npm config get registry; install npm or specify --registry.');
  return registryUrl(result.stdout.trim());
}

export function forwardWindows(script, args, options) {
  if (process.platform !== 'win32') return false;
  const distro = process.env.LIGHTS_ON_WSL_DISTRO || 'AzureLinux3.0';
  const convert = (file) => {
    const mapped = spawnSync('wsl.exe', ['-d', distro, '--exec', 'wslpath', '-a', path.resolve(file)], { encoding: 'utf8' });
    assert(mapped.status === 0, 'Could not map the demo path into WSL.');
    return mapped.stdout.trim();
  };
  const mapped = [...args];
  mapped[mapped.indexOf('--directory') + 1] = convert(options.directory);
  if (script === 'setup.mjs' && !options.registry) mapped.push('--registry', configuredRegistry());
  const provider = options.provider || readJson(path.join(options.directory, 'demo.json')).provider;
  const keys = ['LIGHTS_ON_DEMO_GITHUB_TOKEN'];
  if (script === 'run.mjs' && options.task === 'docs-clarifier') keys.push(PROVIDERS[provider][0]);
  const child = spawnSync('wsl.exe', ['-d', distro, '--exec', 'node', convert(path.join(HERE, script)), ...mapped], {
    stdio: 'inherit', env: { ...process.env, WSLENV: [process.env.WSLENV, ...keys].filter(Boolean).join(':') }
  });
  process.exitCode = child.status ?? 1;
  return true;
}

export function demoPolicy(options, { worker = NODE_IMAGE, inference = false, validation = true } = {}) {
  const repo = repository(options.repo);
  assert(repo !== 'scovetta/lights-on', 'Do not target the Lights On source repository.');
  const credential = options['github-auth'] ? 'LIGHTS_ON_DEMO_GITHUB_TOKEN' : null;
  const credentials = credential ? { [credential]: { env: credential } } : {};
  const apiAuth = credential ? { credential, header: 'Authorization', prefix: 'Bearer ' } : {};
  const rules = [
    { id: 'repository', host: 'api.github.com', path: `/repos/${repo}`, methods: ['GET'], roles: ['fetch'], ...apiAuth },
    { id: 'repository-context', host: 'api.github.com', path: `/repos/${repo}/`, methods: ['GET'], roles: ['fetch'], ...apiAuth },
    { id: 'git-fetch', host: 'github.com', path: `/${repo}.git/`, methods: ['GET', 'POST'], roles: ['fetch'],
      ...(credential ? { credential, header: 'Authorization', basicUser: 'x-access-token' } : {}) },
    { id: 'advisories', host: 'api.osv.dev', path: '/v1/', methods: ['POST'], roles: ['analysis'] },
    { id: 'package-context', host: 'packages.ecosyste.ms', path: '/api/v1/', methods: ['GET'], roles: ['analysis'] }
  ];
  if (inference) {
    const [key, host, route, header, prefix] = PROVIDERS[options.provider];
    credentials[key] = { env: key };
    rules.push({ id: 'inference', host, path: route, methods: [options.provider === 'copilot' ? 'GET' : 'POST'],
      roles: ['analysis'], credential: key, header, prefix });
    if (options.provider === 'copilot') {
      for (const [index, route] of ['/user', '/user/copilot'].entries()) {
        rules.push({ id: `copilot-discovery-${index}`, host, path: route, methods: ['GET'], roles: ['analysis'],
          credential: key, header, prefix });
      }
      for (const [index, host] of ['api.githubcopilot.com', 'api.individual.githubcopilot.com',
        'api.business.githubcopilot.com', 'api.enterprise.githubcopilot.com'].entries()) {
        rules.push({ id: `copilot-inference-${index}`, host, path: '/', methods: ['GET', 'POST'],
          roles: ['analysis'], forwardAuthorization: true });
      }
    }
  }
  return validatePolicy({
    version: 1, repository: repo, provider: options.provider, ...(options.model ? { model: options.model } : {}),
    images: { worker, controller: inference ? options['controller-image'] || NODE_IMAGE : NODE_IMAGE },
    credentials, capabilities: [], rules,
    profiles: validation ? [{ id: 'npm', image: worker, platform: 'linux/amd64',
      commands: [TEST_COMMAND], timeoutSeconds: 300, resources: { memory: 2048, cpus: 2, pids: 128 } }] : [],
    bundles: [], npmRegistry: options.registry
  });
}

export function lockedPackages(manifest, lock, { generated = false } = {}) {
  assert(manifest && lock && !manifest.workspaces && !lock.packages?.['']?.workspaces,
    'The demo supports one root npm package, not workspaces.');
  assert(typeof manifest.scripts?.test === 'string' && manifest.scripts.test.trim() &&
    !manifest.scripts.test.includes('no test specified'), 'The target needs a real npm test script.');
  assert([2, 3].includes(lock.lockfileVersion) && lock.packages && typeof lock.packages === 'object' &&
    !Array.isArray(lock.packages) && lock.packages[''], 'A package-lock.json v2/v3 is required.');
  const packages = new Map();
  for (const [location, entry] of Object.entries(lock.packages)) {
    if (!location) continue;
    assert(entry && typeof entry === 'object' && !entry.inBundle &&
      (typeof entry.resolved === 'string' || generated && entry.resolved === undefined),
      'Bundled or unresolved dependencies are not supported by this demo.');
    assert(location.startsWith('node_modules/') && !location.includes('\\') &&
      location.split('/').every((part) => part && part !== '.' && part !== '..') && !entry.link,
    'Local links and workspace packages are not supported by this demo.');
    const name = entry.name || location.split('node_modules/').at(-1);
    assert(/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(name) &&
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(entry.version),
    'Each dependency must have a registry package name and exact version.');
    if (entry.resolved !== undefined) {
      const resolved = new URL(entry.resolved);
      assert(resolved.protocol === 'https:' && !resolved.username && !resolved.password,
        'Only HTTPS registry artifacts are supported, not Git/file dependencies.');
    }
    assert(typeof entry.integrity === 'string' && entry.integrity.split(/\s+/).some((value) =>
      /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value) || generated && /^sha1-[A-Za-z0-9+/]+={0,2}$/.test(value)),
    'The demo requires SHA-512 lockfile integrity; generated registry resolutions may supply legacy SHA-1 for verification.');
    const spec = `${name}@${entry.version}`;
    assert(!packages.has(spec) || packages.get(spec).integrity === entry.integrity, 'Conflicting integrity for the same package/version.');
    if (packages.has(spec)) packages.get(spec).locations.push(location);
    else packages.set(spec, { name, version: entry.version, integrity: entry.integrity, spec, locations: [location] });
  }
  assert(packages.size <= 512, 'This small-project demo supports at most 512 distinct package versions.');
  return [...packages.values()];
}

export function checkArchive(file, entry, { generated = false } = {}) {
  const stat = fs.lstatSync(file);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 100 * 1024 * 1024, 'Invalid or excessive package archive.');
  const content = fs.readFileSync(file);
  const sha512 = crypto.createHash('sha512').update(content).digest('base64');
  const tokens = entry.integrity.split(/\s+/);
  const strong = tokens.filter((token) => token.startsWith('sha512-'));
  const valid = (strong.length ? strong : generated ? tokens : []).some((token) => {
    if (token === `sha512-${sha512}`) return true;
    const match = generated && token.match(/^sha1-([A-Za-z0-9+/]+={0,2})$/);
    return match && crypto.createHash('sha1').update(content).digest('base64') === match[1];
  });
  assert(valid, `Registry content does not match lockfile integrity for ${entry.spec}.`);
  return { bytes: stat.size, integrity: `sha512-${sha512}` };
}

export function runOutcome(directory) {
  const run = readJson(path.join(directory, 'run.json'));
  const result = readJson(path.join(directory, 'result.json'));
  const validation = readJson(path.join(directory, 'validation.json'));
  assert(run.status === 'completed' && result.status === 'completed' && validation.status === 'passed',
    `Demo did not pass: run=${run.status}, task=${result.status}, validation=${validation.status}. Inspect ${path.join(directory, 'summary.md')} and validation.json.`);
  assert(!fs.existsSync(path.join(directory, 'publication.json')), 'Unexpected publication record in a read-only demo.');
  return { run, result, validation };
}
