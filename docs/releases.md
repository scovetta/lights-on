# Releases

[Documentation index](README.md)

Keep `release.enabled: false` until you have checked package identity,
permissions and registry authentication. Merge settings do not disable releases.

## Release lifecycle

1. Step I or manual `task: release` analyzes commit subjects since the latest
   SemVer tag, updates supported manifests/changelog and proposes a release PR.
2. Review the PR and run the normal CI/merge checks.
3. The release workflow verifies the release SHA, metadata and manifest version.
4. Build jobs create packages without registry secrets or OIDC permission.
5. The tag job creates the tag or verifies its SHA. It refuses to move an
   existing tag to another commit.
6. Fresh upload jobs receive validated artifacts and one registry's credential.
   Token-only jobs cannot request OIDC tokens; a separate job handles uploads
   that need OIDC authentication or npm provenance.

The merge-event path requires a merged PR into the default branch, a
`lights-on:release` label, and a recognized trusted author. The publisher does
not independently reconstruct the PR's complete review history.

The publisher renders commit-derived PR descriptions and release notes as
literal text to prevent external-repository backlinks. Links and other rich
Markdown in those bodies stay inactive.

GitHub event suppression can prevent a token-driven merge from triggering the
publisher. Verify the chain or use manual dispatch after reviewing the release.

## Version policy

Eligible feature commits request a minor bump. Recognized fixes, performance
changes, dependencies and security fixes request a patch. Documentation, CI or
test changes alone do not trigger a release.

`release.max_auto_bump` is `patch` or `minor`; the analyzer cannot generate a
major bump. It flags breaking-change markers and caps the version. Review those
proposals because the code can still break compatibility.

The analyzer reads commit subjects and bodies, including breaking-change and
security markers in commit footers. Unavailable Git tags or history fail
preparation rather than appearing as an initial release or an empty change set.

Version edits stay within `[project]`/`[tool.poetry]` or `[package]` in TOML files.
Preparation requires a literal package version and leaves dependency tables
unchanged. Malformed JSON manifests or lockfiles stop preparation before the
controller writes version changes.

## Manual release dispatch

Open **Actions > Lights On - Release & Package Publisher > Run workflow**.
Select the default branch.

| Input | Purpose |
|---|---|
| `version` | Optional explicit SemVer, such as `1.2.3`; must match the manifest version. |
| `dry_run` | Show the plan without building, tagging, or publishing. Start with `true`. |

This command starts a GitHub workflow with `dry_run=true`, without publishing:

```powershell
gh workflow run lights-on-release.yml --repo OWNER/REPO --ref main -f version=1.2.3 -f dry_run=true
```

Substitute the actual repository/default branch/version. Review the plan before
dispatching a live release.

## Registry support

| Registry | Detected source | Uploaded artifact | Identity |
|---|---|---|---|
| npm | Top-level public `package.json` | `.tgz` | OIDC trusted publisher or `NPM_TOKEN` |
| PyPI | Top-level `pyproject.toml` or `setup.py` | Wheels/sdists | Pinned PyPA action with OIDC or `PYPI_API_TOKEN` |
| crates.io | Top-level publishable `Cargo.toml` | `.crate` plus metadata | `CARGO_REGISTRY_TOKEN` |
| NuGet | Top-level packable `*.csproj` | `.nupkg` | `NUGET_API_KEY` |
| RubyGems | Top-level `*.gemspec` | `.gem` | `GEM_HOST_API_KEY` |
| Go | Top-level `go.mod` | Git tag | No package-upload credential |

Configure trusted publishers in the registry as well as in GitHub; granting
`id-token: write` alone does not authorize publication. RubyGems OIDC is not
implemented in this workflow.

Release planning receives only token-presence booleans and selects the upload
job before registry credentials are supplied:

| Package | Upload job receives `id-token: write` when |
|---|---|
| npm | `NPM_TOKEN` is absent, or `release.provenance` is enabled. |
| PyPI | `PYPI_API_TOKEN` is absent. |
| crates.io, NuGet, RubyGems | Never; these integrations use registry tokens. |

For npm, `release.provenance: false` suppresses the uploader's `--provenance`
request. It does not remove the OIDC permission needed for tokenless
authentication. With `NPM_TOKEN` configured and provenance disabled, npm runs
in the token-only job. Protected local publishing remains token-based.

For PyPI, omit `PYPI_API_TOKEN` after configuring the Trusted Publisher. The
OIDC job calls the pinned PyPA action without a password input. A nonempty secret
selects the token-only job, with attestations disabled because they require
Trusted Publishing. That fallback is explicitly annotated for zizmor as a
compatibility exception, not declared risk-free. Use a package-scoped token if
fallback is needed, and remove it when migrating to OIDC.

Release checkouts do not retain Git credentials and `setup-node` does not
restore implicit package-manager caches. The tag step authenticates its Git
push only for that command through the repository-bound publication helper.

The upload code uses fixed registry destinations. Configure your download proxy
without changing the package publication destination.

## Build and upload constraints

- npm packaging/uploading uses `--ignore-scripts`. Produce required build output
  before packaging; configure your TypeScript/bundler build for that step.
- Python packaging backends, MSBuild targets, and gemspec evaluation execute in
  build jobs without publishing identity.
- The uploader sends crates through the registry API without running Cargo
  with a token.
- Upload manifests check the declared version, ecosystem, filenames, and hashes.
  Python 3.11+ additionally inspects the internal package metadata: npm
  `package.json`, Python `METADATA`/`PKG-INFO`, NuGet `.nuspec`, gem `metadata.gz`,
  and packaged Cargo metadata without extracting archives or executing package
  code. Each distribution must match a trusted name and the exact release
  version; the artifact set must include all expected names.
  RubyGems validation also requires Ruby with Psych: it inspects YAML syntax
  trees without loading Ruby objects, and rejects duplicate effective keys,
  aliases, multiple documents and unsupported tags.
- npm artifacts may contain only `registry`, `access` and `tag` in
  `publishConfig`; the registry must be the trusted npm registry. Transport,
  TLS, authentication and other configuration overrides stop validation before
  the credentialed uploader starts. The uploader enables TLS
  verification and disables lifecycle scripts.
- Python package names use standard hyphen/underscore/dot normalization, and
  NuGet names are case-insensitive. Version comparison is exact; normalized
  prerelease spellings that differ from the release version fail validation.
- Dynamic `setup.py`/gemspec names, conditional MSBuild package IDs, or inherited
  identities require explicit `release.package_names` for that ecosystem.
  Set those names in trusted configuration. Otherwise the inspector reads
  literal names from source manifests. It does not trust names from an artifact
  manifest.
- A correctly named package can still contain malicious code. Keep publishing
  credentials package-scoped.
- You must configure builds for nested monorepo layouts and private registries;
  the workflow does not set them up.
- Missing required registry identity causes upload failure. It is not reported
  as a successful publish.
- One registry upload can succeed while another fails. Check which versions
  exist before retrying; the uploads do not form a transaction.

## Controls

| Intent | Setting |
|---|---|
| Disable preparation and publishing paths | `release.enabled: false` |
| Disable package builds/uploads, but not necessarily tags or release PRs | `release.auto_publish: false` |
| Disable GitHub Release creation, retaining the tag path | `release.create_github_release: false` |
| Stop new Lights On jobs | Repository variable `LIGHTS_ON_ENABLED=false` |

The repository variable `LIGHTS_ON_RELEASE_ENABLED` is wired to the release
workflow; use the YAML setting to disable scheduled release preparation too.
`autonomy.mode: review-only` is not a release disable switch.

## Local planning

From a target checkout with a matching manifest version:

```powershell
node .github\lights-on\runner\publish-release.mjs --version 1.2.3 --dry-run
```

`publish-release.mjs` is now a planning/metadata helper. Its old combined
build-and-publish execution path is disabled. Use the separated
[`lights-on-release.yml`](../.github/workflows/lights-on-release.yml) workflow for
real releases.

For failures, see the [operations runbook](operations.md). Preserve published
tags and immutable package versions during recovery.
