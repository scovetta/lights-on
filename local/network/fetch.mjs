import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { cachedFetch } from './cache.mjs';

// Node's built-in environment proxy agent preserves normal TLS certificate validation.
export async function proxyFetch(url, options = {}) {
  const { allowNotFound = false, ...request } = options;
  const response = await cachedFetch(url, { ...request, redirect: 'error',
    signal: options.signal || AbortSignal.timeout(120000) });
  if (!response.ok && !(allowNotFound && response.status === 404)) throw new Error(`Protected request failed (HTTP ${response.status}).`);
  return response;
}

export function proxyEnvironment(proxy, extra = {}) {
  return { PATH: process.env.PATH, HOME: '/tmp/home', CI: 'true',
    HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: '',
    NODE_USE_ENV_PROXY: '1', NODE_EXTRA_CA_CERTS: '/egress/ca.pem',
    SSL_CERT_FILE: '/egress/ca.pem', REQUESTS_CA_BUNDLE: '/egress/ca.pem',
    GIT_SSL_CAINFO: '/egress/ca.pem', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', ...extra };
}

export function command(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000,
    maxBuffer: 10 * 1024 * 1024, ...options });
  if (result.status !== 0) throw new Error(`Protected ${command} failed (${result.error?.code || result.status}).`);
  return result.stdout;
}

export async function github(endpoint, { method = 'GET', body, ...options } = {}) {
  const response = await proxyFetch(`https://api.github.com/${endpoint}`, {
    method, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Lights-On-local',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}), ...options
  });
  return response.status === 204 || options.allowNotFound && response.status === 404 ? null : response.json();
}

export async function pages(endpoint) {
  const values = [];
  for (let page = 1; page <= 30; page++) {
    const result = await github(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    if (!Array.isArray(result)) throw new Error('Invalid paginated GitHub response.');
    values.push(...result);
    if (result.length < 100) return values;
  }
  throw new Error('GitHub pagination exceeds bounded inventory; refusing incomplete evidence.');
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}
