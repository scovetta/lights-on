# Protected local npm demo

These scripts demonstrate the existing **one-shot** local runner against a
GitHub npm repository. They are not the proposed autonomous service.

The demo fetches a commit, prepares a pinned worker image for its lockfile, then
runs offline tests, a dependency scan, or an explicitly authorized documentation
agent. It cannot publish comments, PRs, branches, labels, releases or packages.
It refuses to target `scovetta/lights-on` itself.

## Requirements and limits

- Node.js 24+, npm, and a Linux Docker engine. Windows uses the existing WSL
  approach; set `LIGHTS_ON_WSL_DISTRO` if your distribution is not `AzureLinux3.0`.
  Node/npm and Docker must also work inside that distribution.
- One root npm package and a real `npm test` script. A committed lockfile must be
  `package-lock.json` v2/v3. If absent, setup resolves a **demo-only** lockfile.
  No workspaces, shrinkwrap, bundled packages or Git/file dependencies. Dependencies
  in committed locks must carry SHA-512 integrity to match npm's exported offline
  cache. For newly generated locks, legacy registry SHA-1 is verified during
  download and replaced with a computed SHA-512 pin. The example profile targets
  Linux/amd64.
- Dependencies must be available through your selected, unauthenticated HTTPS
  npm registry/proxyfeed. Preparation never falls back to the public registry,
  follows lockfile download URLs, or uses a target `.npmrc`.
- Package installation runs with lifecycle scripts disabled. Packages requiring
  native compilation or install hooks may need a separately approved image;
  this demo does not silently enable those hooks.
- Allow space for the source snapshots, image layers, caches and test outputs.
  Limits of 512 distinct package versions and 128 MiB of downloaded archives
  keep this a small-project demo, not a general acquisition service. These are
  post-download checks, not hard filesystem quotas.

## 1. Prepare a target

From the Lights On checkout, replace `OWNER/REPO` and select a **new** output
directory outside the checkout:

```powershell
node local\demos\npm\setup.mjs `
  --repo OWNER/REPO --ref main `
  --directory C:\runs\npm-demo --provider codex
```

Linux:

```sh
node local/demos/npm/setup.mjs \
  --repo OWNER/REPO --ref main \
  --directory "$HOME/lights-on-runs/npm-demo" --provider codex
```

Omit `--ref` to use the repository's default branch. Setup records the resolved
SHA; later runs use that same commit rather than a moving branch. Create a new
demo directory to refresh the target and lockfile.

The default registry comes from `npm config get registry` on the invoking host,
including Windows before forwarding to WSL. Override it with `--registry
https://YOUR-PROXY/npm/`. No credential may appear in that URL.

For private repositories or GitHub API rate limits, supply a repository-scoped
read-only token in `LIGHTS_ON_DEMO_GITHUB_TOKEN` and add `--github-auth`. The token
is injected only into fetch requests; it is not written into policies or images.

**Setup performs downloads and Docker builds.** GitHub fetching uses the
protected gateway. npm cache acquisition and Docker image preparation run on
the operator's host/WSL environment, outside that gateway's audit. npm receives
only package names/exact versions, isolated empty configuration, the selected
registry and transport settings. It does not execute target code or lifecycle
scripts. Downloads must match the lockfile's integrity.
Temporary cache/build work uses the Linux temporary filesystem, including under
WSL, rather than performing every cache operation on a Windows-mounted output
directory. The final policies, snapshots and reports remain in your chosen directory.

For a repository without a lockfile, a separate preparation container resolves
registry requirements from an inert manifest: no scripts or target source files
are copied into that container. Its gateway allows only metadata GETs under the
selected registry. Repository code and lifecycle scripts do not execute.
Other package-manager locks, a project `.npmrc`, overrides, aliases or workspace
configuration block this fallback rather than being silently ignored.

The generated `dependency-lock.json` records today's resolution, not the
project's historical dependency graph. Its origin and source-manifest digest
are recorded in `demo.json`; preparation diagnostics and network metadata are
retained separately. Neither the fetched source nor the candidate gets a
generated lockfile. Inside offline workers, `npm ci` installs from a temporary
manifest/lock pair and copies only `node_modules` into the workspace. A changed
`package.json` requires new preparation. The generated validation lock uses
verified archives at immutable image-local paths, not registry download URLs;
it is an input for that worker image, not a lockfile to copy into the project.

The worker image contains the cache re-created from verified local archives and,
when needed, those archives, the generated lock and manifest digest. It does not contain the HTTP
download cache, npm configuration, credentials or logs. Its build
uses `--network=none` after the pinned base image has been prepared. This cache is
available to both analysis command workers and final validation.

The bootstrap snapshot has no validation profile and is recorded as **blocked
coverage**, not a successful validation. Setup completion means the demo is
prepared; the next step establishes whether the target actually passes.

## 2. Validate and scan without a model

```powershell
node local\demos\npm\run.mjs --directory C:\runs\npm-demo --task validate
node local\demos\npm\run.mjs --directory C:\runs\npm-demo --task scan
```

Use the corresponding Linux paths for the same commands. Neither command needs
a provider credential. Validation runs:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund \
  && npm run build --if-present \
  && npm run lint --if-present \
  && npm test
```

These project commands execute only in disposable, networkless containers.
The scan additionally contacts OSV and ecosyste.ms through approved gateway
rules. Unavailable advisory/metadata evidence is a blocker, not a clean report.
Missing cache entries, failed tests, blocked coverage and skipped task results
all make the demo command fail explicitly.

`scan` currently requires a committed npm lockfile. A generated demo lock is
validation input, not authoritative repository scan input; the demo refuses to
report that synthetic dependency tree as a completed repository scan. Lockless
repositories can use `validate` and `docs-clarifier`.

## 3. Run a documentation agent

Select `--provider codex|claude|openrouter|copilot` during setup. Supply the
corresponding environment variable before this step:

| Provider | Variable |
|---|---|
| Codex | `OPENAI_API_KEY` |
| Claude | `ANTHROPIC_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Copilot | `COPILOT_GITHUB_TOKEN` |

```powershell
node local\demos\npm\run.mjs `
  --directory C:\runs\npm-demo --task docs-clarifier --allow-inference
```

`--allow-inference` explicitly authorizes sending repository context to the
selected provider and incurring provider charges. The generated agent policy
has no publication capability. A model can produce no changes or fail; the demo
does not fabricate a patch. Existing repository configuration and maintenance
limits still apply. Use provider-side billing limits as well.

For Copilot, setup automatically builds the controller from Lights On's trusted
Dockerfile and locked CLI/SDK dependencies, using the same selected npm registry.
It records the resulting immutable image ID; no Copilot token is needed until
inference. The first build downloads tooling and can take several minutes;
later builds can reuse Docker's cache.

```powershell
node local\demos\npm\setup.mjs `
  --repo OWNER/REPO --ref main `
  --directory C:\runs\npm-demo --provider copilot
```

To reuse an existing approved controller, pass `--controller-image sha256:...`.
Manual build instructions remain in
[protected local execution](../../../docs/local-container.md#dependencies-and-custom-images).
The controller build runs during preparation, outside the protected gateway
audit; it does not include the target repository or provider credentials.
The target configuration selects the CLI or SDK backend.
Subscription-specific endpoints not covered by the example rules fail closed.
An optional `--model MODEL` is also available during setup.

## Inspect the result

The command prints the managed run directory and paths for:

- `summary.md`, `result.json` and `validation.json`: task and test outcomes.
- `candidate/`: proposed source files; nothing has been pushed.
- `network.jsonl`: protected execution's network metadata, not setup's npm or
  Docker downloads.

Use the existing launcher for individual run inspection/cleanup:

```powershell
node local\lights-on.mjs status --run C:\runs\npm-demo\runs\RUN_UUID
node local\lights-on.mjs cleanup --run C:\runs\npm-demo\runs\RUN_UUID
```

Setup stores `demo.json`, separate read/agent policies, source snapshots and the
pinned worker/controller image identities. Run artifacts and budgets stay under
this demo directory. Cleanup does not remove images; inspect the recorded IDs
and remove only images no longer needed by any run. Failed setup preserves its snapshot
records but removes temporary download/build files.

The cache covers the **prepared dependency resolution only**. This does not demonstrate
automatic acquisition of new dependency versions, unattended scheduling, merge
approval or release publishing. Generated policies are checked against their
setup digests; do not edit them to add privileges and continue the demo.
