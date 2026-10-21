import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { assert } from './policy.mjs';

const policy = JSON.parse(fs.readFileSync('/work/policy.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('/work/package.json', 'utf8'));
assert(policy.npmRegistry && !manifest.scripts && !manifest.workspaces, 'Lock resolution requires an inert npm manifest.');
fs.writeFileSync('/tmp/npm-user.npmrc', '');
fs.writeFileSync('/tmp/npm-global.npmrc', '');
const result = spawnSync('npm', ['install', '--package-lock-only', '--lockfile-version=3',
  '--omit-lockfile-registry-resolved=true', '--ignore-scripts',
  '--no-audit', '--no-fund', '--update-notifier=false', '--registry', policy.npmRegistry,
  '--userconfig', '/tmp/npm-user.npmrc', '--globalconfig', '/tmp/npm-global.npmrc',
  '--cache', '/tmp/npm-cache'], {
  cwd: '/work', env: process.env, timeout: policy.limits.timeoutSeconds * 1000, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024
});
fs.writeFileSync('/work/npm-lock.log', `${result.stdout || ''}\n${result.stderr || ''}`.slice(-65536), { mode: 0o600 });
assert(result.status === 0,
  `npm lock resolution failed (${result.error?.code || result.status}); inspect dependency-resolution.log.`);
assert(fs.existsSync('/work/package-lock.json') && !fs.existsSync('/work/node_modules'),
  'Lock resolution must produce a lockfile without installing packages.');
