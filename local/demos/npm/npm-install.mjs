import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const inputs = '/opt/lights-on-npm-inputs';
let temporary;
try {
  const args = process.argv.slice(2);
  if (args[0] !== 'ci' || args.slice(1).some((arg) => !['--offline', '--ignore-scripts', '--no-audit', '--no-fund'].includes(arg))) {
    throw new Error('The generated-lock demo supports npm ci with --offline, --ignore-scripts, --no-audit and --no-fund only.');
  }
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json']) {
    if (fs.lstatSync(name, { throwIfNoEntry: false })) throw new Error(`Refusing to replace ${name}.`);
  }
  const stat = fs.lstatSync('package.json');
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('A regular root package.json is required.');
  const manifest = fs.readFileSync('package.json');
  const expected = fs.readFileSync(path.join(inputs, 'manifest.sha256'), 'utf8').trim();
  if (crypto.createHash('sha256').update(manifest).digest('hex') !== expected) {
    throw new Error('package.json changed since demo preparation; regenerate the demo inputs.');
  }
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-npm-install-'));
  fs.writeFileSync(path.join(temporary, 'package.json'), manifest);
  fs.copyFileSync(path.join(inputs, 'package-lock.json'), path.join(temporary, 'package-lock.json'));
  for (const name of ['user.npmrc', 'global.npmrc']) fs.writeFileSync(path.join(temporary, name), '');
  const result = spawnSync(process.execPath, ['/usr/local/lib/node_modules/npm/bin/npm-cli.js',
    'ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--update-notifier=false',
    '--userconfig', path.join(temporary, 'user.npmrc'), '--globalconfig', path.join(temporary, 'global.npmrc')], {
    cwd: temporary, env: process.env, stdio: 'inherit'
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
  if (process.exitCode === 0) {
    const modules = path.join(process.cwd(), 'node_modules');
    fs.rmSync(modules, { recursive: true, force: true });
    const installed = path.join(temporary, 'node_modules');
    if (fs.existsSync(installed)) fs.cpSync(installed, modules, { recursive: true, verbatimSymlinks: true });
  }
} catch (error) {
  console.error(`Prepared npm install failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
}
