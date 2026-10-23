# Operations and troubleshooting

For the optional protected local launcher, see its
[results, state and recovery guide](local-container.md#results-state-and-recovery).
The workflows and controls below continue to apply to GitHub Actions.

[Documentation index](README.md)

Start with the run's Summary and step logs. Before retrying, check whether the
run pushed a branch, created a PR or published a package.

Unapproved external issue/comment/PR events skip paid
inference. Use a maintainer comment, the appropriate actionable/migration/
re-review label, or manual dispatch. To enable unattended paid
responses to all external events, set `events.allow_external_triggers: true`
and retain provider-side spending limits.

## Stop new work

Set the repository variable **`LIGHTS_ON_ENABLED=false`**. Use that literal
spelling for the job-level check.

This skips new Lights On jobs before their runners start. Cancel active jobs
in GitHub Actions. The runner reads YAML `enabled: false` after checkout and
configuration loading, so that setting cannot prevent startup.
There is no separate global `LIGHTS_ON_PAUSED` variable.

The Lights On self-test `ci.yml` and website deployment `pages.yml` are independent
of this switch. All `lights-on-*.yml` jobs also exclude `scovetta/lights-on`
unconditionally: they are templates for other repositories, not self-maintenance
for the Lights On source repository. Matching events can still appear as skipped
workflow runs; no Lights On job starts.

## Read run outcomes

Generated code PRs retain the agent's explanation, source citations when supplied,
changed files, risk assessment and available controller validation. Agent claims
are labelled separately from independent checks; no recorded validation is
reported as unknown, not passed. Commit bodies contain a shorter summary,
rationale, file list and validation status; the full report and run metadata
stay in the PR. Automatic squash/merge messages retain a bounded excerpt of the
PR description for the exact reviewed head.

Issue comments, reviews, PR descriptions and release notes render a restricted
Markdown subset: headings, lists, emphasis, blockquotes, and code. URLs, links,
mentions, issue references, raw HTML and state markers remain literal code,
not active references. Fenced code always uses `text`: Mermaid, math, maps and
other GitHub enrichments are not enabled. Tables and other unsupported markup
are displayed as text. Existing published bodies are not rewritten automatically.

Commit bodies preserve paragraph breaks, neutralize reference/mention syntax,
and wrap lines at 72 characters after sanitization, including long tokens.

| Report | What it means |
|---|---|
| Agent task completed | Candidate generation finished. It does not mean a PR exists. |
| Agent task failed | A limit or provider error stopped execution. The step exits nonzero and discards unfinished candidates. |
| Pull request created | GitHub confirmed the PR; follow the number/URL. |
| Existing pull request reused | The publisher found the matching open PR. |
| Publication skipped | The executed publisher had no eligible changes or permission to publish code. |
| Dependency update blocked | Verification was incomplete/failed; a tracking issue may explain the missing evidence. |
| PR eligible for auto-merge | The gate allowed merging; this is not confirmation of a merge. |
| PR merged | The merge step observed merged state. |
| Error annotation | The operation failed. Earlier successful side effects may still exist. |

PR summaries include title, URL, head/base branches, repository, and labels.
Annotations and summaries escape untrusted text and redact recognized
credentials. Reporting uses stderr so JSON stdout can still feed later steps.

GitHub shows steps excluded by workflow conditions as skipped. Those steps have
no publication result.

### An agent hit a limit

Check `execution.stop_reason` (`max_turns`, `max_tokens`, or `max_cost`) and the
recorded limits before changing the budget. Older versions returned `status: completed` and
`max_turns_reached: true` for token/cost exhaustion too, leaving Actions green.
Update the runner and composite action to get accurate failure propagation.

For example, five Copilot invocations totaling 130,820 tokens exceed the default
100,000-token budget even though the turn limit is 25. Increasing turns alone
cannot fix that case. Reduce unnecessary context or adjust the
relevant budget after checking usage and provider-side spending controls.
Token/cost checks occur between turns, so a single response can take usage above
the threshold; these are not hard provider-side billing caps.
Fallback providers receive only the remaining token and USD allowance, not a
fresh allocation. Failed-provider usage remains part of the run total.

A completed review can reject a PR, and a completed assessment can report a
dependency blocker. Those outcomes differ from an agent that ran out of budget.
Read the reason before deciding whether another inference attempt would help.

## A PR has green CI but did not merge

Work through these checks in order:

1. Find a `Lights On - PR Review & Auto-Merge Gatekeeper` run for the current head.
2. Read the configuration on the default branch. The gate may ignore a setting
   changed only in the candidate branch.
3. Populate `autonomy.required_checks`; an empty list blocks the normal CI gate.
4. Match workflow names in `workflow_run.workflows` and check names/App IDs in
   `required_checks`.
5. Inspect the structured review result for `APPROVE` and four passing gates.
6. Read `reasons` in the merge report for policy blocks.
7. Check GitHub's response. Branch protection, required approvals, conflicts or
   a changed head can block a merge after the controller permits it.

Useful read-only commands:

```powershell
gh pr view 17 --repo OWNER/REPO --json url,headRefOid,labels,statusCheckRollup,reviewDecision,mergeStateStatus
gh run list --repo OWNER/REPO --workflow lights-on-pr.yml --limit 10
gh run view RUN_ID --repo OWNER/REPO --log-failed
```

Replace the PR/run IDs and repository.

For an open PR, run the gate from the default branch with `pr_number`:

```powershell
gh workflow run lights-on-pr.yml --repo OWNER/REPO --ref main -f pr_number=17
```

This starts a remote workflow and can merge the PR if the configured conditions
pass. It does not bypass the gates.

### Common gate reasons

| Reason | Appropriate response |
|---|---|
| `missing-or-invalid-pr-metadata` | Recollect current PR data. Large/capped/inconsistent inventories need manual handling. |
| `ci-not-passing` | Check required names/App IDs and every current check/status; do not turn off CI to fix this. |
| `review-missing` / `review-not-approved` | Inspect the agent result and review publisher. |
| `review-not-completed` | Obtain a completed live review; dry-run, skipped and failed results cannot authorize a merge. |
| `draft-pr` | The author or maintainer must mark the PR ready. Automation preserves draft intent. |
| `gate-failed:...` | Address the specific review requirement. |
| `protected-path-modified` | Review the automation/security-contract change; use a deliberate maintainer override or manual merge. |
| `breaking-api-change` | Review compatibility; a routine maintenance bump is not authorization for breakage. |
| `held-by-label` | A maintainer must decide whether to remove the hold. |
| `external-pr-automerge-disabled` | Expected default for external authors; other gates may fail too. |

## A branch was pushed but no PR appeared

The branch can exist even when label setup or PR creation failed. Look for
the **PR publication failed** annotation and the branch name.

The publisher creates required labels and reuses matching open PRs.
After updating an older installation, recover the existing branch without
rerunning the agent:

```powershell
$env:GITHUB_REPOSITORY = "OWNER/REPO"
node .github\lights-on\runner\publish-pr.mjs `
  --head lights-on/EXISTING-BRANCH `
  --base main `
  --title "chore(deps): recover dependency proposal" `
  --body "Publish the previously pushed candidate for review." `
  --label lights-on:dependencies
```

This helper writes to GitHub using your authenticated `gh`
environment. Check the repository/head/base first. It can also reuse an
already-open PR; it does not regenerate or test the branch.

## Known setup and inference failures

| Symptom | Meaning and next step |
|---|---|
| `Unrecognized named-value: 'vars'` in the composite action | An older action references a workflow-only context. Update both action and caller workflows; pass `sandbox_image` as an input. |
| `Invalid --deny-tool ... *` | Older adapter flags are incompatible with pinned Copilot 1.0.98. Update the adapter; do not enable all tools. |
| `Unexpected token '<'` / XML `<invoke>` output | Copilot returned the wrong envelope. The current adapter performs bounded JSON format retries. Repeated failures remain errors. |
| `Copilot inference failed (exit ...)` | Read the redacted diagnostic: authentication, model access, CLI version, or network may be the cause. |
| `Context file is missing ... lights-on-upstream-context.json` | Update the installed scheduled workflow and upstream runner together. Callers use `steps.upstream-sync.outputs.context_file`; when no upstream is selected, sync also writes an explicit skipped snapshot for older fixed-path callers. Discovery/fetch failures still fail the step. |
| `Threat-model skill cache is incomplete` | Inspect and rebuild the cached skill checkout. Bootstrap tasks, including `/lights-on update-threat-model`, prepare the skill automatically; an incomplete cache is rejected before inference. |
| `Expected agent ... result file is missing` | A producing step did not deliver its promised result. Inspect that step and update the composite action and workflows together. Disabled runs write a structured skipped result; genuinely missing results are errors, not successful skips. |
| `could not add label ... not found` | Update the label/publisher helpers and confirm the workflow has issue/PR write permission. |
| `NativeCommandError` from PowerShell installer | Older Windows PowerShell handling treated native stderr as fatal. Use the current installer; exit codes still determine actual failure. |
| Docker unavailable / offline install fails | Supply Docker and a suitable reviewed worker image/cache. There is no host-shell or online-worker fallback. |
| Stale review refused | The PR head changed/closed during review. Request a new review for the current head; do not reuse the old verdict. |
| Distribution identity verification failed | Check Python 3.11+, Ruby/Psych for RubyGems, trusted names/version and archive metadata. Dynamic names need `release.package_names`. Do not bypass identity checking. |
| `daily-budget-reservation-exceeded` | The next per-run allocation would exceed today's recorded/reserved budget. Inspect usage and outstanding reservations. |
| Usage state locked/invalid | Inspect an interrupted process or corrupt state before clearing it. The controller blocks new reservations rather than resetting accounting. |
| `cache write denied: token has no writable scopes` | The runtime cache token is read-only, independently of `GITHUB_TOKEN` permissions. Update the cache-access action, composite action and caller workflows together. Read-only runs restore state but skip saves; adding `actions: write` is not the fix. |

Copilot 1.0.98 treats an empty tool allowlist as no filter. The adapter uses an
unmatched, nonempty name and tests the exposed tool list. Keep that filter and
the other isolation flags in place when diagnosing startup failures.

When updating an installation, refresh the workflows, composite action and runner
scripts together. Start a new run from the updated commit: rerunning an old
Actions run uses its original workflow revision. Scheduled source publishers
require a completed result from their own agent; skipped work does not authorize
publication of unrelated working-tree changes.

## Dependency work was blocked

Read the selection or validation reason alongside the model summary.

- **Missing registry/advisory evidence:** rerun the scan when its services are
  available. An empty fallback is not proof of no vulnerabilities.
- **Open PR already modifies the manifest:** resolve that proposal before
  starting another, including security work from Step C.
- **Unsupported lockfile/ecosystem/range:** use a reviewed migration plan or
  manual maintenance. A manifest-only change is not a substitute.
- **`routine-update-requires-package-lock-v2-or-v3`:** older installations
  required a committed npm lockfile. Update the dependency runners and prompt
  together to allow manifest-only proposals with a temporary offline validation
  lock. Existing locks must still be supported and updated.
- **Deferred major/security updates:** `deferred` is routing information, not
  an execution failure. Run `migration-plan` for major-upgrade/replacement
  analysis and `security` for the security-remediation lane. Deferred items
  were not updated by the routine dependency task.
- **Offline package missing:** rebuild the trusted worker cache for the exact
  candidate graph. Lockfile-free updates also need cached registry metadata to
  generate the temporary lock; lack of network access is intentional.
- **Validation changed source:** investigate generators or scripts that rewrite
  the candidate during tests.
- **Cooldown/attempt limit:** inspect the tracking issue and state. Do not
  delete accounting to bypass the attempt limit.

The `force` input on the scheduled workflow is not connected to the
runner's force override.

## Usage and cost

Copilot's private CLI usage file or SDK metrics supply session token totals and billing counters.
The adapter counts each invocation once, including format retries and observed
failed calls. It does not sum overlapping per-agent/provider representations.

| Output field | Interpretation |
|---|---|
| `total_tokens` | Complete reported total, or `null` if some usage is unknown. |
| `known_total_tokens` | Available subtotal; not an estimate of missing tokens. |
| `tokens_status` | `reported`, `partial`, or `unavailable`. |
| `cost_usd` | Reported/estimated dollar total, or `null` when unavailable/incomplete. |
| `cost_source` | Distinguishes reported, estimated, partial/mixed, and unavailable values. |
| `known_cost_usd` | Available dollar subtotal only. |
| `premium_requests` | Copilot's reported weighted premium-request usage; not USD. |
| `copilot_nano_aiu` | Copilot's reported AI-credit billing quantity, in its original units. |
| `copilot_ai_credits_status` | Copilot's status for that credit reporting. |
| `copilot_cli_invocations` | Direct CLI invocations, including format retries. |
| `copilot_sdk_requests` | SDK selection requests, including format retries; not server-process starts. |
| `copilot_usage_reports` | Requests with usable CLI reports or SDK accounting, out of the sum of the two request counts. |

`cost_usd: null` means the cost is unknown. Copilot reports billing units without
a dollar conversion. Some other providers use the generic $5/million-token
estimate, which the result marks as estimated.
SDK `assistant.usage.cost` is a premium-request multiplier, not a dollar amount.

USD caps can only compare known dollar costs and cannot enforce a Copilot
spending ceiling. Token caps check known usage between tool-loop turns; retries
and the last response can overshoot a threshold. Use service-side budgets,
scoped credentials, and run/turn limits too.

The runner saves available usage to the state file even if all providers fail.
It cannot reconstruct old zero-valued records.

The runner reserves an attempt and per-run budget before inference.
Unknown or interrupted USD usage retains that allocation for the daily window;
the reserved amount still counts against the budget. Reports distinguish known
costs, `reservedDailyBudgetUsd` and `budgetAccountedUsd`. Provider request/output bounds
and `max_model_calls_per_run` also apply across fallback/format retries.

## Cache and recovery

The default state file is `/tmp/lights-on-cache/state.json`. Agent-bearing
workflows share `lights-on-maintenance-budget-<repository>` concurrency and
`lights-on-state-v2-*` caches keyed by run and attempt, saving after failures
only where the runtime grants writes. Scheduled multi-agent runs restore the
cache once; individual agents do not overwrite earlier stages' usage with a
second restore. Restore/save operations use identical state and skill-cache paths.
The runner locks local reservation updates. Cache loss
and GitHub's pending-run queue still prevent durable cross-host accounting or
lossless delivery.

The native cache-access action reads `ACTIONS_CACHE_MODE`, which the runner
supplies to JavaScript actions. On older runners without it, the action assumes
write access only for GitHub's documented trusted default-branch triggers.
Unknown explicit modes fail rather than enabling writes.

GitHub defaults `issues`, `issue_comment`, `pull_request_target` and
`workflow_run` events to read-only access in the default-branch cache scope.
Lights On does not override that protection. The run summary reports whether
restore/save is allowed. **Usage recorded by a read-only run cannot be carried
forward through the cache**, and issue-marker recovery does not reconstruct it.
Use provider-side spending limits; the cached daily ledger is not a hard global
billing limit. See [GitHub's cache-access rules](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#cache-access-for-low-trust-workflow-triggers).

The cache action reports a denied save as a warning, not a failed job. If an
agent also reports `daily-budget-exceeded`, that is a separate admission decision
based on the restored ledger; changing cache permissions does not clear the cap.

State saves write a temporary file and replace the ledger after the write
finishes. A failed write leaves the previous ledger intact; this does not
recover a lost Actions cache or synchronize budgets across hosts.

Recovery reads recognized bookkeeping markers and cooldowns from issues/comments.
The scheduled recovery query reads up to 50 issues and their returned comments.
It cannot reconstruct missing provider usage or the full attempt history.
The PR gate does not reuse recovered comments as approval.

For unknown costs, budget diagnostics show
`costTrackingComplete: false` and `dailySpendUsd: null`, with a known subtotal.
Concurrent runs and cache eviction are additional reasons not to treat these
limits as a hard global bill.

## Maintainer controls

The dispatcher accepts slash commands from recognized owners, members and
collaborators.

| Control | Actual effect |
|---|---|
| `/lights-on fix` | Requests an issue response/fix; issue threads can authorize a code PR, ordinary PR-comment tasks cannot. |
| `/lights-on review` / `re-review` | Adds the re-review request label. |
| `/lights-on automerge` | Adds the author-policy opt-in label. |
| `/lights-on merge` | Adds auto-merge, re-review, and protected/breaking-change override labels; does not directly merge. |
| `/lights-on hold` | Adds a merge hold. |
| `/lights-on pause` | Adds the per-PR pause label, not the global kill switch. |
| `/lights-on ignore` | Adds the opt-out signal; the PR gate blocks review/merge. |
| `/lights-on migrate-dep <package>` | Requests read-only migration planning. |
| `/lights-on update-threat-model` | Requests a threat-model candidate. |
| `/lights-on release` | Requests the release-manager agent; use manual `task: release` for deterministic preparation. |

Bot-applied labels may not produce follow-on workflow events because of GitHub
token event suppression. `lights-on:approved` and `lights-on:needs-human` alone
do not grant or block merging by themselves.

### Label reference

| Label | Effect |
|---|---|
| `lights-on:ignore` | Opts out of agent work and blocks PR review/merge; it does not cancel all event jobs. |
| `lights-on:actionable` | Queues an issue for a fix attempt. The scheduled fetch selects at most five; mirroring and write-mode agents can add it. |
| `lights-on:migrate-dep` | Requests read-only migration planning. Execution needs an approved plan. |
| `lights-on:hold` | Blocks auto-merge while allowing review. |
| `lights-on:automerge` | Opts a PR into the author-policy check; review, CI and other gates still apply. |
| `lights-on:re-review` | Requests review; the workflow removes it after review. Eligible gate runs use fresh reviews. |
| `lights-on:pause` | Blocks PR review/merge until removed. Use the repository variable for a global stop. |
| `lights-on:needs-human` | Requests maintainer attention; this label alone does not prohibit merging. |
| `lights-on:approved-override` | Waives protected-path and reported breaking-API blocks, leaving other gates in place. |
| `lights-on:approved` | Reports passing review gates and selected checks; it does not establish passing CI or authorize merging. |
| `lights-on:changes-requested` | Available for an agent to request with its review; the workflow does not add it for each failure. |
| `lights-on:automerge-disabled-external` | Reports an external-author policy block; other gates may also fail. |
| `lights-on:triaged` | Agent-requested issue classification status. |
| `lights-on:in-progress` | Agent-requested work status, not a live-run indicator. |
| `lights-on:reviewed` | Recommended with `approved` after review gates and selected checks pass. |
| `lights-on:automation` | General automation tag; publisher use varies. |
| `lights-on:release` | Identifies release PRs eligible for the merge-event publisher. |
| `lights-on:agent-pr` | Used by issue-fix and release publishers; the label does not prove authorship. |
| `lights-on:upstream` | Identifies local issues mirrored from a read-only upstream. |
