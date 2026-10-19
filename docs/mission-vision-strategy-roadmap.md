# Mission, vision, strategy and roadmap

[Documentation index](README.md)

This proposed plan reflects the checkout on 2026-10-18. The roadmap sets
acceptance criteria for future work; it makes no delivery-date, staffing or
funding commitments. The 100-project evaluation has not run.

## Mission

Help maintainers keep stable open-source projects working when they have little
time for routine maintenance.

Lights On handles issue responses, dependency work, security fixes, documentation
and PR review within the project's existing purpose. Compatibility matters:
users and dependent packages should not need to change their code because a
maintenance agent chose to redesign an API.

An adopter must set the scope, credentials and validation policy. Tasks beyond
that authority should stop with an explanation, even if nobody is available to
approve the next step. That lets routine work continue without granting the
agent control over product direction.

## Vision

A maintainer or authorized fork steward can install Lights On, choose a provider,
configure CI and leave routine maintenance running with little intervention.

You should be able to inspect a run and see what the agent attempted, which
checks passed, what it published and what still needs a decision. Failed or
interrupted runs should give you enough information to recover without repeating
a release or opening duplicate PRs.

We want to reduce the time you spend maintaining a project while preserving its
intended use and security contract. The software will still need an owner who
can set policy and handle exceptions. Tests and model reviews can miss defects.

## Scope and non-goals

Lights On targets mature projects and authorized maintenance forks. Before
enabling a task, establish its intended-use/security contract and enough
reproducible checks to assess the proposed changes.

| Work | Required boundary |
|---|---|
| Issue responses and documentation | Use repository evidence; ask for missing information rather than inventing policy. |
| Dependencies | Check advisories, maintenance health and downstream use. Require approval for migrations. |
| Security fixes and PR review | Apply the threat model, compatibility requirements and configured CI checks. |
| Upstream maintenance | Read upstream context; write only to the installed repository. |
| Releases | Authorize proposal publication, merging, releases and registry uploads as separate operations. |
| Execution | Keep Actions as the primary deployment and protected Linux/WSL containers as an optional local mode. |

Open-ended feature work, product redesign and unapproved breaking changes fall
outside this scope. Lights On does not import every upstream event or reproduce
arbitrary Actions workflows. GitHub Enterprise, privileged local workloads and
non-Linux local workers remain unsupported.

The [threat model](../THREAT_MODEL.md) defines the security contract. This
document grants no permissions and does not change repository policy. Resolve
any disagreement between that contract, the guides and the implementation
before enabling the affected operation.

## Present capabilities and limits

The implementation supports the following work. We have not yet measured its
effectiveness across a representative set of projects.

| Area | Available now | Limits to plan around |
|---|---|---|
| Adoption and providers | Installable Actions workflows with Copilot, Claude, Codex and OpenRouter adapters. | You must configure account/model access, CI and offline tools. Bot-token event chaining needs verification. |
| Issues, security and docs | Event and scheduled agents prepare responses or candidate changes. Publishers report confirmed outcomes. | External paid events need maintainer authorization by default. General agents do not use the routine dependency validator. |
| Dependencies | Multi-ecosystem scanning, routine npm updates, read-only migration plans and approved migration execution. | Routine updates require eligible npm `package-lock.json` v2/v3, a test script, a stable patch/minor target and offline caches. Workspaces and competing lockfiles block that path. Other ecosystems have different scan, migration and packaging coverage. |
| Toolchains | Opt-in Node lifecycle proposals. | The updater handles supported literal declarations, keeps a review hold, and leaves public runtime policy and required checks unchanged. |
| Reviews and merges | Commit-bound review with file, author, policy and current-CI checks. | Configure required check identities. Some compatibility decisions depend on the model. External PR auto-merge is off by default. |
| Upstream and releases | Upstream snapshots/local tracking, release PRs and separate build/upload jobs. | Upstream is read-only. Recovery is partial, packaging layouts vary, and one registry upload can succeed while another fails. |
| Protected local runs | Default-deny audited network access, pinned CI images, loopback test services and per-operation grants. | Remote CI, host image acquisition and host/daemon integrity fall outside local confinement. Local and Actions budgets are separate. |
| Reporting and limits | Usage reservations and failed-run token/cost/turn diagnostics. | Copilot USD cost is unknown. Cache-based quotas do not provide a hard global bill. The turn default remains 25. |

See [maintenance](maintenance.md), [architecture](architecture.md) and
[configuration](configuration.md) for task behavior. The [operations guide](operations.md)
covers recovery; [releases](releases.md) and
[local execution](local-container.md) describe their extra prerequisites.

## Strategy

### Make adoption easier

Keep Actions as the default deployment and maintain the same tool/result
contracts for all four providers. Spend setup effort on useful diagnostics:
missing caches, unavailable model access, mismatched CI names and suppressed
follow-on events.

Start installations with `autonomy.mode: review-only` and `release.enabled: false`.
Review-only permits comments and candidate PRs but blocks merges. Before
enabling unattended work, configure required check contexts/App IDs, branch
protection, offline worker images and provider-side spending controls.

Measure time to a useful, verified maintenance result. An installed workflow
that cannot run the project's tests still needs setup work.

### Preserve the project's contract

Use intended use, threat-model obligations and known downstream consumers to
choose work. Dependency metadata can help identify risk; it does not test
compatibility for those consumers.

Keep routine updates narrow. Require separate approval for replacements,
coverage changes and threat-model edits. Consider an update or removal before
adding a replacement dependency.

Add ecosystem support after implementing its native lockfile/resolution checks,
offline tests and rejection cases. Scanning another manifest format does not
establish safe update support for that ecosystem.

### Keep authorization in the controller

Separate inference, untrusted commands and credentialed publication. Check
candidate files before export. Require independent review and CI before a
merge, and keep release permissions separate.

The agent cannot approve changes to its own policy, tests, network exceptions
or required checks. Build/test workers remain offline and credential-free.
GitHub writes target the installed repository; upstream access stays read-only.
Better model results do not justify removing these controls.

### Reduce wasted work

Keep tasks and context small enough to finish within their budgets. Use the
recorded stop reason before changing a limit: token exhaustion does not call
for more turns. Keep 25 as the turn default unless measured tasks justify a
different value.

Record completed no-ops, policy blockers and execution failures as different
outcomes. Preserve usage from retries and failed calls. Report unknown costs
as unknown and retain provider-side caps.

Prioritize duplicate detection and recovery from partial publication. A blocker
can be the correct response, but it must not count as a completed fix.

### Support local runs without widening permissions

Use the optional Linux/WSL mode for custom tools and offline CI. Share validation
and authorization logic with Actions.

Keep pinned images, default-deny network access and disposable loopback services.
List unsupported cloud, device and platform tests in the result. Remote CI can
satisfy the normal merge policy; it runs outside the local container boundary.

### Evaluate changes against independent criteria

Define expected behavior before asking an agent to generate a patch. Include
failed and rejected work in the evaluation, and report results by provider,
task and ecosystem.

Use those results to improve setup and validation. Leave a task in review-only
or blocked mode if the evidence does not support unattended operation.

## Roadmap

The proposed evaluation covers 100 distinct projects: 10 in the pilot, then 30,
40 and 20 holdouts. A blocked project still counts toward that roster.

Prioritize security boundaries and correct reporting first, then operator effort,
then broader ecosystem coverage. Resolve a boundary defect before advancing
the campaign. These phases do not authorize deployment or increased permissions.

### Phase 1: Prepare the evaluation

Document support by task, ecosystem, provider and execution mode. Check offline
dependencies, CI identities and event chaining before starting model work.
Identify configuration fields that the runtime does not yet enforce.

Each evaluation case needs a source revision, configuration, approved environment
and acceptance criteria written outside the generation agent. Assign coverage
to all four providers and record the cohort split, publication permissions,
operator-effort baseline and stop conditions.

Advance once the cases have those records. Missing prerequisites remain blockers.

### Phase 2: Run the 10-project pilot

Use disposable test repositories and read-only upstream sources. Include
supported tasks and cases that should fail or block. Run protected local
execution as the primary trial environment, with installed Actions comparisons
on a representative subset. Actions remains the product's default deployment.

Measure setup effort, output quality, stale-CI rejection and recovery from
interruptions or duplicate events. Have an evaluator review the outcomes for
all 10 projects, including failed work.

Before expanding, exercise all four providers and resolve known write-boundary,
credential-isolation or unauthorized-publication defects. Confirm destinations
for published items. Set numerical usefulness and effort targets from the pilot
before examining the wider cohorts.

### Phase 3: Add 30 projects

Address the setup, context-budget and validation failures found in the pilot.
Include varied repository layouts and offline toolchains. Add dependency or
packaging support only where the observed need warrants a new verifier.

At this gate, account for 40 projects and report results by provider, task and
support status. Resolve pilot blockers on enabled paths or keep those paths
disabled. New support must pass its positive and negative cases, including
missing caches and changes outside the approved file scope.

### Phase 4: Add 40 projects

Check repeated scheduled work, replaced PR heads, missing usage reports, lost
cache state and partial publication. Include issue/doc quality, security-fix
applicability, upstream duplicate detection, approved migrations and release
artifact preparation.

At 80 projects, retain complete outcome records and evaluator decisions. Enabled
combinations must meet the targets set after the pilot. Disclose unknown costs
and unsupported cases. Freeze the candidate version and acceptance method
before running holdouts.

### Phase 5: Run the 20 holdouts

Run the frozen approach on the reserved projects without tuning against their
results. Publish outcomes for all 100 projects, with per-provider coverage and
an explicit supported, review-only or blocked decision for each tested
combination.

Promote a combination only if it meets the predeclared targets and has no
unresolved observed boundary violations. If a holdout reveals a defect that
requires code changes, retain that failed result and report the retest as new
evidence.

Use the results to choose further ecosystem, state-recovery and release work.
Live registry uploads require a separate authorized assessment.

### Evaluation rules and measures

Use disposable repositories and gate publication during the campaign.
**Do not upload to real registries in the main campaign.** Controlled upload
fixtures establish fixture coverage, not live registry readiness.

| Measure | Record |
|---|---|
| Useful maintenance | Accepted, contract-preserving outcomes divided by predeclared eligible tasks. Keep failures and missing evidence in the denominator; exclude blockers from the fix count. |
| Correct disposition | Accepted, no-op, blocked, escalated or failed outcomes against the expected result. Mandatory negative cases must reject before promotion. |
| Operator effort | Setup time and intervention minutes per accepted task, including median and tail values against a comparable manual baseline. |
| Compatibility | Regressions found by parity/downstream checks and later observation, plus untested consumers and observation limits. |
| Reporting | Evidence for claimed completion, validation, publication and merge; zero observed false-success claims in promoted paths. |
| Resources | Tokens, calls, retries, duration, known/estimated USD and provider-native billing units. Keep unknown Copilot USD out of price rankings. |
| Recovery and boundaries | Duplicate effects, lost or blocked work, and unauthorized writes, credential access, network access or publication. Any security-boundary failure pauses the entire campaign. |

Disclose exclusions, retries, configuration changes and sample sizes. Keep
blocked or dropped projects in the cohort accounting. Small samples cannot
establish population-wide reliability or prove security.

## Updating this plan

Review the plan after an evaluation gate or a change to the security contract,
provider integration or execution environment. Link implementation and evidence
before describing a roadmap item as available.

Keep configuration and recovery instructions in the existing guides so adopters
have one place to find the steps.
