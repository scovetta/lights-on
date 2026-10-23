# Maintenance workflows

[Documentation index](README.md)

Check the publisher's result for a PR URL and the merge step for confirmation.
An agent step can finish preparing a candidate without publishing it.

## Workflow map

| Workflow | Trigger | Main responsibility |
|---|---|---|
| `lights-on-events.yml` | Selected issue and issue-comment events | Triage, responses, maintainer controls, and candidate issue fixes. |
| `lights-on-schedule.yml` | Daily at 06:00 UTC or manual dispatch | Upstream polling, scans, dependency work, docs, and release preparation. |
| `lights-on-pr.yml` | PR-target events, selected CI completions, manual dispatch | Fresh independent review and deterministic merge gates. |
| `lights-on-release.yml` | Eligible merged release PR or manual dispatch | Validate release metadata, build, tag, and upload packages. |
| `lights-on-setup.yml` | Manual dispatch on the default branch | Discover required CI checks and upload proposed configuration for review; no repository mutations. |

`ci.yml` tests Lights On. The installer leaves it out of target repositories.

### Manual scheduled-maintenance tasks

Select the task in **Actions > Lights On - Scheduled Maintenance > Run workflow**.

| Task | Requested lane |
|---|---|
| `all` | All scheduled lanes; toolchain work still requires opt-in. |
| `bootstrap` | Threat-model generation/update. |
| `upstream` | Upstream polling and actionable-issue processing. |
| `security` | Security-remediation agent. |
| `dependencies` | Routine dependency stages and optional toolchain maintenance. |
| `migration-plan` | Read-only analysis of one unhealthy dependency or deferred major upgrade. |
| `migration` | Execute the `migration_plan` ID from approved configuration, on the default branch only. |
| `toolchains` | Optional Node lifecycle proposals. |
| `docs` | Documentation clarification and actionable-issue processing. |
| `issues` | Documentation/actionable-issue processing. |
| `release` | Deterministic release PR preparation. |

Upstream sync, threat-model checks and the dependency scan can run before the
selected task. A missing model can trigger bootstrap. The workflow does not
map `force` to the runner's `LIGHTS_ON_FORCE` override, so that input does not
bypass caps.

## Scheduled stages

| Stage | Work |
|---|---|
| 0 | Read upstream metadata and create selected local tracking issues. |
| A | Check for the threat model and, when requested/needed, propose it. |
| B | Scan manifests, dependency health/advisories, and downstream metadata. |
| C | Ask the security agent for a remediation candidate. |
| D | Select one routine dependency or a manually selected migration lane. |
| E | Generate the bounded candidate/plan; validate executable candidates before export. |
| F | Publish validated dependency files or track a blocker/plan. |
| G | Propose Node CI/build lifecycle maintenance if enabled. |
| H | Clarify docs and process a bounded set of actionable issues. |
| I | Prepare a release PR from releasable commits. |

Step E has a frozen dependency validator. General security and docs agents do
not use it, even if they change dependencies. Assess their candidates under
their own review and CI requirements.

## Routine dependency updates

Scans deduplicate identical requests within a run and limit concurrent metadata
requests to four. For an OSV batch match, the scanner fetches the full advisory
record, including continuation pages, before deriving a fixed version.
Patch evidence must match the selected package; older SemVer fixes do not
resolve a later affected version. A newer release alone is not evidence that
it fixes the advisory.

Scanning includes npm optional dependencies and literal Python dependency
arrays with extras. Downstream counts remain `null` when lookup evidence is
unavailable; an outage is not evidence that a package has no dependents.

### Selection

Step D uses Step B's report and the current checkout to select work:

- Requires a recent scan and usable registry/advisory evidence.
- Chooses one eligible package using fixed selection rules.
- Skips open PRs touching the same manifest, even if their branch is not a
  Lights On dependency branch.
- Checks lane-specific cooldowns and attempts.
- Defers security bumps to Step C.
- Leaves migration and major-version work out of the routine update task.

The routine verifier supports npm projects with `package-lock.json` v2/v3
**or no committed lockfile**. It still requires a test script and a stable,
compatible target. Workspaces, competing lockfiles, a non-npm `packageManager`,
pre-1.0 minor updates, unsupported ranges and unsupported ecosystems block
candidate generation. An existing invalid/older lockfile is not treated as absent.

Selection records `lockfile.mode: committed` or `temporary`. Without a source
lockfile, the scanner's current version comes from the manifest requirement,
not an observed installed graph. Validation establishes the candidate's exact
resolution; it does not reconstruct historical installations or prove every
future resolution allowed by the published ranges will work.

### Candidate generation

The `dependency-updater` receives the selected package and evidence. It may
change only that package's requirements and existing lockfile, preserving the
requirement style (`^`, `~`, or exact). When the source has no lockfile, the
candidate must change only the manifest. The controller generates a temporary
v3 lock in its independent offline worker; it is never added to the proposal.

The package manager must generate the lockfile; the agent cannot invent hashes
or registry URLs. A missing offline package blocks verification.

### Independent validation

Before candidate files can reach the credentialed checkout, the controller:

1. Confirms the selection still matches the trusted source.
2. Rejects unrelated source, test, script, or manifest changes.
3. Checks manifest/root-lock agreement and the exact locked target. For a
   lockfile-free project, this check follows temporary lock generation below.
4. Queries target-version advisories; lookup failure or a known vulnerability
   blocks this lane.
5. Creates a fresh offline worker from the candidate.
6. If needed, generates a temporary v3 lock with `npm install --package-lock-only
   --lockfile-version=3 --package-lock=true --offline --ignore-scripts --no-audit
   --no-fund`, then verifies it. Runs `npm ci --offline --ignore-scripts
   --no-audit --no-fund` against the verified lock.
7. Checks the installed target package version.
8. Runs the original build/lint/test scripts when present; a test script is
   required.
9. Rejects validation-time modification of candidate source contents or executable bits, including symlink substitution. A generated lock must also remain unchanged during tests.

Add trusted checks through `dependencies.validation_commands`. The controller
records file hashes and command exit codes rather than relying on a model's
claim that tests passed.

An offline worker must contain registry metadata and package archives for the
intended candidate graph. The stock Node worker does not include project
dependencies. Missing inputs still block publication; this change does not
enable network access, run install hooks or add an acquisition service. Prepare
approved inputs using the configured registry/proxyfeed, never a silent public
registry fallback. The npm demo cache covers its prepared graph only and may
not contain metadata or new versions needed for an update.

### Publication

Step F publishes only files matching the controller's verification record. It
creates/reuses a PR with standard labels, or creates/reuses a blocker issue
without publishing code. Planning and validation blockers receive a lane-specific
48-hour cooldown.

The PR still needs independent review and configured CI. Tests can miss
regressions, and advisory databases can miss malicious packages.

## Migration planning

`dependency-migration-planner` is read-only: no shell commands or file writes.
It assesses usage, public API exposure, candidate replacements, missing
evidence, and parity-test requirements.

Use `task: migration-plan` for scan-based planning, or
`/lights-on migrate-dep <package>` on an issue for scoped analysis. The old
`dependency-maintainer` task name is retained as a read-only planning alias.
Neither a model response nor a `lights-on:migrate-dep` label grants code-write
permission for a migration.

Scan-based planning accepts both `migrate` and `evaluate-major-bump` decisions.
The selected `planning_kind` is `replacement` or `major-upgrade`. These are
read-only plans, not automatic upgrades. A same-package major upgrade needs a
separate reviewed implementation PR; the current migration executor only
replaces/removes a dependency and cannot execute that upgrade. Running
`task: dependencies` does not automatically start the planning or security
lanes: dispatch `migration-plan` or `security` explicitly where appropriate.

The plan should state the reason for retiring the dependency and consider a
standard-library replacement. It must identify the replacement version/license,
maintenance evidence, exact files to change and offline validation commands.
List public exports, types, errors and side effects that must stay compatible.
Call out any threat-model update that needs a separate maintainer decision.

## Migration execution

Commit a reviewed `dependencies.approved_migrations` entry on the default branch.
Then dispatch `task: migration` with that entry's ID.

```yaml
dependencies:
  approved_migrations:
    -
      id: replace-old-helper
      ecosystem: npm
      name: old-helper
      manifest: package.json
      replacement: { name: new-helper, version: "1.2.3" }
      plan: "Replace internal helper calls, preserve exports and errors, and add parity tests."
      allowed_files: [package.json, package-lock.json, src/helper.js, test/helper.test.js]
      validation_commands:
        - "npm ci --offline --ignore-scripts && npm run build && npm test && node -e 'const fs=require(\"fs\"); const version=require(\"new-helper/package.json\").version; if(version!==\"1.2.3\")process.exit(1); fs.writeFileSync(\"dependency-validation.json\", JSON.stringify({resolved:[{ecosystem:\"npm\",name:\"new-helper\",version}]}))'"
```

Review this template and adapt the commands before approving a migration.
Some packages do not expose their `package.json` through Node resolution.
Use exact file paths, not globs.

The validation commands must verify frozen resolution and write this
validation-worker artifact:

```json
{
  "resolved": [
    { "ecosystem": "npm", "name": "new-helper", "version": "1.2.3" }
  ]
}
```

For a standard-library replacement, set `replacement: { name: stdlib }` and
write `{"resolved":[]}` after the approved checks succeed.

The controller rechecks the approved plan, limits changed files, requires
retired-dependency removal and the declared replacement, checks target
advisories, and runs the approved commands in a fresh worker. Update existing
supported lockfiles. Protected workflow, controller and threat-model files
require a separate change.

Approval of a plan does not waive reported breaking changes or normal PR gates.
For non-npm ecosystems, the configured commands must supply the ecosystem-specific
frozen-resolution and test evidence. Routine automatic updates remain npm-only.

## Node toolchain maintenance

Enable Step G to propose Node runtime changes using the official release
schedule and fixed transformation rules. This step does not use an agent to
rewrite build logic.

- `supported` retires EOL releases.
- `active-lts` also retires current/maintenance releases among known released
  versions.
- The updater leaves unknown and future versions unchanged.
- If a simple matrix contains only retired versions, the updater adds an eligible
  LTS version so the matrix retains a test target.

Major-only setup-node inputs, supported matrices, runtime selector files and
listed build files are eligible. The updater leaves complex matrices, aliases,
exact patch pins, digest pins and heredoc-containing build scripts unchanged.

Each proposal carries `lights-on:hold` and explains the coverage change. It does
not change public `engines` requirements, required CI contexts, or branch
protection. Review those settings before retiring a test version.

## Issue and documentation maintenance

General issue/doc agents prepare changes or response text. Trusted steps
publish the result. External ordinary comments do not start paid inference by
default. With `events.allow_external_triggers: true` they are handled in read-only
response mode; authorized maintainer commands can select other tasks.

The scheduled fetch selects at most five open actionable issues. A PR-target
review uses fetched metadata/files/diff against a trusted base checkout.
It does not run the
untrusted PR branch in the credentialed job.

## Upstream stewardship

Set `upstream.repo: auto`, an explicit `owner/repo`, or `none`. Discovery can use
fork metadata, a Git upstream remote, or the GitHub API.

Polling reads limited recent snapshots of open issues, maintainer-authored
closed issues, PRs and releases. The publisher creates local tracking issues
for selected items; it does not merge upstream PRs into the fork.

Polling can miss older or skipped items. It does not import full history or
write changes back upstream. Read closed maintainer issues as context before
treating them as policy rulings. Duplicate detection uses local state and
recognized tracking metadata.

Unavailable upstream data or tracking-issue inventories stop synchronization.
If a later publication fails, the run fails but keeps confirmed mirrors in
state so the next attempt can skip them. Set `upstream.max_items_per_run: 0`
to select no new mirrors.

Explicit GitHub writes target the installed repository. Upstream access is
read-only, and agent command workers have no networking or GitHub credentials.
See [architecture](architecture.md) for these boundaries.
