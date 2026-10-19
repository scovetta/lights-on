# Local development

[Documentation index](README.md)

Use a disposable checkout for live experiments. Local controllers can fetch
metadata and modify candidate files; publishing helpers can write to GitHub.

Use [protected local execution](local-container.md) to restrict outgoing network
access. Its dependencies and tool images are separate from the core controllers.
The opt-in Copilot SDK backend has its own isolated dependency installation.

The `lights-on-*.yml` workflows are installation templates. Every job excludes
`scovetta/lights-on`, including manual dispatches, so the source repository does
not maintain or publish itself. Self-test CI and website deployment remain
available. The configuration template stays enabled for adopting repositories.

## Prerequisites

| Work | Requirements |
|---|---|
| Core controllers and dry runs | Node.js 24 |
| GitHub Actions | GitHub.com runner 2.336.0+ for commit-bound `$/` action references |
| Full tests and distribution identity validation | Python 3.11+ and Ruby with standard-library Psych, in addition to Node.js |
| Installer checks | PowerShell on Windows; POSIX shell on Linux/macOS; Git when downloading sources |
| Metadata and GitHub operations | Network access and `gh` authentication where required |
| Actual agent commands | Linux Docker daemon and the trusted worker image |
| Copilot inference | Pinned CLI 1.0.98 or prepared SDK 1.0.22; a provider credential for live use |
| Other providers | The corresponding API secret; proprietary coding CLIs are not used |

The core controllers use Node built-ins. You do not need to run `npm install`
in the Lights On source directory before running its tests.

## Run the tests

From the Lights On source root:

```powershell
node --test
```

The tests mock external provider/GitHub requests and skip some platform-specific
or opt-in cases. Check live credentials, registry setup and target CI in your
deployment; the mock suite cannot establish those.

Runner fixtures should pass an explicit environment and a temporary state file.
Otherwise the CI event name, configuration overrides or a local budget ledger
can change the result. Do not bypass production event checks to make tests pass.

Protected-mode container tests use controlled TLS/Git/provider fixtures, with no
real remote mutations:

```sh
LIGHTS_ON_TEST_LOCAL_DOCKER=true node --test tests/local-*.test.mjs
```

To include the actual Copilot binary in that protected-route test, build the
documented controller tooling image through your configured npm proxy and set
`LIGHTS_ON_TEST_CONTROLLER_IMAGE` to its immutable image ID. No live provider
credential is needed. Tests without that variable exercise the base Node/Git
topology and offline validation, not the real Copilot client.

Package-identity tests create real local archive fixtures and reject substituted
names/versions before mocked upload. They use Python's standard library and,
for RubyGems metadata, Ruby's standard-library Psych syntax-tree parser.
The identity inspector does not instantiate YAML objects or execute package code.
Installers include `package-identity.py` alongside the Node controller modules.

To exercise the real Docker boundary on Linux:

```sh
LIGHTS_ON_TEST_DOCKER=true node --test
```

Prepare the CLI outside the checkout using the committed dependency lock:

```powershell
$env:LIGHTS_ON_COPILOT_CLI_DIR = Join-Path $env:TEMP "lights-on-cli-tools"
node .github\lights-on\runner\install-copilot-tools.mjs --backend cli --directory "$env:LIGHTS_ON_COPILOT_CLI_DIR"
```

Then exercise it against a loopback mock provider:

```powershell
$env:LIGHTS_ON_TEST_COPILOT = "true"
node --test --test-name-pattern="actual inference-only Copilot" tests\security-boundaries.test.mjs
Remove-Item Env:\LIGHTS_ON_TEST_COPILOT
```

The Copilot smoke test uses no real GitHub/provider credential. It checks the
actual CLI tool filtering, usage-file reporting, and recovery from an XML-style
response. The preparer uses `npm ci --ignore-scripts` through the configured npm
registry/proxy. Both the CLI and its transitive dependencies have locked
versions and integrity hashes; a top-level version pin alone is insufficient.

Do not bypass an organization's npm proxy or copy its authentication into source.

### Copilot SDK preparation

Prepare a trusted directory outside the maintained checkout:

```powershell
$env:LIGHTS_ON_COPILOT_SDK_DIR = Join-Path $env:TEMP "lights-on-sdk-tools"
node .github\lights-on\runner\install-copilot-sdk.mjs --directory "$env:LIGHTS_ON_COPILOT_SDK_DIR"
$env:LIGHTS_ON_COPILOT_BACKEND = "sdk"
```

The helper runs `npm ci --ignore-scripts` with the configured npm registry.
Locks pin versions and integrity hashes without registry-specific tarball URLs,
so they can be used through another configured proxyfeed. To regenerate locks,
use npm's `--package-lock-only --omit-lockfile-registry-resolved=true
--ignore-scripts` options in the tooling directory; do not replace the registry
with a public endpoint.

The real SDK smoke test uses a local mock provider and no live credential:

```powershell
$env:LIGHTS_ON_TEST_COPILOT_SDK = "true"
node --test tests\copilot-sdk.test.mjs
Remove-Item Env:\LIGHTS_ON_TEST_COPILOT_SDK
```

It exercises the bundled runtime, structured output, process reuse, empty tool
catalog and usage reporting. Unit cases also cover cancellation, limits,
credential isolation and candidate rejection on cleanup failures.

### Workflow audits

Run `zizmor -p --offline --strict-collection .` to audit local workflows,
including job-permission hygiene, without network access. `--no-ignores`
exposes the four documented exceptions: three
guarded triggers and the optional PyPI token fallback. Their rationale is in
[workflow audit decisions](architecture.md#workflow-audit-decisions).

Actionlint 1.7.12 predates GitHub's `$/` syntax and reports those references as
invalid. Do not replace them with mutable workspace references to satisfy that
older parser. Zizmor 1.31.1 understands the new syntax.

## Inspect effective configuration

Run this from the **target** checkout:

```powershell
node .github\lights-on\runner\load-config.mjs --json
```

Inspect the parsed values,
especially `autonomy.required_checks` and `dependencies.approved_migrations`.
The [configuration reference](configuration.md#use-the-supported-yaml-subset)
explains the parser's list-of-object syntax.

## Dry-run an agent invocation

Choose an output path outside the target source tree:

```powershell
$out = Join-Path $env:TEMP "lights-on-dry-run.json"
node .github\lights-on\runner\run-agent.mjs `
  --task docs-clarifier `
  --provider copilot `
  --tier default `
  --dry-run `
  --output $out
Get-Content -LiteralPath $out
```

A dry run writes a synthetic result without inference or command execution.
It can contain an approving review verdict. Do not use that output as merge
evidence or as a claim that tests passed.

Use `--tier reasoning` for the high-capability model. The CLI does not accept
`high-capability` as an alias.

## Live local inference

Use a throwaway target with no secrets in its source tree. Keep credentials in
the process environment, not in an event file or committed `.env`.

After setting `OPENROUTER_API_KEY` in the environment:

```powershell
$out = Join-Path $env:TEMP "lights-on-result.json"
$env:LIGHTS_ON_STATE_FILE = Join-Path $env:TEMP "lights-on-local-state.json"
node .github\lights-on\runner\run-agent.mjs `
  --task docs-clarifier `
  --provider openrouter `
  --output $out
```

This command can export permitted candidate changes into the target checkout.
Review the diff and result before calling a publisher to open a PR.

Use `--event-file` for a saved JSON payload and repeat `--context-file` or supply
comma-separated context paths as needed. The runner treats those files as data
and gets authorization from configuration. `--repo-root` selects the source root.

## Scan without live registry queries

```powershell
$env:LIGHTS_ON_STATE_FILE = Join-Path $env:TEMP "lights-on-scan-state.json"
node .github\lights-on\runner\scan-dependencies.mjs `
  --offline `
  --output (Join-Path $env:TEMP "lights-on-dependencies.json")
```

The scanner writes its output and may save local cache state. It cannot obtain
fresh advisory or registry evidence in offline mode. The dependency validator
still requires that evidence.

## Preparing a custom worker image

A worker image must support the sandbox contract:

1. Pin a reviewed Linux image by digest and include the required native tools.
2. Keep immutable caches/tools outside `/workspace`; that directory is replaced
   by the candidate bind mount.
3. Make them usable by a non-root UID with a read-only container root.
4. Account for `HOME=/tmp` and a fresh temporary `/tmp` on each command.
5. Put setup logic in a tool wrapper if needed; the runner invokes `/bin/sh` instead of the image entrypoint.
6. Include an offline package-manager cache for the **candidate** lockfile graph,
   not only installed dependencies from the old version.
7. Keep registry/provider credentials out of the image.

If a package manager needs a writable cache, a reviewed wrapper on the image's
`PATH` can copy the immutable cache into `/tmp` before invoking the real tool.
A Docker entrypoint-only cache initializer will not run under this controller.

Package-cache preparation can require network access. Use a separate controlled
build process, honor configured registry proxies, and keep private
credentials out of image layers and logs.

Test the image through the sandbox API before using it in Actions:

```powershell
$env:LIGHTS_ON_SANDBOX_IMAGE = "REGISTRY/IMAGE@sha256:REPLACE_WITH_REVIEWED_DIGEST"
node --input-type=module -e 'import { createAgentSandbox } from "./.github/lights-on/runner/agent-sandbox.mjs"; const worker=createAgentSandbox({repoRoot:process.cwd(),image:process.env.LIGHTS_ON_SANDBOX_IMAGE}); try { const result=worker.run("npm ci --offline --ignore-scripts --no-audit --no-fund && npm test"); console.log(JSON.stringify(result)); if(result.exit_code!==0)process.exitCode=1; } finally { worker.dispose(); }'
```

Replace the image placeholder. This executes in a disposable candidate copy and
does not call `worker.apply()`, so test artifacts are not exported to source.
It can still consume local Docker resources.

## Contributor expectations

- Keep provider inference, untrusted commands, and credentialed publication
  separated.
- Test outcomes as well as flag strings. The CLI and Docker
  tests caught behavior that simple string assertions missed.
- Use synthetic data and mocked GitHub operations; tests must not create remote
  issues, PRs, labels, releases, or packages.
- Add a regression for each failure shape: missing evidence, malformed output,
  permission errors, retries, and partial results.
- Keep JSON stdout machine-readable. Use the workflow reporting helper for
  escaped stderr annotations and Summary output.
- Update docs and runnable examples when public options or outcomes change.
- Validate workflow YAML and generated workflow edits with `actionlint` when
  changing Actions integration.

### Documentation style

Use [stop-slop](https://github.com/hardikpandya/stop-slop) when editing prose.
Name the actor and the action. Cut repeated caveats, filler and promotional
claims. Use concrete examples and reserve bold text for warnings readers need
to catch.

Preserve command syntax, configuration names and security restrictions.
Explain a limitation once near the affected operation, then link to it.

## Useful source and test entry points

| Area | Tests |
|---|---|
| General configuration, installers, scanners, providers | [`lights-on.test.mjs`](../tests/lights-on.test.mjs) |
| Worker, review-state, label, and artifact boundaries | [`security-boundaries.test.mjs`](../tests/security-boundaries.test.mjs) |
| Dependency selection, validation, and migrations | [`dependency-work.test.mjs`](../tests/dependency-work.test.mjs) |
| PR/label publication | [`publication.test.mjs`](../tests/publication.test.mjs) |
| Actions annotations and summaries | [`workflow-report.test.mjs`](../tests/workflow-report.test.mjs) |
| Usage aggregation and persistence | [`usage.test.mjs`](../tests/usage.test.mjs) |
| Node lifecycle proposals | [`toolchains.test.mjs`](../tests/toolchains.test.mjs) |
| Commit-bound reviews, package identity, event/budget admission | [`adversarial-mitigations.test.mjs`](../tests/adversarial-mitigations.test.mjs) |
