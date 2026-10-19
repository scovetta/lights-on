# Getting started

[Documentation index](README.md)

Install Lights On, configure your CI and choose which operations it may perform.
Start with merges and releases disabled while you check the results.

## 1. Choose the write repository

Install in a repository you maintain, or in your own maintenance fork or
successor repository.

In the target checkout, inspect the remotes:

```powershell
git remote -v
```

`origin` must identify the repository you intend to maintain. Lights On treats
an `upstream` remote as read-only. Create your fork before installing; the
installer does not create or transfer repositories.

This installation path supports GitHub.com. The installer binds label writes
to that host even if your local `gh` default points elsewhere. The controllers
reject GitHub Enterprise hosts.

The examples below use `C:\src\lights-on` for the Lights On source checkout and
`C:\src\my-project` for the target. Replace these paths with your own.

## 2. Install the files

From a reviewed, current Lights On checkout:

```powershell
& C:\src\lights-on\install.ps1 -TargetDir C:\src\my-project
```

On a POSIX host:

```sh
sh /path/to/lights-on/install.sh /path/to/my-project
```

The target directory must already exist. The installer copies:

- `.github/lights-on.yml`
- `.github/actions/lights-on-agent/action.yml`
- Controller modules, prompts, and ecosystem metadata under `.github/lights-on/`
- The four `lights-on-*` workflows

It does not copy this documentation set, the Lights On self-tests, or this
project's threat model into the target repository.

### Installation side effects

| Operation | Default behavior |
|---|---|
| Replace an existing `.github/lights-on.yml` | No; requires `-Force` / `--force`. |
| Replace bundled workflows, prompts, and runner modules | Yes. Review target customizations first. |
| Create GitHub labels locally through the installer | No; requires `-CreateLabels` / `--create-labels`. |
| Create a commit or push files | No. |
| Run threat-model bootstrap during installation | No; it runs during maintenance. |

Optional label creation checks your authentication and push permission on the
target origin. Confirm that origin before enabling it. The installed workflows
create standard labels as needed.

### Preview before installing

Use `-DryRun` in PowerShell or `--dry-run` in POSIX sh:

```powershell
& C:\src\lights-on\install.ps1 -TargetDir C:\src\my-project -DryRun
```

```sh
sh /path/to/lights-on/install.sh /path/to/my-project --dry-run
```

The preview lists new, changed and unchanged files and shows unified content
diffs from the installed version to the incoming source. It creates no target
directories, changes no target files and makes no GitHub label calls, even with
`-CreateLabels` / `--create-labels`.

An existing `.github/lights-on.yml` stays excluded unless you also pass
`-Force` / `--force`. Remove the dry-run flag to apply the same installation.
Git is required for the diffs. Differences return a successful exit status;
comparison errors fail the preview.

Use a current source checkout for upgrade previews. If the installer needs to
download its source, it may clone into a temporary directory and removes that
directory afterward. The preview does not propose deleting obsolete files.

## 3. Configure a provider

Add one of these repository **Actions secrets**:

| Secret | Provider |
|---|---|
| `COPILOT_GITHUB_TOKEN` | Inference-only Copilot CLI or SDK |
| `ANTHROPIC_API_KEY` | Anthropic Messages API |
| `OPENAI_API_KEY` | OpenAI Responses API |
| `OPENROUTER_API_KEY` | OpenRouter |

Use a credential authorized for the selected service. The repository's ordinary
`GITHUB_TOKEN` is not a substitute for a working Copilot credential.

Under **Settings > Actions > General > Workflow permissions**, allow the
installed workflows to write repository content and create pull requests.
Organization policies can still prohibit these operations. Do not add unrelated
repository or registry privileges to provider credentials.

Provider defaults and routing are listed in the
[configuration reference](configuration.md#provider-routing).

## 4. Start conservatively

Edit the existing configuration rather than adding duplicate top-level keys:

```yaml
autonomy:
  mode: review-only
  require_ci_pass: true
  require_independent_agent_review: true
  required_checks: []

release:
  enabled: false

toolchains:
  enabled: false
```

In `review-only` mode, Lights On can post comments and create branches or PRs,
but cannot merge. Disable releases with `release.enabled: false`.
To prevent new Lights On jobs, set the repository variable `LIGHTS_ON_ENABLED`
to the literal `false`.

Leave `upstream.repo: auto` for fork discovery, set an explicit `owner/repo`, or
use `none` to disable upstream polling.

External paid event triggers require maintainer authorization by default
(`events.allow_external_triggers: false`). Scheduled/manual maintenance still
runs. Keep the default during rollout, or opt in to unattended
public responses after setting service-side spending controls.

## 5. Prepare CI and the offline worker

Prepare both environments:

| Environment | Purpose |
|---|---|
| Repository CI | Checks the proposed PR using the project's normal test workflows. |
| Lights On worker | Runs bounded commands without network access or credentials. |

The supplied workflows use Ubuntu GitHub-hosted runners with Docker. Their
commit-bound `$/` action references require runner 2.336.0 or newer.
The default worker image supplies Node.js. You must provide your project's other tools and
dependencies. Routine npm validation needs an offline cache for the candidate
lockfile; preinstalled `node_modules` cannot replace that frozen install.

For a reviewed custom image, set the `LIGHTS_ON_SANDBOX_IMAGE` repository
variable, preferably to an immutable image digest. See
[worker preparation](development.md#preparing-a-custom-worker-image).

Before enabling automatic merging:

1. Run the target's CI at least once and inspect its check names.
2. Populate `autonomy.required_checks`, or use the discovery helper below.
3. Make sure the PR gate listens for the target's CI workflow names.
4. Configure GitHub branch protection to require the same essential checks.

If GitHub already requires CI checks, fill the empty list from those rules:

```powershell
node .github\lights-on\runner\discover-required-checks.mjs --repo OWNER/REPO --update-workflows
# Review the diff, then repeat with --write.
```

The installed **Lights On - Discover Required CI Checks** workflow provides the
same discovery in Actions and uploads proposed configuration for review. It does
not publish changes. Repositories without enforced requirements receive
candidates for manual selection, not an automatic acceptance policy.
See [discovery and read permissions](configuration.md#discover-required-checks).

For a repository with these checks:

```yaml
autonomy:
  required_checks:
    - { context: "commitlint", app_id: 15368 }
    - { context: "test (22)", app_id: 15368 }
    - { context: "test (24)", app_id: 15368 }
```

`15368` identifies the GitHub Actions app on GitHub.com. Check names are exact,
including spaces and matrix suffixes. Missing required checks block merging.
See [CI identities](configuration.md#required-ci-checks) before copying the
example unchanged.

## 6. Commit and run

From the target checkout:

```powershell
git add .github
git commit -m "chore: adopt Lights On maintenance"
git push
```

Then open **Actions > Lights On - Scheduled Maintenance > Run workflow** and
choose `bootstrap`. The workflow also runs daily at 06:00 UTC.

Inspect:

- The run's annotations and Summary.
- Any generated threat-model PR.
- Whether the target CI and independent PR gate ran.
- Any missing-cache, verification, permission, or model-output blockers.

`ensure-threat-model.mjs --check` reports section validity in JSON and fails for
a missing file, missing required sections or an execution error. Scheduled
maintenance can bootstrap an incomplete model. Review the claims yourself;
the checker verifies section presence, not their truth.

Record scope and non-goals in `THREAT_MODEL.md` sections §1.2–§1.3. You do not
need separate `INTENDED_USE.md` or `DEPENDENCIES.md` files.

Review the questions in §1.18. You can answer in the threat model or on its PR,
replace a supported `[inferred]` claim with `[maintainer (YYYY-MM-DD)]`, and
retire the answered question. The prompts tell agents to escalate unsupported
inferences, but the runtime has no separate provenance validator.

After checking a proposal/review cycle, change `autonomy.mode` to `lights-on`.
Enable releases or toolchain maintenance after reviewing their prerequisites.

## Updating an installation

Update the **Lights On source checkout**, then install from it again:

```powershell
git -C C:\src\lights-on pull --ff-only
& C:\src\lights-on\install.ps1 -TargetDir C:\src\my-project
```

Do not use `-Force` unless you intend to reset the target configuration.
PowerShell also supports `-SourceDir` for an explicit local source.

The installer does not migrate configuration or remove obsolete files. Review
the target diff, add the settings you need, restore workflow
customizations, and commit the update.

Use a current source checkout for upgrades. The remote installer one-liner can
reuse an installed repository's old files as its source.

To roll back, disable new jobs, cancel active runs, and revert the installation
commit through your normal Git process. Do not delete `.github`, which
may contain unrelated project workflows.

## Before leaving it unattended

- [ ] The installed repository and Git origin are correct.
- [ ] Provider credentials work and have provider-side spending controls.
- [ ] Tests install and exercise the candidate dependency versions.
- [ ] Required CI contexts and workflow triggers match the target project.
- [ ] You have observed a complete proposal/review cycle.
- [ ] You have reviewed the threat model.
- [ ] Release credentials/trusted publishers are configured, or releases remain disabled.
- [ ] Someone knows the kill switch and the [operations runbook](operations.md).
