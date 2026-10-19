import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const NODE_IMAGE = 'node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0';
export const PROXY_IMAGE = 'mitmproxy/mitmproxy@sha256:743b6cdc817211d64bc269f5defacca8d14e76e647fc474e5c7244dbcb645141';
export const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
export const digestObject = (value) => hash(JSON.stringify(value));
export const CAPABILITIES = ['publish', 'merge', 'release', 'registry-publish'];
export const ROLES = ['fetch', 'analysis', 'prepare', 'publisher'];
export const TASKS = ['validate', 'scan', 'dependencies', 'migration-plan', 'migration',
  'toolchains', 'upstream', 'release', 'issue-responder', 'docs-clarifier',
  'security-remediator', 'security-fixer', 'bootstrap-threat-model', 'pr-reviewer'];

export const normalizeTask = (task) => task === 'security-fixer' ? 'security-remediator' : task;

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function exactKeys(value, allowed, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object.`);
  assert(Object.keys(value).every((key) => allowed.includes(key)), `Unknown ${label} field.`);
}

export function repository(value) {
  assert(typeof value === 'string' && /^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value),
    'Repository must be a GitHub.com owner/name, without a URL or credentials.');
  return value.toLowerCase();
}

export function image(value) {
  assert(typeof value === 'string' && /^(?:[a-z0-9][a-z0-9./:_-]*@)?sha256:[a-f0-9]{64}$/.test(value),
    'Images must be immutable sha256 IDs or digest-pinned references.');
  return value;
}

export function relativeFile(value) {
  assert(typeof value === 'string' && value.length > 0 && !/^[\\/]|[\\:\x00-\x1f\x7f]/.test(value) &&
    value.split('/').every((part) => part && part !== '.' && part !== '..'), 'Unsafe relative file path.');
  return value;
}

export function integer(value, min, max, label) {
  assert(Number.isSafeInteger(value) && value >= min && value <= max, `Invalid ${label}.`);
  return value;
}

export function validatePolicy(raw) {
  exactKeys(raw, ['version', 'repository', 'upstreams', 'images', 'rules', 'credentials', 'limits',
    'profiles', 'capabilities', 'provider', 'model', 'bundles', 'npmRegistry', 'upstreamCaFile'], 'policy');
  assert(raw.version === 1, 'Unsupported local policy version.');
  const policy = structuredClone(raw);
  policy.repository = repository(policy.repository);
  policy.upstreams = (policy.upstreams || []).map(repository);
  exactKeys(policy.images || {}, ['controller', 'proxy', 'worker'], 'images');
  policy.images = { controller: NODE_IMAGE, proxy: PROXY_IMAGE, worker: NODE_IMAGE, ...policy.images };
  Object.values(policy.images).forEach(image);
  policy.capabilities ||= [];
  assert(Array.isArray(policy.capabilities) && policy.capabilities.every((cap) => CAPABILITIES.includes(cap)),
    'Invalid publication capability.');
  policy.provider ||= 'copilot';
  assert(['copilot', 'claude', 'codex', 'openrouter'].includes(policy.provider), 'Unsupported provider.');
  if (policy.model !== undefined) assert(typeof policy.model === 'string' && /^[a-zA-Z0-9/_.:-]+$/.test(policy.model), 'Invalid model.');
  policy.credentials ||= {};
  exactKeys(policy.credentials, Object.keys(policy.credentials), 'credentials');
  for (const [name, source] of Object.entries(policy.credentials)) {
    assert(/^[A-Z][A-Z0-9_]{0,80}$/.test(name), 'Invalid credential name.');
    exactKeys(source, ['env', 'file'], 'credential source');
    assert(Boolean(source.env) !== Boolean(source.file), 'Credential requires exactly one env or file source.');
    if (source.env) assert(/^[A-Z][A-Z0-9_]{0,80}$/.test(source.env), 'Invalid credential environment key.');
    if (source.file) assert(path.isAbsolute(source.file), 'Credential files must use absolute paths.');
  }
  policy.limits = { requests: 500, requestBytes: 1048576, responseBytes: 104857600,
    totalBytes: 536870912, timeoutSeconds: 900, ...policy.limits };
  exactKeys(policy.limits, ['requests', 'requestBytes', 'responseBytes', 'totalBytes', 'timeoutSeconds'], 'limits');
  for (const [key, value] of Object.entries(policy.limits)) integer(value, 1, key === 'timeoutSeconds' ? 86400 : 2147483647, key);
  policy.rules ||= [];
  assert(Array.isArray(policy.rules) && policy.rules.length <= 100, 'Invalid egress rules.');
  const ids = new Set();
  for (const rule of policy.rules) {
    exactKeys(rule, ['id', 'host', 'path', 'methods', 'roles', 'credential', 'header', 'prefix',
      'basicUser', 'forwardAuthorization'], 'egress rule');
    assert(typeof rule.id === 'string' && /^[a-z0-9-]{1,60}$/.test(rule.id) && !ids.has(rule.id), 'Invalid/duplicate rule ID.');
    ids.add(rule.id);
    assert(typeof rule.host === 'string' && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(rule.host) &&
      rule.host.includes('.') && !/^\d[\d.]+$/.test(rule.host), 'Rules require exact DNS hostnames.');
    assert(typeof rule.path === 'string' && rule.path.startsWith('/') &&
      !/[\\%?#\x00-\x20]/.test(rule.path) && !rule.path.split('/').some((p) => p === '.' || p === '..'), 'Invalid rule path.');
    assert(Array.isArray(rule.methods) && rule.methods.length &&
      rule.methods.every((m) => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m)), 'Invalid rule methods.');
    assert(Array.isArray(rule.roles) && rule.roles.length && rule.roles.every((role) => ROLES.includes(role)), 'Invalid rule roles.');
    if (rule.credential) {
      assert(Object.hasOwn(policy.credentials, rule.credential), 'Rule references an unknown credential.');
      assert(['Authorization', 'x-api-key', 'X-NuGet-ApiKey'].includes(rule.header), 'Unsupported credential header.');
      assert(typeof (rule.prefix || '') === 'string' && !/[\r\n]/.test(rule.prefix || ''), 'Invalid credential prefix.');
    }
    if (rule.basicUser) assert(rule.credential && rule.header === 'Authorization' && !rule.prefix &&
      /^[A-Za-z0-9_-]+$/.test(rule.basicUser), 'Invalid Basic credential binding.');
    if (rule.forwardAuthorization !== undefined) {
      assert(rule.forwardAuthorization === true && !rule.credential && policy.provider === 'copilot' &&
        rule.roles.length === 1 && rule.roles[0] === 'analysis' &&
        /^(?:api|api\.individual|api\.business|api\.enterprise)\.githubcopilot\.com$/.test(rule.host),
      'Forwarded credentials are limited to the selected Copilot inference service.');
    }
  }
  policy.profiles ||= [];
  assert(Array.isArray(policy.profiles), 'Profiles must be an array.');
  policy.bundles ||= [];
  assert(Array.isArray(policy.bundles), 'Bundles must be an array.');
  for (const bundle of policy.bundles) {
    exactKeys(bundle, ['name', 'url', 'sha256'], 'bundle');
    relativeFile(bundle.name);
    assert(!bundle.name.includes('/') && /^[a-f0-9]{64}$/.test(bundle.sha256), 'Invalid bundle identity.');
    const url = new URL(bundle.url);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.hash, 'Invalid bundle URL.');
  }
  if (policy.npmRegistry) {
    const url = new URL(policy.npmRegistry);
    assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash, 'Invalid npm registry.');
  }
  if (policy.upstreamCaFile) assert(path.isAbsolute(policy.upstreamCaFile), 'Upstream CA file must be absolute.');
  return policy;
}

export function readPolicy(file) {
  const raw = fs.readFileSync(file);
  assert(raw.length <= 1048576, 'Policy exceeds size limit.');
  return validatePolicy(JSON.parse(raw));
}

export function grantedCapabilities(policy, requested = []) {
  assert(requested.every((cap) => policy.capabilities.includes(cap)), 'Capability not granted by operator policy.');
  return [...new Set(requested)];
}

export function readSecrets(policy, env = process.env, names = Object.keys(policy.credentials)) {
  return Object.fromEntries([...new Set(names)].map((name) => {
    const source = policy.credentials[name];
    assert(source, `Unknown credential ${name}.`);
    const value = source.env ? env[source.env] : fs.readFileSync(source.file, 'utf8').trim();
    assert(typeof value === 'string' && value.length > 0 && value.length <= 16384 && !/[\r\n\x00]/.test(value),
      `Missing or invalid credential ${name}.`);
    return [name, value];
  }));
}

export function operationCredentials(policy, command, capabilities = []) {
  const roles = command === 'prepare' ? ['prepare'] : command === 'publish' ? ['publisher'] :
    ['fetch', 'analysis', ...(capabilities.length ? ['publisher'] : [])];
  const names = policy.rules.filter((rule) => rule.roles.some((role) => roles.includes(role)))
    .map((rule) => rule.credential).filter(Boolean);
  if (command === 'run' && policy.provider === 'copilot' && policy.credentials.COPILOT_GITHUB_TOKEN) names.push('COPILOT_GITHUB_TOKEN');
  if (capabilities.includes('registry-publish')) names.push('REGISTRY_TOKEN');
  return [...new Set(names)];
}
