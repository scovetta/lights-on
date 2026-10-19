import http from 'node:http';
const request = http.request({ socketPath: '/control/worker.sock', path: '/worker',
  method: 'POST', timeout: 125000 }, (response) => {
  let body = '';
  response.on('data', (data) => { body += data; if (body.length > 200000) response.destroy(); });
  response.on('end', () => {
    process.stdout.write(body);
    if (response.statusCode !== 200) process.exitCode = 1;
  });
  response.on('error', () => { process.exitCode = 1; });
});
request.on('timeout', () => request.destroy(new Error('Worker request timed out.')));
request.on('error', (err) => { console.error(err.message); process.exitCode = 1; });
request.end(process.argv[2]);
