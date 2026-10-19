# Protected local execution

[Documentation index](README.md)

The optional `local/` launcher runs Lights On against a remote GitHub.com
repository without installing or replacing its GitHub Actions workflows.
Repository commands run in disposable, offline Linux containers. Trusted Git,
metadata and inference requests use a separate, audited, default-deny gateway.
Remote publication requires a grant in both the operator policy and the command.

The launcher uses the existing task runners, validators and publication checks.
It does not execute Actions workflow YAML. Missing tools or unsupported tests
block the affected work.

## Quick start

You need Node.js 24 or later on the launcher host, a Linux Docker daemon, and a
trusted Lights On source checkout. On Windows, the launcher forwards execution
to WSL; set `LIGHTS_ON_WSL_DISTRO` to your Docker-enabled distribution
(the default is `AzureLinux3.0`). The supervisor manages mounts and Unix sockets
inside Linux without exposing a Docker socket to workloads.

1. Copy [`local/policies/read-only.json`](../local/policies/read-only.json) to an
   operator-controlled location outside the target checkout. Replace
   `owner/project` in the repository identity **and all rule paths**. This example
   uses Codex; select your provider and its inference rules.
2. Supply the selected credential through its named environment variable or an
   explicit secret file. Do not add secrets to JSON, images, command arguments or
   repository files.
3. Prepare the approved images/bundles, then run a task:

```powershell
node local\lights-on.mjs prepare `
  --policy C:\policies\lights-on.json --output C:\runs\lights-on

node local\lights-on.mjs run `
  --policy C:\policies\lights-on.json --output C:\runs\lights-on `
  --repo owner/project --ref main --task docs-clarifier
```

The command prints the managed run directory. It contains candidate files,
task results, validation evidence and the network report. **No PR, comment,
label, merge, release or registry upload occurs by default.**

Preparation loads credentials referenced by preparation rules. It does not
require inference or publication secrets just because the policy declares them.
Publication loads publisher-role credentials and the registry token when needed.

On native Linux, use ordinary Linux paths and the same arguments. In a policy
used through the Windows launcher, credential `file` paths and `upstreamCaFile`
are Linux/WSL paths. The launcher forwards named credential variables through
`WSLENV`. It does not mount the host home or copy the whole environment.

The supplied policy has no validation profiles. You can generate candidates,
but local CI reports **blocked: coverage unknown** until you configure tests.
The publisher requires passing validation before it publishes changed files.

## Arbitrary CI tools, offline

A validation profile can use an operator-approved,
digest-pinned Linux image containing Java, .NET, Rust, native compilers, browsers
or a custom tool. Run `prepare` to load the images; execution uses `--pull=never`.

Put profile objects in the policy's `profiles` array. Each object is a required
matrix case; give separate runtimes/platforms distinct IDs. The
[Node example](../local/profiles/node.json) and
[native compiler example](../local/profiles/native.json) need adaptation to your
project's tests. The launcher does not discover that configuration for you.

```json
{
  "id": "node24",
  "image": "node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0",
  "platform": "linux/amd64",
  "commands": [
    "npm ci --offline --ignore-scripts --no-audit --no-fund && npm test"
  ],
  "timeoutSeconds": 300,
  "resources": { "memory": 2048, "cpus": 2, "pids": 128 },
  "outputs": ["test-results.xml"]
}
```

Declare the outputs your commands generate. A missing output blocks that case.
The validator accepts bounded regular files and rejects symlinks, traversal or
changes to existing source files. Commands run in fresh copies; the supervisor
keeps their build products out of the proposed source tree.

A profile's `timeoutSeconds` includes service startup and readiness, not just
test commands. Missing outputs do not hide a command failure. Validation also
rejects changes to source executable bits before any candidate can be published.

You approve commands and image identities in the operator policy.
A model may propose a missing tool or profile change, but cannot approve it,
drop a required matrix entry or add privileges. Profiles never accept arbitrary
Docker flags, host mounts, devices, engine sockets or network settings.

Workers use non-root UIDs, dropped capabilities, a read-only root, process/CPU/
memory bounds and disposable temporary storage. Temporary storage permits
execution so compilers, virtual environments and browser binaries can work.
It does not provide network or host privileges.

### Databases and other test services

A profile may declare `services`. The supervisor creates a networkless worker,
then starts the services in that worker's network namespace. They communicate
through `127.0.0.1` on distinct ports. The supervisor publishes no host ports
and adds no external gateway.

```json
{
  "id": "http-integration",
  "image": "node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0",
  "commands": [
    "node -e 'fetch(\"http://127.0.0.1:8088\").then(r=>{if(!r.ok)process.exit(1)})'"
  ],
  "services": [
    {
      "id": "fixture",
      "image": "node@sha256:14078204b6bb268c107ceff6d3c43f45a888105e5c2b18b14c32b3409d93a1b0",
      "port": 8088,
      "command": ["node", "-e", "require(\"http\").createServer((q,s)=>s.end(\"ok\")).listen(8088,\"127.0.0.1\")"],
      "healthCommand": "node -e 'fetch(\"http://127.0.0.1:8088\").then(r=>{if(!r.ok)process.exit(1)})'"
    }
  ]
}
```

For a database, choose an image/command that works with the restricted non-root,
read-only-root contract. `dataPaths` supplies bounded temporary writable
directories. Service `environment` may contain **synthetic local test settings
only**. Do not put production passwords or external service credentials there.
Workers and services share only their loopback network, not each other's files.

The local runner blocks live cloud integration tests. Windows/macOS-only jobs,
privileged/kernel/device tests and tests requiring the Docker socket are outside
this backend. Run them in your existing GitHub CI if needed, and treat those
jobs as outside the local confinement/audit boundary. Use an offline mock only
if your approved validation contract accepts that coverage.

### Dependencies and custom images

Prepare a cache for the candidate lockfile; the default Node image lacks your
project's dependencies. The updater requires a frozen install, exact target
resolution, fresh advisories and the original build/lint/test commands.

Use an approved custom image with immutable caches, or declare inert bundles:

```json
{
  "name": "offline-inputs.tar",
  "url": "https://packages.example.org/project/offline-inputs.tar",
  "sha256": "REPLACE_WITH_THE_REVIEWED_64_HEX_DIGEST"
}
```

List bundle names in the profile's `bundles` array. `prepare` downloads them
through an approved GET rule and verifies the digest. Later runs
reuse the repository/policy-scoped cache. The profile sees them read-only under
`/bundles`; any unpacking, setup scripts and builds run **offline**.

Supply prebuilt bundles for ecosystems without an acquisition adapter. Resolve
network-dependent inputs during preparation. Test workers cannot download
packages, run `curl | sh` against the network or trigger a networked repository
Dockerfile build.

Use your configured npm registry/proxyfeed when producing images or bundles.
`npmRegistry` records that selected registry in preparation output; it does not
rewrite a bundle URL, configure the Docker daemon, or authorize another host.
Select the proxyfeed in the bundle and gateway rules. There is no
public npm fallback in the launcher.

Build the optional Copilot controller image from the trusted tooling manifest:

```powershell
$registry = npm config get registry
# Run with the Docker client for your Linux engine.
docker build --file local\containers\controller.Dockerfile `
  --build-arg "NPM_REGISTRY=$registry" `
  --tag lights-on-local-controller:reviewed local\containers
docker image inspect lights-on-local-controller:reviewed --format '{{.Id}}'
```

Set `images.controller` to the resulting `sha256:...` ID. The policy rejects
mutable tags. Docker image acquisition/build traffic falls outside the
in-container audit, so configure the daemon's proxy or load images offline.
Review image contents before pinning; a digest identifies bytes without
establishing their safety. Keep credentials out of build arguments and layers.

This image includes CLI 1.0.98 and SDK 1.0.22 with integrity-locked dependencies.
Set `engine.copilot_backend: sdk` in the target's trusted configuration to use
the SDK. Runtime downloads are not needed. Its child process receives only the
inference credential, private state paths and the selected proxy/CA settings.
The SDK forces HTTP rather than WebSocket responses through the same gateway;
it does not add routes or relax policy.

## Tasks and providers

Use `--task` with `validate`, `scan`, `dependencies`, `migration-plan`,
`migration`, `toolchains`, `upstream`, `release`, `issue-responder`,
`docs-clarifier`, `security-remediator`, `bootstrap-threat-model` or `pr-reviewer`.
The older `security-fixer` spelling is an alias for `security-remediator`.
Security remediation receives a dependency/advisory scan before inference.
Issue/review context uses `--item NUMBER`; PR review requires it. Migration
execution selects `--plan-id` from the committed approved
migrations. The current high-capability tier spelling remains `--tier reasoning`.

`upstream` produces read-only snapshots and a proposed local report. For the
full polling/mirroring behavior, use the Actions scheduler. The local launcher
runs one bounded invocation without a webhook listener or durable event queue.

| Provider | Required inference route | Credential handling |
|---|---|---|
| Codex | `api.openai.com/v1/responses` | Gateway injects `Authorization: Bearer ...` |
| Claude | `api.anthropic.com/v1/messages` | Gateway injects `x-api-key` |
| OpenRouter | `openrouter.ai/api/v1/chat/completions` | Gateway injects `Authorization: Bearer ...` |
| Copilot | Explicit GitHub discovery/token and selected Copilot inference endpoints | Pinned CLI or opt-in SDK in the controller image; scoped token mounted only into inference |

For Copilot, configure `credentials.COPILOT_GITHUB_TOKEN` and its token-discovery
rule. To forward ephemeral Copilot authorization, add a
`forwardAuthorization: true` rule for the analysis role and a recognized
Copilot inference hostname. The gateway strips other caller-supplied
authorization/cookies. Discovery endpoints vary by subscription; a missing
rule denies the request. The tests exercise all four adapters with controlled
TLS fixtures. Check live account access in your deployment.

For private Git fetch, a rule can inject Basic authentication using
`"header": "Authorization", "basicUser": "x-access-token"` and a named credential.
API rules use `prefix: "Bearer "` where the service expects it. Do not reuse publication credentials
for analysis. GitHub operations use typed REST and constrained smart HTTP rather
than granting arbitrary `gh` GraphQL access.

## Network policy and audit

Only gateway containers have an external route. Controllers use `--network none`
and a read-only mount of their role's Unix socket. A namespace-local forwarder
adapts proxy-aware clients to the socket. Workers receive no gateway or
supervisor socket. Removing proxy variables leaves them without an external
route.

Rules bind exact hosts, methods, role and paths. Paths are exact unless they end
in `/`, which permits that subtree. GitHub repository identity and independent
mutation capabilities are enforced in addition to rules; an upstream read rule
cannot authorize an upstream write. Git fetch POSTs are reads; receive-pack and
arbitrary GraphQL are not permitted.

The gateway uses pinned mitmproxy, a run-scoped client CA and verified upstream
TLS. It validates public DNS results, pins the destination IP, and rejects
direct IP URLs, private/metadata destinations, ambiguous paths, upgrades and
opaque tunnels. Redirects fail.

You can add an upstream trust root through `upstreamCaFile`; verification stays
enabled. Private corporate proxy routing is unsupported. Do not disable TLS or
widen private-address checks to work around that limit.

`limits` bounds requests, individual request/response sizes, total transferred
bytes and run duration. Separate gateways share a locked network counter.
The supervisor keeps gateway logs/counters outside controller mounts and copies
them out after containers stop. An audit failure kills the affected request
and prevents subsequent traffic. Use provider-side billing limits as well.

## Publication and real GitHub CI

`capabilities` in the operator policy is an upper bound; flags grant a subset for
this invocation:

| Flag | Authorizes |
|---|---|
| `--publish` | Installed-repository proposals, comments and reports |
| `--allow-merge` | Merging after independent PR review and all existing gates |
| `--allow-release` | A GitHub release for a selected, committed version |
| `--allow-registry-publish` | Identity-checked package uploads |

Choose each capability you need. Add scoped `publisher` rules and credentials
before enabling a capability. For example, proposal publication needs local
repository Git blob/tree/commit/ref and PR endpoints; the gateway refuses writes
to the default branch or foreign repositories. Source proposals use new
`lights-on/local-UUID` branches without force-pushing.

```powershell
node local\lights-on.mjs publish `
  --policy C:\policies\lights-on.json `
  --run C:\runs\lights-on\RUN_UUID --publish
```

Declare the capability in policy before the run, then pass its flag when you
want to publish. Rerun after changing the policy, controller code, source ref
or candidate; the publisher rejects mismatched records.

Publication starts a fresh role, verifies immutable identities and sanitizes
all public text through the existing literal-body boundary. Toolchain/release
proposals requiring maintainer review are drafts. The publisher records partial
confirmed side effects in `publication.json` and refuses to retry a run that
has that file.

Local tests never impersonate configured GitHub check names/App IDs. A merge
requires a separate `pr-reviewer` run, current PR head, complete file inventory,
fresh remote checks and the existing repository policies. Posting the review
uses a commit-bound comment, not an unbound approval.

The launcher does not dispatch remote workflows. A published proposal may
trigger CI under GitHub's event/token rules; verify that the job ran. A remote
job's existence cannot satisfy a blocked local test. Mandatory local checks
must pass before the publisher sends validated code.

For an existing committed release, use `--task release --version X.Y.Z` and,
for packages, `--ecosystem npm|pypi|nuget|crates|rubygems`. Required validation
profiles perform offline builds and declare their package outputs. The controller
collects a hashed artifact manifest; the publisher verifies internal package
names/versions against trusted source before uploading. Publication requires
fresh trusted source CI as well as local validation.

Custom upload images need the ecosystem's uploader and Python 3.11+ for
identity inspection. RubyGems needs Ruby/Psych; PyPI needs `twine` and a token.
The local uploader does not simulate GitHub OIDC.
Scope `REGISTRY_TOKEN` to the chosen registry/package
set and configure the matching gateway rule (PyPI Basic username `__token__`).
No source build commands execute in the credentialed publisher.

## Results, state and recovery

Each run has `run.json`, `summary.md`, `network.jsonl`, source/candidate manifests,
`result.json`, and `validation.json` where applicable. Publication and preparation
add their own records. Local CI records per-case passed, failed, blocked,
timed-out or unrun outcomes; an empty matrix is not success.

The gateway omits paths/queries, prompt bodies, repository bodies, cookies and
authorization from default logs to avoid leaking signed URLs or private
identifiers. It records role, rule, host, method, status, bytes and duration.
These logs do not capture all syscalls, blocked raw sockets or host Docker
downloads.

The supervisor stores state by repository and policy under the output parent.
Local inference uses locked reservations and retains unknown/interrupted costs
as allocations. Local and Actions budgets are separate. JSON GET context uses
a 60-second cache or conditional revalidation. Advisory/inference POSTs and
publication freshness checks bypass that cache.

```powershell
node local\lights-on.mjs status --run C:\runs\lights-on\RUN_UUID
node local\lights-on.mjs cleanup --run C:\runs\lights-on\RUN_UUID
```

Cleanup removes only the selected completed/failed managed run, not shared budget
state. An active lock blocks concurrent runs with the same repository/policy.
A host crash may leave locks or containers; inspect that run before recovery.
SIGINT/SIGTERM and timeouts request container cleanup. The launcher does not
kill unrelated processes by name.

You must trust the engine, host kernel, operator policy and controller checkout.
Rootless engines still need to support the socket/UID contract. Container
isolation cannot defend against a malicious host administrator or a kernel/
daemon escape. Review images for secrets, and account for prompt injection or
malicious packages that tests may miss.

Provision bounded host/VM storage for hostile workloads. A bind mount does not
impose a filesystem quota.
