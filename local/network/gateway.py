"""Expose mitmproxy through a private Unix socket, without implementing HTTP/TLS."""
import os
import select
import shutil
import socket
import subprocess
import threading
import time


def bridge(client):
    upstream = socket.create_connection(("127.0.0.1", 8080), timeout=15)
    client.settimeout(120)
    upstream.settimeout(120)
    try:
        while True:
            ready, _, _ = select.select([client, upstream], [], [], 120)
            if not ready:
                return
            for source in ready:
                data = source.recv(65536)
                if not data:
                    return
                (upstream if source is client else client).sendall(data)
    finally:
        client.close()
        upstream.close()


arguments = [
    "mitmdump", "-q", "-s", "/code/local/network/policy.py",
    "--listen-host", "127.0.0.1", "--listen-port", "8080",
    "--set", "confdir=/tmp/mitm", "--set", "connection_strategy=lazy",
    "--set", "http2=false", "--set", "websocket=false",
    "--set", "body_size_limit=100m",
]
if os.path.exists("/config/upstream-ca.pem"):
    arguments += ["--set", "ssl_verify_upstream_trusted_ca=/config/upstream-ca.pem"]
process = subprocess.Popen(arguments)
for _ in range(300):
    if process.poll() is not None:
        raise RuntimeError("Gateway failed to start")
    if os.path.exists("/tmp/mitm/mitmproxy-ca-cert.pem"):
        try:
            with socket.create_connection(("127.0.0.1", 8080), timeout=0.2):
                break
        except OSError:
            pass
    time.sleep(0.1)
else:
    raise RuntimeError("Gateway readiness timed out")
shutil.copyfile("/tmp/mitm/mitmproxy-ca-cert.pem", "/socket/ca.pem")
server = socket.socket(socket.AF_UNIX)
server.bind("/socket/proxy.sock")
os.chmod("/socket/proxy.sock", 0o600)
server.listen(16)
server.settimeout(1)
while process.poll() is None:
    try:
        client, _ = server.accept()
    except socket.timeout:
        continue
    threading.Thread(target=bridge, args=(client,), daemon=True).start()
raise RuntimeError("Gateway exited")
