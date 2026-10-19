# Lights On

**HIGHLY EXPERIMENTAL:** Lights On is an experiment and not ready for use in anything that matters. It may contain serious security flaws, including susceptibility to prompt injection and similar. Be extremely careful.

Lights On runs routine maintenance for open-source projects through GitHub
Actions. It uses Copilot, Claude, Codex or OpenRouter to respond to issues,
update dependencies, propose security fixes and review pull requests.

Use it for a stable project that needs maintenance but gets little day-to-day
attention. You choose the project's scope, tests and permissions. Lights On
checks proposed changes against those requirements before publication or merge.
Model reviews and passing tests can still miss bugs.

[Get started](docs/getting-started.md) · [Configuration](docs/configuration.md) ·
[Troubleshooting](docs/operations.md) · [Roadmap](docs/mission-vision-strategy-roadmap.md)

[Website source and Pages deployment](web/README.md)

## Set up a repository

Install Lights On in a repository you maintain or in your own maintenance fork.
Check that `origin` points to that repository. Lights On supports GitHub.com;
its controllers reject GitHub Enterprise hosts.

### Install the files

From a reviewed Lights On source checkout:

```powershell
.\install.ps1 -TargetDir C:\path\to\target-repo
```

```sh
./install.sh /path/to/target-repo
```

For a first installation, you can also run the remote installer from the target
repository root:

```sh
curl -fsSL https://raw.githubusercontent.com/scovetta/lights-on/main/install.sh | sh
```

```powershell
irm https://raw.githubusercontent.com/scovetta/lights-on/main/install.ps1 | iex
```

The installer copies the four maintenance workflows, composite action, runner
modules and prompts into `.github/`. It preserves an existing
`.github/lights-on.yml` unless you pass `-Force` or `--force`. It overwrites the
bundled automation files, so review any customizations first.

Installation creates no commits, pushes or GitHub labels by default. Use
`-CreateLabels` or `--create-labels` to create labels after the installer checks
the target origin and your push permission. The installed workflows also
initialize the labels they need. See [installation side effects](docs/getting-started.md#installation-side-effects).

### Choose a provider

Add one repository secret under **Settings > Secrets and variables > Actions**:

| Provider | Secret |
|---|---|
| Copilot | `COPILOT_GITHUB_TOKEN` |
| Claude | `ANTHROPIC_API_KEY` |
| Codex | `OPENAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |

With `engine.provider: auto`, the runner checks for credentials in that order.
You can set a provider and model in the repository configuration. See
[model defaults and routing](docs/configuration.md#provider-routing).

Copilot uses the pinned inference-only CLI or the
[opt-in SDK backend](docs/configuration.md#copilot-sdk-backend). Claude, Codex and OpenRouter use
their provider APIs. OpenRouter models must support the tool-calling interface;
check model access with your account before enabling unattended work.

Under **Settings > Actions > General > Workflow permissions**, select read/write
permissions and allow Actions to create and approve pull requests. Organization
policy may restrict these permissions.

### Configure CI and permissions

Start with `autonomy.mode: review-only` and `release.enabled: false`.
In review-only mode, Lights On can post comments and create branches or PRs.
It cannot auto-merge. Release automation has its own switch.

Before enabling merges:

- Populate `autonomy.required_checks` with your check names and their GitHub
  App IDs. [Discovery](docs/configuration.md#discover-required-checks) can fill
  the list from GitHub's enforced rules. The default empty list blocks auto-merge.
- Configure branch protection to require those checks.
- Match `workflow_run.workflows` in `lights-on-pr.yml` to your CI workflow
  names. The supplied list is `CI`, `Lights On - Self Test CI`, `Test` and
  `Lint Commits`.
- Prepare the offline worker's tools and dependency cache.

For example:

```yaml
autonomy:
  required_checks: [{ context: "build", app_id: 15368 }]
```

Use your check's exact `name` and `app.id` from GitHub's check-runs API.
`app_id: null` selects a legacy commit status. A workflow name such as `Test`
differs from a check name such as `test (24)`.
[CI setup details](docs/configuration.md#required-ci-checks)

### Start a run

```sh
git add .github
git commit -m "chore: adopt Lights On autonomous maintenance"
git push
```

Open **Actions > Lights On - Scheduled Maintenance > Run workflow** and choose
`bootstrap`. The schedule also runs at 06:00 UTC.

Inspect the result, any threat-model PR, and the follow-on CI/review jobs.
GitHub suppresses some events caused by `GITHUB_TOKEN`, which the supplied
workflows use for publication. Confirm that your CI and review jobs ran; use
the manual dispatches if they did not.

External issues, comments and PRs need maintainer authorization before paid
inference by default. Keep `events.allow_external_triggers: false` during
evaluation. Scheduled and manual work still run.

## Maintenance tasks

| Task | Scope |
|---|---|
| Issues | Classify reports against the threat model, answer questions, request reproductions and propose fixes. |
| Dependencies | Check advisories and maintenance health; prepare supported updates or migration plans. |
| Security | Assess OSV findings and propose fixes. Tests depend on the offline tools and cache you provide. |
| Documentation | Address usage questions and documentation drift using repository and issue context. |
| Pull requests | Review the threat model, intended use, downstream compatibility and tests; apply merge gates outside the model. |
| Upstream maintenance | Read upstream issues, PRs and releases; create selected tracking issues in the installed repository. |
| Releases | Prepare patch/minor release PRs, then build and publish through separate jobs. |

The scanner recognizes npm, Python, Cargo, Go, .NET, Ruby and GitHub Actions
references. It uses [OSV](https://osv.dev) and
[ecosyste.ms](https://ecosyste.ms). Scanning coverage varies by ecosystem:
Maven parsing and a complete transitive lockfile inventory are not implemented.

The [maintenance guide](docs/maintenance.md) lists task inputs and the scheduled
stages. The [configuration reference](docs/configuration.md) identifies settings
that the runtime does not yet enforce.

## Dependency maintenance: select, validate, publish

Steps D through F handle dependency work. Step C handles security remediation.

| Stage | Work |
|---|---|
| D | Select one eligible dependency using the scan, open PRs, attempts and cooldowns. |
| E | Generate a candidate or read-only migration plan; validate executable changes in a fresh offline worker. |
| F | Publish files matching the validation record, or create/reuse a blocker issue. |

Routine updates support eligible npm `package-lock.json` v2/v3 projects with an
existing test script. They target one stable, compatible patch/minor version.
Workspaces, competing lockfiles, pre-1.0 minor updates and missing registry or
advisory evidence block this path. An open PR touching the same manifest also
suppresses another update, including a security PR.

The updater may change the selected requirement and lockfile, preserving
`^`, `~` or exact-version style. The package manager must generate the lockfile.
The controller checks scope, target advisories and installed resolution, then
runs the original build/lint/test scripts. It rejects source changes made
during validation.

You need an offline cache for the candidate lockfile. Existing `node_modules`
does not establish that a frozen install will succeed.
[Dependency validation requirements](docs/maintenance.md#independent-validation)

### Migrations

Use `task: migration-plan` or `/lights-on migrate-dep <package>` to request
read-only planning. Execution requires a reviewed
`dependencies.approved_migrations` entry on the default branch, followed by a
manual `task: migration` run with its plan ID. A label or agent response cannot
approve a replacement.

For example, an approved internal migration to the standard library might use:

```yaml
dependencies:
  update_max_turns: 8
  migration_plan_max_turns: 12
  migration_max_turns: 20
  validation_commands: []
  approved_migrations:
    -
      id: remove-unused-helper
      ecosystem: npm
      name: old-helper
      manifest: package.json
      replacement: { name: stdlib }
      plan: "Replace old-helper internally with equivalent standard-library calls; preserve public exports."
      allowed_files: [package.json, package-lock.json, src/helper.js, test/helper.test.js]
      validation_commands:
        - "npm ci --offline --ignore-scripts && npm test && node -e 'require(\"fs\").writeFileSync(\"dependency-validation.json\", JSON.stringify({resolved:[]}))'"
```

Adapt this example to the project before approving it. Validation must confirm
the retired dependency's removal, any replacement version and the declared
file scope. For non-npm ecosystems, provide the native frozen-resolution and
compatibility checks described in [migration execution](docs/maintenance.md#migration-execution).
Protected automation and threat-model files require a separate change.

Update, planning and migration tasks have default limits of 8, 12 and 20 turns,
also capped by the per-run limit. These tasks do not fall back to other
providers. Blocker/plan publication sets a 48-hour cooldown for that task.
The old `dependency-maintainer` task remains a read-only planning alias.

### Node toolchains

Step G can propose Node runtime changes in CI, runtime selectors and listed
build files. It is off by default:

```yaml
toolchains:
  enabled: true
  node:
    support_policy: supported
    update_ci: true
    update_runtime_files: true
    build_files: [scripts/build.sh, Dockerfile]
```

The updater reads the [official Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json).
`supported` removes end-of-life releases; `active-lts` also removes released
current/maintenance versions. As of 2026-10-18, `[20, 22, 24]` becomes `[22, 24]`
under `supported` and `[24]` under `active-lts`.

These PRs carry `lights-on:hold`. They leave public `engines`, required CI
checks and branch protection unchanged. Complex matrices, exact patch/digest
pins, aliases and heredoc build scripts need manual review.
[Supported toolchain edits](docs/maintenance.md#node-toolchain-maintenance)

## Review and merge controls

The independent reviewer assesses four areas: the threat model, intended use,
downstream compatibility, and tests. The controller then checks the complete
file inventory, protected paths, selected dangerous diff patterns, author
policy, control labels and current CI for the reviewed SHA.

External PR auto-merge is off by default:

```yaml
# .github/lights-on.yml
autonomy:
  allow_external_pr_automerge: false
```

`lights-on:automerge` opts one PR into the author-policy check.
`lights-on:approved-override` can waive protected-path and reported breaking-API
blocks. Neither label waives missing CI, failed review, pause/hold or dangerous
diff checks. `lights-on:approved` alone does not authorize a merge.

Reviews name the exact commit. The controller rejects stale heads and does not
reuse comment markers as approval. It fetches the current check results rather
than treating one successful workflow as sufficient CI evidence. PRs beyond
GitHub's 3,000-file inventory cap need manual review.

See [PR gates](docs/architecture.md#deterministic-pr-gates) and
[maintainer controls](docs/operations.md#maintainer-controls) for the checks,
labels and commands. Configure branch protection as a server-side safeguard.

## Workers and local execution

Provider credentials stay in the controller. The controller dispatches file
tools against a candidate copy and shell commands into an offline Linux Docker
worker. The copy omits `.git`, `node_modules` and `.venv`.

Workers run as non-root users with resource limits, dropped capabilities and a
read-only root. They receive the candidate mount, not your Docker socket,
credentials, checkout or home directory. Unavailable tools and downloads fail;
there is no host-shell fallback.

Set `LIGHTS_ON_SANDBOX_IMAGE` to a reviewed image containing the tools and caches
your project needs. Keep caches outside `/workspace`, where the candidate bind
mount would hide them. Keep secrets out of source files: the copy step does not
redact a local `.env`.

The optional [protected local launcher](docs/local-container.md) adds an audited,
default-deny gateway for trusted network requests. It supports custom offline
CI images and disposable test services without replacing Actions. Proposal
publication, merges, releases and registry uploads each need a grant.

[Worker image setup](docs/development.md#preparing-a-custom-worker-image) ·
[Security boundaries](docs/architecture.md)

## Releases

Step I prepares patch/minor release PRs. The release workflow verifies the
merged version, builds without registry credentials, verifies/creates the tag,
then uploads from fresh jobs with one registry's credential.

Major bumps require human handling. Capping a breaking-change commit at a
minor version does not make it compatible. The analyzer reads commit subjects,
so it can miss a breaking marker buried in a commit body.

Upload validation checks internal names and versions against trusted source.
It rejects package substitution, ambiguous metadata and unsafe archive members
without extracting archives or running package code. It requires Python 3.11+
and Ruby/Psych for RubyGems. These checks do not detect malicious contents inside
a correctly named package.

Supported targets are npm, PyPI, crates.io, NuGet and RubyGems; Go releases use
tags. Registry authentication, supported layouts and partial-failure recovery
need setup. Read the [release guide](docs/releases.md) before enabling
`release.enabled`.

## Run results and spending

Look for a confirmed PR URL in the Actions annotations or job Summary.
`Agent task completed` describes candidate generation; the publisher reports
whether GitHub created or reused a PR.

An unfinished agent now fails the step and discards its candidate. Inspect
`execution.stop_reason` before raising a limit. Token exhaustion can occur
well before the turn limit.

| Limit | Default |
|---|---|
| Turns per provider attempt | 25 |
| Known tokens per attempt | 100,000 |
| Known/estimated USD per attempt | $2 |
| Recorded daily USD budget | $10 |
| Recorded agent runs per day | 25 |
| Model calls across retries/fallbacks | 30 |

Copilot reports tokens and billing units, but no USD cost. Its `cost_usd` stays
`null`; a dollar cap cannot bound those charges. Other providers may use the
generic $5/million-token estimate. Use provider-side spending controls.

The runner reserves usage before inference and records known usage from failed
calls. Cache loss, interrupted runners and GitHub's pending-run queue can lose
accounting or work. Local and Actions runs do not share a global billing ledger.
The scheduled `force` input does not bypass these limits, and
`max_prs_per_run` is not enforced across scheduled publishers.

[Limits and accounting](docs/configuration.md#usage-and-rate-limits) ·
[Failure diagnosis](docs/operations.md)

To stop new jobs, set the repository variable `LIGHTS_ON_ENABLED=false`.
Cancel active runs in Actions. This switch does not stop the independent
Lights On self-test workflow.

## Update an installation

Update the source checkout, then preview the files the installer would replace:

```powershell
git -C C:\src\lights-on pull --ff-only
& C:\src\lights-on\install.ps1 -TargetDir C:\src\maintained-project -DryRun
```

```sh
git -C /path/to/lights-on pull --ff-only
sh /path/to/lights-on/install.sh /path/to/maintained-project --dry-run
```

Dry runs show content diffs without changing target files or GitHub labels.
Existing configuration stays excluded unless you add `-Force` / `--force`.
See [preview details](docs/getting-started.md#preview-before-installing).

Remove the dry-run flag to install from the same reviewed source:

```powershell
& C:\src\lights-on\install.ps1 -TargetDir C:\src\maintained-project
```

```sh
sh /path/to/lights-on/install.sh /path/to/maintained-project
```

Leave out `-Force` / `--force` to keep your configuration. PowerShell also
accepts `-SourceDir`. The installer preserves `THREAT_MODEL.md`, does not migrate
configuration and does not remove obsolete files. Review the diff and restore
workflow customizations before committing.

Use a current source checkout for upgrades. The remote one-liner can reuse
an installed repository's old files instead of downloading updates.

A pushed branch survives a failed PR-creation step. Recover it without rerunning
the agent using the [publication recovery procedure](docs/operations.md#a-branch-was-pushed-but-no-pr-appeared).

## Documentation and development

The [documentation index](docs/README.md) covers setup, configuration, maintenance,
release operations and troubleshooting. Start with the
[development guide](docs/development.md) to run local tests or prepare a worker
image.

The [mission and roadmap](docs/mission-vision-strategy-roadmap.md) describes the
planned 100-project evaluation. That campaign has not run.
