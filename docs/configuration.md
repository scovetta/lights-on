# Configuration reference

[Protected local execution](local-container.md) adds an operator-owned JSON
policy. Repository settings cannot widen its network, validation or publication
permissions.

[Documentation index](README.md)

The repository configuration is [`.github/lights-on.yml`](../.github/lights-on.yml).
Defaults and environment overrides are implemented in
[`load-config.mjs`](../.github/lights-on/runner/load-config.mjs).

## Loading and syntax

The loader applies configuration in this order:

1. Built-in defaults.
2. The repository YAML file, merged into those defaults.
3. Supported process environment overrides.

Missing keys retain defaults. An array replaces the default array without
merging its items. The loader may accept unknown keys, so inspect its JSON
output after editing.

From the repository root:

```powershell
node .github\lights-on\runner\load-config.mjs --json
```

This prints the configuration and selected provider without credentials.
Check authentication with that provider before enabling live work.

### Use the supported YAML subset

The loader supports simple maps, scalars, inline maps and arrays. Avoid anchors,
aliases, multiline scalars and YAML tags; it does not implement full YAML.
It rejects duplicate keys, unsupported indentation, wrongly typed known
settings and invalid boolean/numeric environment overrides. Double-quoted
strings use JSON-style escapes; single quotes use doubled quotes for literals.
An explicit configuration path must exist and be readable.

For a list of objects, use inline maps:

```yaml
autonomy:
  required_checks:
    - { context: "test (24)", app_id: 15368 }
```

For a larger object, put the hyphen on its own line:

```yaml
dependencies:
  approved_migrations:
    -
      id: example
      name: old-helper
      ecosystem: npm
      manifest: package.json
      replacement: { name: stdlib }
      plan: "Replace the internal helper without changing public exports."
      allowed_files: [package.json, package-lock.json, src/helper.js]
      validation_commands: ["npm ci --offline --ignore-scripts && npm test"]
```

Adapt this syntax example before approving a migration. Execution also needs the
[replacement-resolution artifact](maintenance.md#migration-execution).
For object lists, keep the hyphen on its own line. The loader rejects
`- context: ...` followed by indented properties rather than silently ignoring fields.

## Provider routing

| Setting | Default | Effect |
|---|---|---|
| `version` | `1` | Configuration format marker. |
| `enabled` | `true` | Controller-level enable switch; evaluated after a runner starts. |
| `engine.provider` | `auto` | Select a provider or use credential discovery. |
| `engine.copilot_backend` | `cli` | Set `sdk` to opt into the pinned SDK-managed stdio runtime. Other providers are unchanged. |
| `engine.models.default` | `""` | Empty selects that provider's default model. |
| `engine.models.reasoning` | `""` | Empty selects that provider's high-capability model. `reasoning` is the current configuration spelling. |
| `engine.fallback_providers` | `[]` | An explicit fallback list; with an empty list, routing can derive alternatives from available credentials. Dependency tasks do not use fallbacks. |

Auto-discovery order is Copilot, Claude, Codex, then OpenRouter.

Use the default tier for routine work and the high-capability tier for harder
analysis, migrations or reviews. The high-capability tier uses the key
`reasoning`: write `tier: reasoning`, `--tier reasoning` or
`engine.models.reasoning` in configuration. This chooses a model tier rather
than toggling reasoning on or off; `high-capability` is not a supported alias.

| Provider | Secret | Default model | High-capability model (`reasoning`) |
|---|---|---|---|
| `copilot` | `COPILOT_GITHUB_TOKEN` | `claude-sonnet-5.5` | `claude-opus-5.5` |
| `claude` | `ANTHROPIC_API_KEY` | `claude-sonnet-5-5` | `claude-opus-5-5` |
| `codex` | `OPENAI_API_KEY` | `gpt-6.1-sol` | `gpt-6-astra` |
| `openrouter` | `OPENROUTER_API_KEY` | `anthropic/claude-sonnet-5.5` | `anthropic/claude-opus-5.5` |

These are the shipped model identifiers. Check access with your provider
account, including any model override.

Without a model override, an explicit provider selects its own model defaults.
Configured or CLI model overrides still take precedence. A fallback
uses its own provider defaults rather than inheriting a custom primary model
name, which may not exist in the fallback API. `GITHUB_TOKEN` alone does not
configure Copilot; supply `COPILOT_GITHUB_TOKEN`.

### Copilot CLI preparation

Actions installs CLI 1.0.98 and its dependencies from an integrity-bearing
lockfile outside the checkout, using the configured npm registry and disabling
install scripts. `LIGHTS_ON_COPILOT_CLI_DIR` selects that prepared installation;
an invalid directory/version fails rather than falling back to another binary.
Standalone use without that setting retains the existing `copilot` PATH lookup.
Prefer the [locked CLI preparer](development.md#run-the-tests) for development.
The protected local controller image already uses a lockfile.

### Copilot SDK backend

Set `engine.copilot_backend: sdk` to use SDK 1.0.22. Actions prepares its pinned
dependencies outside the checkout through the configured npm registry, with
install scripts disabled. The optional local controller image includes both
backends. No dependency is added to the maintained project's package manifest.

The SDK manages a bundled CLI subprocess, not an in-process runtime. Each
provider attempt reuses one process, with a fresh inference-only session per
tool selection. The existing controller owns tools, `finish_task`, limits,
validation and publication. Built-in tools, MCPs, configuration discovery,
skills, memory and compaction are disabled. Unexpected native tool use or
additional model calls fail the attempt. A timeout aborts work; shutdown
completes before a candidate can be exported.

`LIGHTS_ON_COPILOT_BACKEND` overrides the YAML setting. For development,
`LIGHTS_ON_COPILOT_SDK_DIR` must point to a prepared, trusted tooling directory;
see [SDK preparation](development.md#copilot-sdk-preparation). It is set by the
Actions installer and local controller image. Missing packages or SDK failures
never silently switch to the CLI, though the configured provider fallback policy
still applies. The CLI remains the rollout default pending live-account comparisons.
SDK cleanup failures stop the run rather than starting another provider.

## Paid event admission

`events.allow_external_triggers` defaults to **`false`**. Ordinary external
issues/comments and external PR activity do not start paid inference without
maintainer authorization. Maintainer-authored events and recognized bot PRs
remain eligible. Apply `lights-on:actionable` or `lights-on:migrate-dep` to an
issue, or `lights-on:re-review` to an external PR, to authorize its lane.
Non-maintainer comments cannot authorize themselves. Manual dispatch and
scheduled work remain available.

Set this option to `true` only if unattended responses to all public activity
are worth the spending exposure. Rate, size and execution limits still apply.

## Merge policy

| Setting | Default | Effect |
|---|---|---|
| `autonomy.mode` | `lights-on` | Any other mode, including `review-only`, blocks automatic merging. It does not disable proposals. |
| `autonomy.allow_external_pr_automerge` | `false` | External PRs require an explicit opt-in or manual merge. |
| `autonomy.allow_agent_pr_automerge` | `true` | Allows recognized bot PRs through the author-category gate. |
| `autonomy.merge_method` | `squash` | Automated `squash`/`merge` use controlled messages. `rebase` is rejected by the reference-isolation gate. |
| `autonomy.require_ci_pass` | `true` | Require the CI evaluator to return success. Keep enabled. |
| `autonomy.required_checks` | `[]` | Exact required contexts and publishing App IDs. Empty blocks ordinary CI-qualified auto-merge. |
| `autonomy.require_independent_agent_review` | `true` | Require independent review evidence. Keep enabled. |

Auto-merge still requires the applicable gates. The evaluator has no general
risk-tier classifier or `cooldown_hours` merge delay.

### Required CI checks

```yaml
autonomy:
  required_checks:
    - { context: "test (24)", app_id: 15368 }
    - { context: "commitlint", app_id: 15368 }
```

- **`context`** is an individual check's exact name. `Test` might be a workflow
  containing checks named `test (22)` and `test (24)`.
- **`app_id`** identifies the GitHub App publishing the check. It is a public
  identifier, separate from repository and workflow-run IDs.
- **`app_id: null`** selects a legacy commit-status context. It is not a wildcard
  for checks from arbitrary apps.

Inspect the current PR head's checks with this read-only command:

```powershell
gh api repos/OWNER/REPO/commits/HEAD_SHA/check-runs --paginate --jq '.check_runs[] | {name, app_id: .app.id, conclusion}'
```

All configured checks must succeed. Current observed failures or pending checks
also block the gate; skipped and neutral check conclusions do not count as
success. The gate's own check is excluded to avoid waiting on itself.

The `workflow_run.workflows` list in `lights-on-pr.yml` is separate configuration.
Its shipped workflow names are `CI`, `Lights On - Self Test CI`, `Test`, and
`Lint Commits`. Adjust it for your target's workflow names.

### Discover required checks

From the installed target checkout, preview an explicit policy derived from
GitHub's active rulesets and classic branch protection:

```powershell
node .github\lights-on\runner\discover-required-checks.mjs --repo OWNER/REPO --update-workflows
```

Add `--write` to apply the displayed changes locally. This fills an empty
`autonomy.required_checks` list and, with `--update-workflows`, adds discovered
workflow names without removing existing triggers. It never commits, pushes,
changes branch protection or overwrites a different explicit check list.
`--branch NAME` selects the intended merge-target branch; the default is the
repository's default branch. The current single list cannot express different
policies for different target branches.

Alternatively, run **Actions > Lights On - Discover Required CI Checks** after
installation. It prints the proposed diff and uploads configuration files for
review. Extract the artifact under `.github` (its root contains `lights-on.yml`
and `workflows/lights-on-pr.yml`), review the files and commit them yourself. This workflow
has read-only repository permissions and never opens or merges a policy PR.

Discovery uses exact context/App identities from enforced policy. For unbound
contexts, it inspects check runs and legacy statuses on the five latest target
branch commits, not open PRs. Failed or currently absent requirements are not
discarded. Multiple publishers, missing evidence, permission failures and
incomplete responses block automatic application. GitHub's unbound/any-app
policy does not mean `app_id: null`; that value is emitted only when trusted
history identifies a legacy status.

Without enforced requirements, the helper prints observed candidates and exits
nonzero without editing files. Review which candidates validate PRs; scheduled,
release and optional checks are not automatically required. PR-only checks may
also lack workflow-name evidence on the target branch. Warnings identify
unresolved trigger mappings and server-side rules not represented by this list.
Non-Actions checks and legacy statuses do not emit `workflow_run` events. Their
completion may need a manual PR-gate dispatch if no watched Actions workflow
finishes afterward.

The ordinary Actions token may not be able to read classic branch protection.
Use local `gh` authentication with the required read access, or an optional
`LIGHTS_ON_SETUP_TOKEN` secret scoped to this repository with Administration,
Contents, Checks, Commit statuses and Actions **read** permissions. No administration-write
permission is needed. An API error is never treated as an empty policy.

Rerunning discovery detects differences but refuses to replace an existing
explicit list. Review policy drift separately; never remove a check merely
because it stopped reporting.

## Dependency work

| Setting | Default | Effect |
|---|---|---|
| `dependencies.update_max_turns` | `8` | Routine update task limit. |
| `dependencies.migration_plan_max_turns` | `12` | Read-only migration planning limit. |
| `dependencies.migration_max_turns` | `20` | Approved migration execution limit. |
| `dependencies.validation_commands` | `[]` | Extra trusted offline commands after routine npm validation. |
| `dependencies.approved_migrations` | `[]` | Reviewed plans eligible for separate manual execution. |

`limits.max_turns_per_run` also caps task limits. Use positive turn
limits; zero-valued per-run limits are not a substitute for disabling automation.
Review migration plans as code: they authorize file changes and validation
commands. Issue text cannot grant that permission.

## Toolchain maintenance

```yaml
toolchains:
  enabled: false
  node:
    support_policy: supported
    update_ci: true
    update_runtime_files: true
    build_files: []
```

| Setting | Meaning |
|---|---|
| `enabled` | Opt into the separate Node lifecycle proposal step. Default is off. |
| `support_policy: supported` | Retain current, active-LTS, and maintenance releases; retire EOL releases. |
| `support_policy: active-lts` | Retain only active LTS among known, already-released versions. |
| `update_ci` | Inspect supported Node matrices and fixed setup-node inputs in non-Lights-On workflows. |
| `update_runtime_files` | Inspect `.nvmrc`, `.node-version`, and Node entries in `.tool-versions`. |
| `build_files` | Explicit `.sh`, `.ps1`, and Dockerfile paths. No arbitrary glob expansion. |

The updater handles supported literal major-version forms and puts proposals
on hold for review. It leaves the public runtime contract unchanged.

## Usage and rate limits

| Key under `limits` | Default | Scope |
|---|---|---|
| `max_agent_runs_per_day` | `25` | Recorded runs over the previous 24 hours. |
| `max_issue_responses_per_hour` | `10` | Recorded `issue-responder` runs over the previous hour. |
| `max_attempts_per_issue` | `2` | Recorded attempts when an item key is available. |
| `max_turns_per_run` | `25` | Tool-loop turns per provider attempt. |
| `max_tokens_per_run` | `100000` | Known token subtotal shared across provider fallbacks and checked between tool-loop turns. |
| `max_cost_per_run_usd` | `2.0` | Known/estimated USD cost shared across provider fallbacks and checked between turns. |
| `max_daily_budget_usd` | `10.0` | Recorded known USD subtotal over the previous 24 hours. |
| `max_prs_per_run` | `2` | Parsed, but not enforced as a shared scheduled-publication limit. |
| `max_input_bytes` | `262144` | Maximum event/context, assembled prompt and serialized inference-request size; oversized input fails before inference. |
| `max_output_tokens` | `8192` | API output-token request limit. Copilot has a bounded captured-output size, not a guaranteed billed-token limit. |
| `max_model_calls_per_run` | `30` | Shared limit across tool turns, provider fallbacks, and Copilot format retries. |

Use provider-side spending limits alongside these controls. Copilot's dollar
cost is unavailable, and retries, partial reports or lost cache state can leave
gaps in accounting. See [usage accounting](operations.md#usage-and-cost).

Exhausting a turn, token or known-cost limit before `finish_task` is an execution
failure. The runner records `status: failed`, discards partial candidates and
exits nonzero. Inspect `execution.stop_reason`, `execution.turns_used` and
`execution.limits` for the cause. Completion requires a finishing tool call.
After a provider fallback, `execution.attempt_limits` records the remaining
token/USD allowance used for that attempt. The documented turn allowance stays
per provider attempt; the model-call cap is shared.

The default remains 25 turns. Increasing `max_turns_per_run` does not raise the
token, USD or shared model-call caps, and dependency-specific turn limits still
apply. General tasks honor larger configured turn limits. Tune the limit that
stopped useful work. One tool-loop turn
can include multiple provider calls for format retries, and token totals can
include the same context sent with successive requests.

Per-run turn/token limits must be positive integers, and the per-run USD
allocation must be positive. Invalid values fail before inference instead of
falling back to defaults. Use `enabled: false` to disable execution.

Before inference, the runner reserves one run/attempt and a per-run USD
allocation under a file lock. It replaces the reservation with known usage on
completion. Unknown or interrupted USD usage keeps the allocation for 24 hours.
Do not use that reserved amount as a measurement of Copilot charges.
The three agent-bearing workflows share a concurrency group and the same
state-cache prefix, with explicit cache saving after failed inference.
Custom workflows must preserve that coordination or provide stronger shared
admission control.

## Upstream, threat model, and dependency-health settings

| Setting | Default | Current behavior |
|---|---|---|
| `upstream.repo` | `auto` | Discover a fork parent, use `owner/repo`, or disable with `none`. |
| `upstream.sync_issues` | `true` | Enable issue mirroring in the upstream selector. |
| `upstream.sync_prs` | `false` | Enable PR-to-local-issue mirroring. |
| `upstream.max_items_per_run` | `3` | Nonnegative integer cap on new mirrors; `0` selects none. |
| `policies.dependency_health.stale_release_months` | `24` | Age threshold used by health evaluation. |
| `policies.dependency_health.min_maintainers` | `1` | Health flag uses a count less than or equal to this threshold. |

Settings with limited runtime support:

- `upstream.sync_threat_model_context` is parsed/exported, but does not
  suppress the upstream context fetch.
- `threat_model.path`, `generator_repo`, and `triage_policy` describe configuration
  intent. The standard prompt/bootstrap path still uses `THREAT_MODEL.md`
  and the built-in generator source, regardless of those settings.
- `policies.block_automerge_on` lists intended policies; the merge evaluator has
  specific hard-coded checks rather than interpreting that list.
- The two `auto_migrate_*` health flags do not authorize migration execution.
  Approved plans and the manual migration task control that operation.

## Release settings

| Key under `release` | Default | Effect |
|---|---|---|
| `enabled` | `true` | Enable release preparation/publishing paths. |
| `auto_publish` | `true` | Enable registry builds/uploads; not a general tag/PR disable switch. |
| `max_auto_bump` | `minor` | `patch` or `minor`; autonomous major bumps are blocked. |
| `min_commits_for_release` | `1` | Minimum releasable commit count. |
| `immediate_on_security` | `true` | Allow recognized security fixes to bypass that minimum. |
| `create_github_release` | `true` | Create a GitHub Release in addition to its tag. |
| `provenance` | `true` | Request npm provenance in publish plans and live uploads when an OIDC identity is available. In Actions, enables OIDC permission for npm even when `NPM_TOKEN` is set. |
| `package_names` | `{}` | Optional explicit expected package names per registry, read only from the trusted release checkout. Needed for dynamic package-name definitions. |

Example for a Python project whose name is determined by `setup.py`:

```yaml
release:
  package_names:
    pypi: [my-project]
```

Without an override, the inspector reads static names from trusted manifests.
It checks the distribution's internal name/version against those names and the
release version. Hashes and filenames cannot establish that identity.
See [releases](releases.md) for build isolation and upload checks.

## Repository variables versus environment overrides

GitHub does not expose repository variables as process environment variables
by default. The shipped workflows map these names:

| Repository variable | Where it applies |
|---|---|
| `LIGHTS_ON_ENABLED` | New-job enable checks and configuration loading. Use literal `false` for job-level disabling. |
| `LIGHTS_ON_ALLOW_EXTERNAL_PR_AUTOMERGE` | External-PR merge policy. |
| `LIGHTS_ON_UPSTREAM_REPO` | Scheduled upstream discovery/sync. |
| `LIGHTS_ON_SANDBOX_IMAGE` | Composite action's `sandbox_image` input. |
| `LIGHTS_ON_RELEASE_ENABLED` | Release workflow; also use YAML to disable scheduled preparation. |
| `LIGHTS_ON_AUTO_PUBLISH` | Release workflow's package build/upload decision. |

For model routing, most limits, merge method, upstream sub-options, and maximum
version bump, use YAML in an unmodified installation. The loader supports
additional process overrides for local/custom workflows, such as
`LIGHTS_ON_PROVIDER`, `LIGHTS_ON_MODEL`, `LIGHTS_ON_REASONING_MODEL`,
`LIGHTS_ON_MODE`, and the `LIGHTS_ON_MAX_*` limit variables. A custom workflow
must map desired `vars.*` values into the relevant steps.

Composite action manifests cannot read `vars` directly. A caller can pass:

```yaml
with:
  sandbox_image: ${{ vars.LIGHTS_ON_SANDBOX_IMAGE }}
```

An empty image input uses the digest-pinned default.
