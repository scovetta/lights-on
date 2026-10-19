import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export async function cachedFetch(url, options = {}) {
  const directory = '/state/http';
  if ((options.method || 'GET') !== 'GET' || !fs.existsSync('/state') || options.cache === 'no-store') {
    return fetch(url, { ...options, redirect: 'error' });
  }
  const key = crypto.createHash('sha256').update(String(url)).digest('hex');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, `${key}.json`);
  let cached;
  if (fs.existsSync(file)) {
    cached = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!cached || typeof cached.body !== 'string' || typeof cached.time !== 'number') throw new Error('Corrupt scoped HTTP cache.');
  }
  // Only short-lived public/context GETs are cached; advisories and inference POSTs are always fresh.
  if (cached && Date.now() - cached.time >= 0 && Date.now() - cached.time < 60000) {
    return new Response(cached.body, { headers: { 'Content-Type': 'application/json', 'X-Lights-On-Cache': 'fresh-60s' } });
  }
  const response = await fetch(url, { ...options, redirect: 'error',
    headers: { ...options.headers, ...(cached?.etag ? { 'If-None-Match': cached.etag } : {}) } });
  if (response.status === 304 && cached) {
    cached.time = Date.now();
    fs.writeFileSync(file, JSON.stringify(cached), { mode: 0o600 });
    return new Response(cached.body, { headers: { 'Content-Type': 'application/json', 'X-Lights-On-Cache': 'revalidated' } });
  }
  if (response.ok && response.headers.get('content-type')?.includes('json')) {
    const body = await response.text();
    if (Buffer.byteLength(body) <= 1048576) {
      fs.writeFileSync(file, JSON.stringify({ body, time: Date.now(), etag: response.headers.get('etag') }),
        { mode: 0o600 });
    }
    return new Response(body, { status: response.status, headers: response.headers });
  }
  return response;
}
