"""mitmproxy policy addon. Client namespaces have no independent network route."""
import ipaddress
import fcntl
import base64
import json
import os
import re
import socket
import time
from urllib.parse import unquote, urlsplit

from mitmproxy import http


class Gateway:
    def __init__(self):
        with open("/config/policy.json", encoding="utf-8") as stream:
            self.policy = json.load(stream)
        with open("/config/secrets.json", encoding="utf-8") as stream:
            self.secrets = json.load(stream)
        self.role = self.policy["role"]
        self.rules = [r for r in self.policy["rules"] if self.role in r["roles"]]
        self.requests = 0
        self.bytes = 0
        self.failed = False
        self.audit_events = 0
        self.log = open("/audit/network.jsonl", "a", encoding="utf-8", buffering=1)

    def reserve(self, flow, requests=0, size=0):
        try:
            with open("/budget/counters.json", "a+", encoding="utf-8") as stream:
                fcntl.flock(stream, fcntl.LOCK_EX)
                stream.seek(0)
                content = stream.read()
                state = json.loads(content) if content else {"requests": 0, "bytes": 0}
                state["requests"] += requests
                state["bytes"] += size
                if state["requests"] > self.policy["limits"]["requests"] or state["bytes"] > self.policy["limits"]["totalBytes"]:
                    return False
                stream.seek(0)
                stream.truncate()
                stream.write(json.dumps(state))
                stream.flush()
                os.fsync(stream.fileno())
            return True
        except (OSError, ValueError, KeyError, TypeError):
            self.failed = True
            flow.kill()
            return False

    def audit(self, flow, outcome, reason, count=0):
        self.audit_events += 1
        if self.failed or self.audit_events > self.policy["limits"]["requests"] * 4:
            self.failed = True
            flow.kill()
            return
        event = dict(time=time.time(), role=self.role, outcome=outcome, rule=reason,
                     method=flow.request.method, host=flow.request.host, bytes=count,
                     status=flow.response.status_code if flow.response else None,
                     duration_ms=round((time.time() - flow.metadata.get("started", time.time())) * 1000))
        # Do not log paths/queries: both can contain signed URLs or confidential identifiers.
        try:
            self.log.write(json.dumps(event, ensure_ascii=True) + "\n")
            self.log.flush()
            os.fsync(self.log.fileno())
        except (OSError, ValueError):
            self.failed = True
            flow.kill()

    def deny(self, flow, reason):
        flow.response = http.Response.make(403, b"Lights On egress denied", {"Content-Type": "text/plain"})
        self.audit(flow, "denied", reason)

    def http_connect(self, flow):
        if self.failed or flow.request.port != 443 or flow.request.host not in {r["host"] for r in self.rules}:
            self.deny(flow, "connect-destination")

    def server_connect(self, data):
        host, port = data.server.address
        if host not in {r["host"] for r in self.rules} or port != 443:
            data.server.error = "Lights On destination denied"
            return
        try:
            addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError("non-public destination")
            # Pin the vetted IP for this connection while retaining upstream TLS SNI verification.
            data.server.sni = host
            data.server.address = (addresses[0][4][0], port)
        except (OSError, ValueError):
            data.server.error = "Lights On DNS destination denied"

    def github_capability(self, request, path):
        host, method = request.host, request.method
        repo = self.policy["repository"]
        if host not in ("api.github.com", "github.com", "uploads.github.com"):
            return None
        if self.role == "analysis" and method == "GET" and host == "api.github.com" and path in (
                "/copilot_internal/v2/token", "/user", "/user/copilot"):
            return "read"
        if host == "github.com":
            allowed = [repo] + self.policy.get("upstreams", [])
            for name in allowed:
                if path == f"/{name}.git/info/refs" and method == "GET":
                    return "read" if urlsplit(request.url).query == "service=git-upload-pack" else "deny"
                if path == f"/{name}.git/git-upload-pack" and method == "POST":
                    return "read"
            return "deny"
        prefix = f"/repos/{repo}"
        permitted = [prefix] + [f"/repos/{r}" for r in self.policy.get("upstreams", [])]
        if method in ("GET", "HEAD") and any(path == p or path.startswith(p + "/") for p in permitted):
            return "read"
        if not path.startswith(prefix + "/") or self.role != "publisher":
            return "deny"
        suffix = path[len(prefix):]
        if re.fullmatch(r"/pulls/[1-9]\d*/merge", suffix) and method == "PUT":
            return "merge"
        if re.fullmatch(r"/releases(?:/[1-9]\d*(?:/assets)?)?", suffix) and method in ("POST", "PATCH"):
            return "release"
        if method == "POST" and (suffix in ("/pulls", "/issues", "/labels", "/git/blobs", "/git/trees", "/git/commits")
                                or re.fullmatch(r"/(?:issues/[1-9]\d*/comments|pulls/[1-9]\d*/reviews)", suffix)):
            return "publish"
        if suffix == "/git/refs" and method == "POST":
            try:
                ref = json.loads(request.content)["ref"]
                if re.fullmatch(r"refs/heads/lights-on/local-[a-f0-9-]{36}", ref):
                    return "publish"
                if re.fullmatch(r"refs/tags/v\d+\.\d+\.\d+", ref):
                    return "release"
            except (ValueError, KeyError, TypeError):
                pass
        return "deny"

    def requestheaders(self, flow):
        flow.metadata["started"] = time.time()
        limit = self.policy["limits"]["requestBytes"]
        length = flow.request.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > limit or "transfer-encoding" in flow.request.headers:
            self.deny(flow, "request-size")

    def request(self, flow):
        if flow.response:
            return
        request = flow.request
        self.requests += 1
        limits = self.policy["limits"]
        raw_path = urlsplit(request.url).path
        path = unquote(raw_path)
        if (self.failed or self.requests > limits["requests"] or self.bytes >= limits["totalBytes"]
                or len(request.content or b"") > limits["requestBytes"]):
            return self.deny(flow, "budget-or-audit")
        if (request.scheme != "https" or request.port != 443 or request.headers.get("upgrade")
                or request.headers.get("host", "").lower() not in (request.host, request.host + ":443")
                or re.search(r"[%\\\x00-\x20]", path)
                or any(p in (".", "..") for p in path.split("/"))
                or urlsplit(request.url).username):
            return self.deny(flow, "unsafe-url-or-tunnel")
        rule = next((r for r in self.rules if r["host"] == request.host and request.method in r["methods"]
                     and (path == r["path"] or r["path"].endswith("/") and path.startswith(r["path"]))), None)
        if not rule:
            return self.deny(flow, "no-rule")
        capability = self.github_capability(request, path)
        if capability == "deny" or capability not in (None, "read") and capability not in self.policy["capabilities"]:
            return self.deny(flow, "repository-capability")
        if self.role in ("fetch", "prepare") and capability is None and request.method not in ("GET", "HEAD"):
            return self.deny(flow, "read-only-preparation")
        if capability is None and request.method not in ("GET", "HEAD"):
            inference = self.role == "analysis" and request.host in (
                "api.openai.com", "api.anthropic.com", "openrouter.ai", "api.githubcopilot.com",
                "api.individual.githubcopilot.com", "api.business.githubcopilot.com",
                "api.enterprise.githubcopilot.com", "api.osv.dev")
            upload = self.role == "publisher" and "registry-publish" in self.policy["capabilities"]
            if not inference and not upload:
                return self.deny(flow, "service-mutation-capability")
        if not self.reserve(flow, requests=1, size=len(request.content or b"")):
            return self.deny(flow, "shared-run-budget")
        # Forward only policy-approved Copilot session authorization; replace other credentials.
        forwarded = request.headers.get("authorization") if rule.get("forwardAuthorization") else None
        for header in ("authorization", "proxy-authorization", "cookie", "x-api-key", "x-nuget-apikey"):
            request.headers.pop(header, None)
        if forwarded:
            request.headers["authorization"] = forwarded
        if rule.get("credential"):
            value = self.secrets[rule["credential"]]
            if rule.get("basicUser"):
                value = "Basic " + base64.b64encode((rule["basicUser"] + ":" + value).encode()).decode()
            else:
                value = rule.get("prefix", "") + value
            request.headers[rule["header"]] = value
        request.headers.pop("accept-encoding", None)
        if self.role == "prepare":
            # Avoid stalled registry keep-alive sessions during long metadata walks.
            request.headers["connection"] = "close"
        flow.metadata["rule"] = rule["id"]
        self.bytes += len(request.content or b"")
        self.audit(flow, "allowed", rule["id"], len(request.content or b""))

    def responseheaders(self, flow):
        limit = self.policy["limits"]["responseBytes"]
        length = flow.response.headers.get("content-length", "0")
        if not length.isdigit() or int(length) > limit:
            return self.deny(flow, "response-size")
        # Enforce chunked-response limits before buffering into client memory.
        count = 0

        def bounded(chunk):
            nonlocal count
            count += len(chunk)
            self.bytes += len(chunk)
            flow.metadata["received"] = count
            if count > limit or not self.reserve(flow, size=len(chunk)):
                self.audit(flow, "denied", "response-budget", count)
                raise ValueError("Lights On response budget exceeded")
            return chunk

        flow.response.stream = bounded

    def response(self, flow):
        if "rule" in flow.metadata:
            self.audit(flow, "response", flow.metadata["rule"], flow.metadata.get("received", 0))


addons = [Gateway()]
