import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assert, image, exactKeys, integer, digestObject } from './policy.mjs';
import { inventory } from '../.github/lights-on/runner/agent-sandbox.mjs';

export const CODE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const UID = process.getuid?.() || 1000;
const GID = process.getgid?.() || 1000;

export function privateDirectory(directory) {
  if (fs.existsSync(directory)) assert(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(),
    'Managed directories cannot be symlinks or files.');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  if (process.platform === 'linux' && process.getuid() === 0) fs.chownSync(directory, UID, GID);
  return directory;
}

export function writePrivate(file, data) {
  fs.writeFileSync(file, data, { mode: 0o600 });
  if (process.platform === 'linux' && process.getuid() === 0) fs.chownSync(file, UID, GID);
}

export function copyWorkspace(source, destination) {
  const files = inventory(source, { omitLocal: true });
  privateDirectory(destination);
  for (const [name, entry] of files) {
    const target = path.join(destination, name);
    privateDirectory(path.dirname(target));
    writePrivate(target, fs.readFileSync(path.join(source, name)));
    fs.chmodSync(target, entry.mode & 0o755);
  }
  return files;
}

export function docker(args, { timeout = 120000, allowFailure = false, ...options } = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout,
    maxBuffer: 4 * 1024 * 1024, env: { PATH: process.env.PATH, HOME: process.env.HOME }, ...options });
  if (!allowFailure && result.status !== 0) {
    throw new Error(`Container operation ${args[0]} failed (${result.error?.code || result.status}): ${(result.stderr || '').slice(0, 1000)}`);
  }
  return result;
}

export function mount(source, target, readOnly = false) {
  assert(path.isAbsolute(source) && !/[,\r\n]/.test(source), 'Invalid managed mount path.');
  return ['--mount', `type=bind,source=${source},target=${target}${readOnly ? ',readonly' : ''}`];
}

export function restrictions({ memory = 2048, cpus = 2, pids = 128, network = 'none',
  fileBytes = 104857600, tmpMiB = 512 } = {}) {
  integer(memory, 64, 16384, 'worker memory');
  integer(cpus, 1, 16, 'worker CPUs');
  integer(pids, 16, 1024, 'worker process limit');
  integer(fileBytes, 1048576, 536870912, 'file size limit');
  integer(tmpMiB, 64, 1024, 'temporary filesystem size');
  return ['--pull=never', '--network', network, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--read-only', '--pids-limit', String(pids), '--memory', `${memory}m`, '--cpus', String(cpus),
    '--user', `${UID}:${GID}`, '--tmpfs', `/tmp:rw,exec,nosuid,nodev,size=${tmpMiB}m,uid=${UID},gid=${GID}`,
    '--ulimit', `fsize=${fileBytes}:${fileBytes}`];
}

export class Runtime {
  constructor({ policy, work, secrets = {}, capabilities = [] }) {
    assert(process.platform === 'linux', 'The runtime requires Linux; use the Windows WSL launcher.');
    this.policy = policy;
    this.work = privateDirectory(work);
    this.secrets = secrets;
    this.capabilities = capabilities;
    this.deadline = Date.now() + policy.limits.timeoutSeconds * 1000;
    this.root = privateDirectory(fs.mkdtempSync(path.join(os.tmpdir(), 'lights-on-local-')));
    this.code = path.join(this.root, 'code');
    privateDirectory(this.code);
    for (const relative of ['local', '.github/lights-on/runner', '.github/lights-on/prompts']) {
      copyWorkspace(path.join(CODE, relative), path.join(this.code, relative));
    }
    this.codeDigest = digestObject([...inventory(this.code)]);
    this.names = new Set();
    this.gateways = new Map();
    this.candidates = new Map();
    this.verifiedImages = new Set();
    privateDirectory(path.join(this.work, 'sandboxes'));
  }

  preflight() {
    docker(['info', '--format', '{{.OSType}}']);
    for (const ref of Object.values(this.policy.images)) this.requireImage(ref);
  }

  requireImage(ref) {
    assert(!this.cancelled && Date.now() < this.deadline, 'Run cancelled or time budget exhausted.');
    image(ref);
    if (this.verifiedImages.has(ref)) return;
    const result = docker(['image', 'inspect', ref, '--format', '{{.Id}} {{.Os}}']);
    assert(/^sha256:[a-f0-9]{64} linux\s*$/.test(result.stdout), 'Image must be preloaded and Linux.');
    this.verifiedImages.add(ref);
  }

  name() {
    assert(!this.cancelled && Date.now() < this.deadline, 'Run cancelled or time budget exhausted.');
    const value = `lights-on-local-${crypto.randomUUID()}`;
    this.names.add(value);
    return value;
  }

  remove(name) {
    const result = docker(['rm', '--force', name], { allowFailure: true });
    assert(result.status === 0 || /No such container/.test(result.stderr), 'Container cleanup failed.');
    this.names.delete(name);
  }

  async gateway(role) {
    if (this.gateways.has(role)) return this.gateways.get(role);
    const directory = privateDirectory(path.join(this.root, role));
    const socket = privateDirectory(path.join(directory, 'socket'));
    const audit = privateDirectory(path.join(this.root, 'audit', role));
    const config = privateDirectory(path.join(directory, 'config'));
    const budget = privateDirectory(path.join(this.root, 'network-budget'));
    const policy = { ...this.policy, role, capabilities: this.capabilities };
    writePrivate(path.join(config, 'policy.json'), JSON.stringify(policy));
    if (policy.upstreamCaFile) writePrivate(path.join(config, 'upstream-ca.pem'), fs.readFileSync(policy.upstreamCaFile));
    const needed = new Set(policy.rules.filter((r) => r.roles.includes(role)).map((r) => r.credential).filter(Boolean));
    writePrivate(path.join(config, 'secrets.json'), JSON.stringify(Object.fromEntries(
      Object.entries(this.secrets).filter(([key]) => needed.has(key)))));
    const name = this.name();
    docker(['run', '-d', '--name', name, ...restrictions({ network: 'bridge', memory: 512 }),
      ...mount(this.code, '/code', true), ...mount(config, '/config', true),
      ...mount(socket, '/socket'), ...mount(audit, '/audit'), ...mount(budget, '/budget'),
      '--entrypoint', 'python', this.policy.images.proxy, '/code/local/network/gateway.py']);
    for (let attempt = 0; attempt < 300; attempt++) {
      if (fs.existsSync(path.join(socket, 'proxy.sock')) && fs.existsSync(path.join(socket, 'ca.pem'))) {
        const value = { socket, name };
        this.gateways.set(role, value);
        return value;
      }
      const running = docker(['inspect', '--format', '{{.State.Running}}', name]).stdout.trim();
      if (running !== 'true') {
        const logs = docker(['logs', '--tail', '20', name], { allowFailure: true });
        throw new Error(`Protected gateway did not start: ${(logs.stderr || logs.stdout).slice(0, 2000)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('Protected gateway readiness timed out.');
  }

  async role(role, script, args = [], { control = false, extraMounts = [], timeout } = {}) {
    const gateway = await this.gateway(role);
    const name = this.name();
    try {
      const result = await this.runAsync(['run', '--name', name, ...restrictions({ fileBytes: 536870912, tmpMiB: 1024 }),
        ...mount(this.code, '/code', true), ...mount(this.work, '/work'),
        ...mount(gateway.socket, '/egress', true),
        ...(control ? mount(this.controlDirectory, '/control', true) : []),
        ...extraMounts.flatMap((m) => mount(...m)),
        '--env', 'HOME=/tmp', '--workdir', '/work',
        '--entrypoint', 'node', this.policy.images.controller,
        '/code/local/entry.mjs', script, ...args], Math.max(1, Math.min(timeout || Infinity, this.deadline - Date.now())));
      if (result.code !== 0) throw new Error(`Protected ${role} failed (${result.code}). ${result.stderr.slice(-2000)}`);
      return result;
    } finally { this.remove(name); }
  }

  async runAsync(args, timeout) {
    const { spawn } = await import('node:child_process');
    return new Promise((resolve, reject) => {
      const child = spawn('docker', args, { env: { PATH: process.env.PATH, HOME: process.env.HOME }, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      child.stdout.on('data', (data) => { stdout = (stdout + data).slice(-100000); });
      child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-100000); });
      const timer = setTimeout(() => child.kill(), timeout);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.once('exit', (code) => { clearTimeout(timer); resolve({ code: code ?? 124, stdout, stderr }); });
    });
  }

  async listen() {
    this.controlDirectory = privateDirectory(path.join(this.root, 'control'));
    this.server = http.createServer((request, response) => {
      const fail = (message) => { response.writeHead(400); response.end(JSON.stringify({ error: message })); };
      if (request.method !== 'POST' || request.url !== '/worker') return fail('Unknown worker operation.');
      let data = '';
      request.on('data', (chunk) => { data += chunk; if (data.length > 20000) request.destroy(); });
      request.on('end', () => {
        try {
          const result = this.worker(JSON.parse(data));
          response.end(JSON.stringify(result));
        } catch (err) { fail(err.message); }
      });
    });
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(path.join(this.controlDirectory, 'worker.sock'), resolve);
    });
    fs.chmodSync(path.join(this.controlDirectory, 'worker.sock'), 0o600);
    if (process.getuid() === 0) fs.chownSync(path.join(this.controlDirectory, 'worker.sock'), UID, GID);
  }

  worker(request) {
    exactKeys(request, ['operation', 'source', 'id', 'command'], 'worker request');
    if (request.operation === 'create') {
      const source = request.source === 'candidate' ? path.join(this.work, 'candidate') : this.candidates.get(request.source);
      assert(source, 'Unknown candidate ID.');
      const id = crypto.randomUUID();
      const directory = path.join(this.work, 'sandboxes', id);
      copyWorkspace(source, directory);
      this.candidates.set(id, directory);
      return { id, workspace: `/work/sandboxes/${id}` };
    }
    const workspace = this.candidates.get(request.id);
    assert(workspace, 'Unknown or expired worker ID.');
    if (request.operation === 'dispose') {
      fs.rmSync(workspace, { recursive: true });
      this.candidates.delete(request.id);
      return { disposed: true };
    }
    assert(request.operation === 'run' && typeof request.command === 'string' && request.command.length <= 16000,
      'Invalid bounded worker command.');
    return this.command({ workspace, command: request.command, image: this.policy.images.worker });
  }

  command({ workspace, command, image: ref, timeoutSeconds = 60, resources = {} }) {
    this.requireImage(ref);
    const name = this.name();
    try {
      const result = docker(['run', '--name', name, ...restrictions(resources),
        ...mount(workspace, '/workspace'), '--workdir', '/workspace',
        '--env', 'HOME=/tmp', '--env', 'CI=true', '--entrypoint', '/bin/sh', ref, '-c', command],
      { timeout: Math.max(1, Math.min(timeoutSeconds * 1000, this.deadline - Date.now())), allowFailure: true });
      return { exit_code: result.error?.code === 'ETIMEDOUT' ? 124 : result.status ?? 1,
        stdout: (result.stdout || '').slice(0, 50000), stderr: (result.stderr || '').slice(0, 50000) };
    } finally { this.remove(name); }
  }

  cancel() {
    this.cancelled = true;
    for (const name of [...this.names]) this.remove(name);
  }

  dispose() {
    if (this.disposed) return;
    const errors = [];
    this.server?.close();
    for (const name of [...this.names]) {
      try { this.remove(name); } catch (err) { errors.push(err.message); }
    }
    if (errors.length) throw new Error(errors.join('; '));
    if (fs.existsSync(path.join(this.root, 'audit'))) {
      fs.cpSync(path.join(this.root, 'audit'), path.join(this.work, 'audit'), { recursive: true, force: true });
    }
    fs.rmSync(this.root, { recursive: true });
    this.disposed = true;
  }
}
