import net from 'node:net';

export async function forward(socketPath = '/egress/proxy.sock') {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.createConnection(socketPath);
    sockets.add(client);
    sockets.add(upstream);
    const close = () => { client.destroy(); upstream.destroy(); sockets.delete(client); sockets.delete(upstream); };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
    client.pipe(upstream).pipe(client);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close() { for (const socket of sockets) socket.destroy(); server.close(); }
  };
}
