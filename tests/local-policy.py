import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import unittest
from unittest.mock import patch


class Headers(dict):
    def __init__(self, values=None):
        super().__init__((k.lower(), v) for k, v in (values or {}).items())

    def __setitem__(self, key, value):
        super().__setitem__(key.lower(), value)

    def get(self, key, default=None):
        return super().get(key.lower(), default)

    def pop(self, key, default=None):
        return super().pop(key.lower(), default)


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.policy = {
            "repository": "owner/repo", "upstreams": ["upstream/repo"], "role": "analysis",
            "capabilities": [], "limits": {"requests": 100, "requestBytes": 4096,
                                         "responseBytes": 8192, "totalBytes": 16384},
            "rules": [
                {"id": "repo", "host": "api.github.com", "path": "/repos/",
                 "methods": ["GET", "POST", "PUT", "PATCH", "DELETE"], "roles": ["analysis", "publisher", "fetch"]},
                {"id": "git", "host": "github.com", "path": "/", "methods": ["GET", "POST"],
                 "roles": ["analysis", "publisher", "fetch"]},
                {"id": "provider", "host": "api.openai.com", "path": "/v1/responses",
                 "methods": ["POST"], "roles": ["analysis"], "credential": "KEY",
                 "header": "Authorization", "prefix": "Bearer "}
            ]
        }
        original_open = open

        def controlled_open(file, *args, **kwargs):
            if file == "/config/policy.json":
                return io.StringIO(json.dumps(self.policy))
            if file == "/config/secrets.json":
                return io.StringIO('{"KEY":"synthetic-secret-value"}')
            if str(file).startswith(("/audit/", "/budget/")):
                file = os.path.join(self.temp.name, str(file).split("/")[-1])
            return original_open(file, *args, **kwargs)

        fake_http = types.SimpleNamespace(Response=types.SimpleNamespace(make=lambda code, body, headers:
                                           types.SimpleNamespace(status_code=code, content=body, headers=Headers(headers))))
        modules = {"mitmproxy": types.SimpleNamespace(http=fake_http)}
        if os.name == "nt":
            modules["fcntl"] = types.SimpleNamespace(LOCK_EX=1, flock=lambda *args: None)
        self.modules = patch.dict(sys.modules, modules)
        self.modules.start()
        self.open = patch("builtins.open", controlled_open)
        self.open.start()
        spec = importlib.util.spec_from_file_location("gateway_policy", sys.argv[1])
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.gateway = self.module.addons[0]

    def tearDown(self):
        self.gateway.log.close()
        self.open.stop()
        self.modules.stop()
        self.temp.cleanup()

    def flow(self, host="api.github.com", path="/repos/owner/repo/issues", method="GET", body=b"", headers=None):
        request = types.SimpleNamespace(host=host, port=443, scheme="https", method=method,
                                        url=f"https://{host}{path}", content=body,
                                        headers=Headers({"host": host, **(headers or {})}))
        flow = types.SimpleNamespace(request=request, response=None, metadata={}, killed=False)
        flow.kill = lambda: setattr(flow, "killed", True)
        return flow

    def test_reads_do_not_authorize_writes_or_graphql(self):
        for flow in [self.flow(path="/graphql", method="POST"),
                     self.flow(method="POST"), self.flow(path="/repos/upstream/repo/issues", method="POST"),
                     self.flow(path="/repos/foreign/repo/issues")]:
            self.gateway.request(flow)
            self.assertEqual(flow.response.status_code, 403)
        good = self.flow(path="/repos/upstream/repo/issues")
        self.gateway.request(good)
        self.assertIsNone(good.response)

    def test_capabilities_are_independent_and_scoped(self):
        self.gateway.role = "publisher"
        self.policy["capabilities"] = ["publish"]
        self.gateway.policy["capabilities"] = ["publish"]
        for route, method in [("/repos/owner/repo/pulls/1/merge", "PUT"),
                              ("/repos/owner/repo/releases", "POST"),
                              ("/repos/upstream/repo/issues", "POST")]:
            flow = self.flow(path=route, method=method)
            self.gateway.request(flow)
            self.assertEqual(flow.response.status_code, 403)
        good = self.flow(method="POST")
        self.gateway.request(good)
        self.assertIsNone(good.response)
        bad_ref = self.flow(path="/repos/owner/repo/git/refs", method="POST", body=b'{"ref":"refs/heads/main"}')
        self.gateway.request(bad_ref)
        self.assertEqual(bad_ref.response.status_code, 403)

    def test_git_upload_pack_is_read_but_receive_pack_is_not(self):
        fetch = self.flow("github.com", "/owner/repo.git/git-upload-pack", "POST")
        self.gateway.request(fetch)
        self.assertIsNone(fetch.response)
        for path in ["/owner/repo.git/git-receive-pack", "/foreign/repo.git/git-upload-pack",
                     "/owner/repo.git/info/refs?service=git-receive-pack"]:
            flow = self.flow("github.com", path, "POST" if "info/refs" not in path else "GET")
            self.gateway.request(flow)
            self.assertEqual(flow.response.status_code, 403)

    def test_credential_injection_and_redacted_audit(self):
        flow = self.flow("api.openai.com", "/v1/responses", "POST", b'{"prompt":"never log this"}',
                         {"Authorization": "caller-secret", "Cookie": "private-cookie"})
        self.gateway.request(flow)
        self.assertEqual(flow.request.headers.get("Authorization"), "Bearer synthetic-secret-value")
        self.assertIsNone(flow.request.headers.get("Cookie"))
        with open(os.path.join(self.temp.name, "network.jsonl"), encoding="utf-8") as stream:
            log = stream.read()
        for secret in ["synthetic-secret-value", "caller-secret", "private-cookie", "never log this", "/v1/responses"]:
            self.assertNotIn(secret, log)

    def test_unsafe_urls_tunnels_private_dns_and_budget(self):
        for path in ["/repos/owner/repo/../other", "/repos/owner/repo/%252e%252e/other",
                     "/repos/owner/repo/%5cother"]:
            flow = self.flow(path=path)
            self.gateway.request(flow)
            self.assertEqual(flow.response.status_code, 403)
        upgrade = self.flow(headers={"Upgrade": "websocket"})
        self.gateway.request(upgrade)
        self.assertEqual(upgrade.response.status_code, 403)
        for ip in ["127.0.0.1", "169.254.169.254", "10.0.0.1", "::1", "::ffff:127.0.0.1"]:
            connection = types.SimpleNamespace(server=types.SimpleNamespace(address=("api.github.com", 443), error=None))
            with patch.object(self.module.socket, "getaddrinfo", return_value=[(2, 1, 6, "", (ip, 443))]):
                self.gateway.server_connect(connection)
            self.assertIsNotNone(connection.server.error)
        self.gateway.policy["limits"]["requests"] = 1
        self.gateway.request(self.flow())
        exhausted = self.flow()
        self.gateway.request(exhausted)
        self.assertEqual(exhausted.response.status_code, 403)

    def test_audit_failure_kills_flow(self):
        self.gateway.log.close()
        flow = self.flow()
        self.gateway.request(flow)
        self.assertTrue(flow.killed)
        self.assertTrue(self.gateway.failed)


if __name__ == "__main__":
    unittest.main(argv=[sys.argv[0]])
