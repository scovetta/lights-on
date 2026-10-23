# Threat Model: Lights On

## 1.1 Header

- **Revision**: [scovetta/lights-on, 5f8b3c062a90feef367cc0683e41cb4e8785c248][revision], the committed implementation integrated locally. Publication of this revision is not asserted. Unchanged citations and the backtest figures retain the published `abf1125` baseline; dependency/label updates cite the integrated revision. Full integration backtesting remains pending. Configuration `version: 1` is not a software version.
- **Date/status**: 2026-10-23; **unratified draft**. Q1–Q12 are unanswered. Drafting approval was not ratification or sign-off.
- **Triage policy**: `relaxed`. Inferred claims never close; assumptions permit only the provisional, low-blast-radius routes below.
- **Draft confidence**: 462 documented / 16 maintainer / 78 inferred / 1 assumption. Body-tag occurrences, including historical mappings, not unique guarantees.
- **Backtest note**: Backtested a 70-item corpus in 69 clusters: all seven families and 56/56 applicable family/dimension cells, covering eight dimensions. Seven real commit-recorded fixes; 63 synthesized cases, not historical incidents. An independent outcome-blind pass matched all 70 final disposition/status pairs after the initial outcome-separated routing. Histogram: 40 VALID, 1 VALID-HARDENING, 3 KNOWN-NON-FINDING, 4 BY-DESIGN: property-disclaimed, 1 OUT-OF-MODEL: unsupported-component, 0 OUT-OF-MODEL: non-default-build, 1 OUT-OF-MODEL: dependency-contract, 2 OUT-OF-MODEL: trusted-input, 0 OUT-OF-MODEL: adversary-not-in-scope, 18 MODEL-GAP. All seven historically-fixed items route VALID; zero historically-fixed items close (over-closing/fail-safe: 0/7). Nine cases close outright (12.9%); none provisionally; two inferred routes escalate (Q2/Q9). Closure is limited to explicit exclusions/disclaimers and exact KNFs. Eighteen gaps occupy 17 unresolved cells, owned by Q1/Q2/Q3/Q4/Q6/Q7/Q10/Q11/Q12; two retained-promise conflicts remain Q4. No unowned gaps or historical-outcome contradictions; five initial handoff gaps were repaired from public documentation, not disclaimers. All 12 questions remain unanswered.
- **Generation metadata**: GitHub Copilot/GPT-6 Astra (`gpt-6-astra`); specialist version/effort not exposed. Skills: threat-model, threat-model-recon, threat-model-surface, threat-model-interview, threat-model-authoring, threat-model-backtest, threat-model-sidecar.
- **Authority**: `THREAT_MODEL.md` > `threat-model.yaml` > `threat-model.json`; companions generated, validation limitation in §1.19. Seven families, no sibling models.
- **Reporting**: disclose §1.11 violations privately through GitHub security reporting or request a private maintainer channel. Apply §1.17 before closing.

**Provenance:** **documented** cites public authority; **maintainer** preserves a dated answer's original scope; **assumption** commits to a conservative unratified default; **inferred** leaves interpretation open. Both unratified tags reference questions. Code/tests are observations, not new guarantees. Historical month tags refer to 2026-10-16.

**Glossary:** *sink*: effect-producing operation; *taint*: inherited trust level; *controller*: trusted effect selector; *offline worker*: credential-free, externally disconnected executor; *TCB*: trusted boundary-enforcing components; *disclaimer*: unpromised property; *disposition*: classification; *status*: closure authority.

Lights On proposes maintenance, reviews PRs and publishes authorized changes. Neither model judgment nor passing tests proves semantic safety. *(documented, [risks])*

### Triager quick-start

> 0. Read the **relaxed** policy.
> 1. Locate family/operand (§1.7) or output (§1.8), then its contract dimension: numeric-domain, failure-atomicity, recursive-cyclic-topology, callback-execution, serialization-reconstruction, reference-lifecycle, concurrency-reentrancy or resource-complexity.
> 2. Check actor/control (§1.10), scope (§§1.2–1.3), configuration (§1.6) and dependency (§1.9).
> 3. Apply §1.17 precedence: exact KNF → unsupported component → unsupported configuration → dependency-contract → trusted input → excluded adversary → disclaimer → violated property/hardenable misuse → gap.
> 4. Cite one licensing claim. Contradiction or silence means `MODEL-GAP`; retained promises cannot silently disappear.
> 5. **Provenance gate:** **documented**/**maintainer** may license `closed`; **inferred** only `escalated`. **Assumption** permits only low-blast-radius trusted-input, adversary-not-in-scope, unsupported-component, non-default-build or non-security-critical property-disclaimed as `provisional`. Cite Q-ID, retain it and reopen on challenge without new evidence. Never close KNF, dependency-contract or security-critical disclaimers through assumptions. Silence-based disclaimers cannot close those routes or any security-critical report, regardless of tag. `VALID`/`MODEL-GAP` are not closes and take no status.

## 1.2 Scope and intended use

|Family|Entry groups|Effects|Provenance|
|---|---|---|---|
|A Actions/admission/state|A01–A08|Events, files, APIs, budgets|*(documented, [Workflow map][maintenance]; [permissions])*|
|B inference/workers|B01–B09|Provider disclosure, tools, offline commands|*(documented, [providers]; [candidate])*|
|C maintenance/review|C01–C09|Scans, caches, proposals, gates|*(documented, [Scheduled stages][maintenance])*|
|D publication/releases|D01–D10|GitHub/Git/registry mutation|*(documented, [publication]; [Release lifecycle][releases])*|
|E protected local|E01–E10|One-shot Linux/WSL roles, sockets, containers, egress|*(documented, [Quick start][local]; [network])*|
|F npm demo|F01–F05|Acquisition, snapshots, persistent images|*(documented, [Requirements and limits][demo])*|
|G adoption/site|G01–G06|Installation, discovery, Pages, reports|*(documented, [Installation side effects][install]; [discovery]; [Static site][web])*|

All families, including helpers/diagnostics, remain in scope. No daemon, durable queue or native `GITHUB_TOKEN` inference is implemented. Independent helper contracts remain Q1. *(inferred, Q1)*

Five workflows/two actions supersede the introductory four/one inventory, without excluding discovery/cache access. *(inferred, Q3)*

## 1.3 Out of scope

|ID|Exclusion; retained boundary|Provenance|
|---|---|---|
|S-PLATFORM|GitHub host/control-plane compromise; not project privilege misuse|*(maintainer, 2026-10)*|
|S-SECRET-OPS|Other-cloud rotation/vaulting/audit; not project-caused disclosure|*(maintainer, 2026-10)*|
|S-PROVIDER|Provider availability/rates/model mistakes; not admission/tools/publication|*(documented, [Prior §1.3][prior])*|
|S-HOST|Malicious local administrator/kernel/Docker; hostile shared runners need stronger isolation|*(documented, [recovery]; [candidate])*|
|S-LOCAL-EXPOSURE|Live cloud services, host devices, native non-Linux workers; synthetic loopback remains covered|*(documented, [validation]; [services])*|
|S-GH-HOST|GitHub Enterprise publication unsupported; wrong-target acceptance remains covered|*(documented, [publication])*|

Nondefaults, shipped helpers, malformed packages, external PRs, prompt injection and unread parsers are not blanket exclusions. *(inferred, Q1)*

## 1.4 Trust boundaries and data flow

```text
Events/source/PRs → Actions controller → provider → untrusted tool selection
  → candidate/offline worker → checked export → publisher → fresh review/exact-head CI
Operator/policy → local supervisor → role controller → private socket/gateway → approved service
  → private worker socket → offline execution → validation → fresh, explicitly granted publisher
Trusted release source → build without registry identity → untrusted artifacts → fresh inspection/upload
```

Actions analysis/mutation share job rights; withholding a step environment variable is not isolation. SDK client is controller TCB; empty mode restricts its child. Local roles and release jobs have separate boundaries. *(documented, [permissions]; [providers])*

Reachability requires A admission, B tool selection, C lane selection, D authorized publication, E operator invocation, F prepared target or G adoption/deployment. Data-induced authority acquisition remains an attack. *(inferred, Q1)*

## 1.5 Assumptions about the environment

Node 24 and trusted Linux/container hosts enforce execution; Windows uses WSL. Source must contain no provider-inappropriate secrets: isolation cannot retract disclosed source. *(documented, [Quick start][local]; [source-secrets])*

|Family|Host effects/failure postconditions|Provenance|
|---|---|---|
|A|Config/environment reads; ledger/locks/outputs/summaries/cache writes. Corrupt ledger blocks; unknown/interrupted usage retains reservations; read-only cache cannot persist usage.|*(documented, [limits]; [audit])*|
|B|Copies/private homes/usage files/processes/Docker. No host fallback; unfinished candidates discarded; later rollback unresolved.|*(documented, [candidate]; [limits])*|
|C|Caches/skills/Git/proposals; confirmed mirrors persist; missing validation blocks export.|*(documented, [Independent validation; Upstream stewardship][maintenance])*|
|D|Body files/uploader homes/artifacts/refs/versions; partial publication persists.|*(documented, [artifacts]; [A branch was pushed but no PR appeared][operations])*|
|E|Run/state/secret/CA files, counters, sockets, forwarders, signals, containers; manual crash recovery; cleanup only selected inactive run, not shared budget.|*(documented, [recovery])*|
|F|Host npm/Docker/cache/locks/snapshots/images; acquisition outside audit; images survive cleanup.|*(documented, [Requirements and limits; Inspect the result][demo])*|
|G|Clone/tool preparation/file replacement/optional origin labels/summary/Pages; preview still acquires source.|*(documented, [Installation side effects][install]; [Static site][web])*|

Owned-source scan (85 files, excluding locks) found no locale/FPU/umask mutation; not a permanent guarantee. *(assumption, Q3)*

Dependency internals/native runtimes/unsampled helpers remain open. No product-wide absence of sockets/processes/signals/environment or outside-checkout writes; old checkout/four-service promises remain conflicts. *(inferred, Q3)*

## 1.6 Build-time and configuration variants

|Variant|Boundary|Provenance|
|---|---|---|
|Enable/mode|`enabled:true`; literal `LIGHTS_ON_ENABLED=false` stops new eligible jobs, YAML checks follow startup. Cancel active jobs. `review-only` blocks merges, not proposals/releases; Q4 retains immediate-stop conflict.|*(documented, [stop]; [merge])*|
|Providers|copilot, claude/Anthropic, codex/OpenAI, openrouter; CLI 1.0.98 default, SDK 1.0.22 opt-in; `GITHUB_TOKEN` insufficient.|*(documented, [Provider routing; Copilot CLI preparation][config]; [sdk])*|
|Admission/authors|External paid events/external auto-merge default off; bot merge on. Opt-ins waive no unrelated gate.|*(documented, [admission]; [merge])*|
|Review/CI|Both default on; empty required checks block ordinary merge. Author opt-in differs from protected/breaking `approved-override`; disabled-gate support unresolved.|*(documented, [merge]; [Maintainer controls][operations])*|
|Support decisions|Disabled gates/custom controllers/images/rules/endpoints/PATH/callbacks; helper `strict:false`, `allowTmp`, `ALLOW_WORKFLOW_EDIT`: classify exposure separately, not by defaultness.|*(inferred, Q2)*|
|Limits|Configured replacements; shared retries/fallback cap, no dependency fallback. Dry-run synthetic; `LIGHTS_ON_FORCE` cannot bypass reservation.|*(documented, [limits]; [Manual scheduled-maintenance tasks][maintenance])*|
|Lanes|Routine npm updates change an existing v2/v3 lock or only the manifest when no lock exists. Major upgrades/replacements have read-only plans; replacement/removal execution needs a committed approved plan. Toolchain opt-in/held; `active-lts` narrows tests, not public engines.|*(documented, [Routine dependency updates; Migration planning; Migration execution; Node toolchain maintenance][maintenance])*|
|Release|`enabled` stops paths; `auto_publish` stops builds/uploads; `create_github_release` leaves tags. npm/PyPI OIDC/token, others token; local token-only. `provenance:false` preserves identity checks.|*(documented, [Registry support; Controls][releases])*|
|Local|Operator policy, immutable loaded Linux images, required profiles, independent grants. Added CA preserves TLS; custom rules cannot elevate capabilities.|*(documented, [Dependencies and custom images][local]; [network])*|
|Demo|Single npm package; v2/v3 or generated locks. `--allow-inference` required; no publication. Generated SHA-1 verified/re-pinned SHA-512.|*(documented, [Requirements and limits; Prepare a target][demo])*|
|Adoption|Preview/install; force replaces config, bundled automation normally replaced; labels/write discovery opt-in; Pages manual/default-branch.|*(documented, [Installation side effects][install]; [discovery]; [Static site][web])*|
|Model settings|Intent only: standard bootstrap uses `THREAT_MODEL.md`/built-in skill source; `block_automerge_on` is not a generic classifier.|*(documented, [intent])*|

Observed file-tool/PR protected sets: `.git`, `.github\{workflows,lights-on,actions,skills}`, `.github\lights-on.{yml,yaml}`, `.claude`, `install.{sh,ps1}`; case-insensitive `threat_model`/`threat-model` with md/yml/yaml/json at root/docs/.github. Export adds `.gitattributes`, `.gitmodules`, `.lfsconfig`. `ALLOW_WORKFLOW_EDIT` affects tools only; export allows bootstrap model exception; PR override is separate. These do not withdraw all-`.github` protection. *(inferred, Q4)*

## 1.7 Assumptions about inputs

57 operational groups, not every export. Partial grammar/probe/report/workflow/dependency coverage remains in scope; detailed reading inventory stays in producer evidence. *(inferred, Q1)*

U=untrusted; T=trusted; M=mixed as specified. Kinds: data; size/rate; name=resource-name; state=serialized state; topology=object-graph topology; code=callback/code; implementation=collaborator implementation; type=type/class; auth=x-authorization; capability=x-capability-selection; credential=x-credential; identity=x-reference-identity. O-* expands §1.13; P-*/PROP-* expands §1.11. Shared references inherit conditions, not extra guarantees. Platform identity must never come from claimed text. *(documented, [state])*

### Operational operands

|Entry point|Input operand|Attacker-controllable?|Control kind|Caller must enforce|Provenance|
|---|---|---|---|---|---|
|A01 events|Event/action|T platform|data|O-CONTROL|*(documented, [Workflow map][maintenance])*|
|A01|Issue title/body|U|data;size/rate|O-COST;PROP-SHELL-SAFE|*(maintainer, 2026-10)*|
|A01|Comment/slash|U until association|data|O-OVERRIDE|*(documented, [state])*|
|A01|Association/author/labels|M platform/authorized mutation|auth|O-CONTROL|*(documented, [admission])*|
|A01|Item number|M platform|name|O-CONTROL;installed-repo numeric ID|*(documented, [publication])*|
|A02 schedule|Task|T dispatcher|capability|O-CONTROL|*(documented, [Manual scheduled-maintenance tasks][maintenance])*|
|A02|Migration plan ID|T maintainer|name|O-MIGRATE|*(documented, [Migration execution][maintenance])*|
|A02|Force|T dispatcher|data|O-COST;no cap bypass|*(documented, [Manual scheduled-maintenance tasks][maintenance])*|
|A03 action|Task/tier|T workflow|name|O-CONTROL;tier≠authority|*(documented, [Provider routing][config])*|
|A03|Sandbox image|T executable|implementation|O-HOST|*(documented, [candidate])*|
|A03|Event path|T|name|O-CONTROL|*(inferred, Q2)*|
|A03|Event bytes|U|state;size/rate|O-COST;byte cap|*(documented, [limits])*|
|A03|Context paths|T|name|O-SOURCE|*(inferred, Q2)*|
|A03|Context bytes|U|data;size/rate|O-SOURCE;prompt cap|*(documented, [limits])*|
|A03|Selection file|T record/U metadata|state|O-CONTROL;independent validation|*(documented, [Selection; Independent validation][maintenance])*|
|A03|Output path|T|name|O-CONTROL|*(inferred, Q2)*|
|A03|Install-skills|T|capability|O-CONTROL;instruction trust|*(inferred, Q5)*|
|A03|Restore-state|T|capability|O-COST;one scheduled restore|*(documented, [audit])*|
|A04 cache|Effective mode|T runner grant|capability|O-COST;gate restores/saves;no grant enlargement|*(documented, [audit])*|
|A04|Trigger identity|T platform|data|O-CONTROL|*(documented, [audit])*|
|A04|Output/summary paths|T runner|name|O-CONTROL|*(inferred, Q3)*|
|A05 config|Root/config path|T|name|O-CONTROL;explicit path exists|*(documented, [Loading and syntax][config])*|
|A05|YAML|T policy|state;size/rate|O-CONTROL;P-CONFIG;size Q4|*(documented, [yaml])*|
|A05|Environment overrides|T process|data;capability|O-CONTROL;mapped variables only|*(documented, [Repository variables versus environment overrides][config])*|
|A06 ledger|State path|T|name|O-RECORDS|*(inferred, Q12)*|
|A06|JSON/direct object|M provenance/U metadata|state|O-RECORDS;normalization≠authentication|*(inferred, Q12)*|
|A07 recovery|Author|M platform identity|auth|O-CONTROL;recognized author|*(documented, [state])*|
|A07|Marker|U qualifying-author text|state|O-OUTPUT;P-STATE|*(documented, [state])*|
|A07|Labels|M maintainer|auth|O-OVERRIDE;fields Q12|*(inferred, Q12)*|
|A08 reservation|Path/task/item/reservation ID|T controller|name|O-COST;locked pre-inference reservation|*(documented, [limits])*|
|A08|Limits|T policy|size/rate|O-COST;positive per-run bounds|*(documented, [limits])*|
|A08|Usage/outcome|M telemetry|state|O-COST;unknown≠zero|*(documented, [usage])*|
|A08|Clock/timestamps|T environment/callback|data|O-HOST;skew Q11|*(inferred, Q11)*|
|B01 runner|Task/tier|T|capability|O-CONTROL;P-READONLY|*(documented, [Migration planning][maintenance]; [gates])*|
|B01|Repository/working roots|T roots/U files|name;topology|O-SOURCE;candidate separation|*(documented, [candidate])*|
|B01|Prompt paths/instructions|T source|name;data|O-CONTROL;no ratification|*(inferred, Q5)*|
|B01|Context/event/extra context|U|data;size/rate|O-SOURCE;delimiters≠isolation|*(documented, [source-secrets])*|
|B01|Provider/backend/model/fallback|T|name;implementation|O-COST;four providers|*(documented, [Provider routing][config])*|
|B01|Credentials|T secret|credential|O-CREDENTIALS;never worker|*(documented, [Execution zones][architecture])*|
|B01|Output/state paths|T|name|O-RECORDS|*(inferred, Q2)*|
|B01|Dry-run|T|capability|O-EVIDENCE;synthetic|*(documented, [Common gate reasons][operations])*|
|B02 read_file|Path|U model|name;topology|O-HOST;P-PATH|*(documented, [candidate])*|
|B02|Start/end lines|U model|size/rate|Positive safe integers;edges Q11|*(inferred, Q11)*|
|B03 write_file|Path|U model|name;topology|O-HOST;readonly/protected checks|*(documented, [candidate])*|
|B03|Content|U model|data;size/rate|O-OUTPUT|*(documented, [risks])*|
|B04 edit_file|Path|U model|name;topology|O-HOST;P-PATH|*(documented, [candidate])*|
|B04|Old string|U model|data|Literal nonempty first-match, not regex|*(inferred, Q11)*|
|B04|New string|U model|data|O-OUTPUT|*(inferred, Q8)*|
|B05 run_command|Command|U executable|code;size/rate|O-HOST;P-OFFLINE|*(documented, [candidate])*|
|B05|Stdout/stderr/files|U worker|data;topology|O-OUTPUT;stop before export|*(documented, [candidate])*|
|B06 finish_task|Summary/comment/PR body|U model|data|O-OUTPUT;P-TEXT|*(documented, [outcomes])*|
|B06|Title|U model|data|O-OUTPUT;plain neutralizer|*(documented, [publication])*|
|B06|Action/disposition|U suggestion|data|O-EVIDENCE;not authority|*(inferred, Q5)*|
|B06|Verdict/gates|U judgment|state|O-CI;complete live review|*(documented, [gates])*|
|B06|Risk/breaking/details|U judgment|data;state|O-OVERRIDE;false≠compatibility|*(documented, [risks])*|
|B06|Changed files|U inventory|name|O-EVIDENCE;actual controller export|*(documented, [Independent validation][maintenance])*|
|B06|Branch|U suggestion|name|O-CONTROL;automation refs|*(documented, [publication])*|
|B06|Added/removed labels|U suggestion|name;auth|O-OVERRIDE;filter before inventory lookup. Create only missing standard labels; reuse existing custom labels; report/skip undefined custom additions or absent removals. API failures stay errors.|*(documented, [state]; [Label reference][operations])*|
|B07 provider|History/schema|M data/T schema|state;size/rate|O-SOURCE;bounded request|*(documented, [providers])*|
|B07|Response/tool/arguments|U provider|type;state|O-EVIDENCE;known schema|*(documented, [providers])*|
|B07|Native events|M runtime/U-induced|code|O-HOST;deny unexpected activity|*(documented, [sdk])*|
|B07|Usage/metrics|M telemetry|state|O-COST;not model-reported|*(documented, [usage])*|
|B08 export|Candidate|U worker/model|topology;size/rate|O-STORAGE;whole changeset|*(documented, [candidate])*|
|B08|Target/baseline|T snapshot|name;state|O-RECORDS;source-change refusal|*(documented, [candidate])*|
|B08|allowThreatModel|T bootstrap|capability|O-CONTROL;P-EXPORT exception|*(documented, [candidate])*|
|B09 standalone|Prompt/system/model/working/output/turn options|T selections/U content|name;data;size/rate|O-CONTROL;no inherited admission|*(inferred, Q2)*|
|B09|OPENROUTER_BASE_URL|T endpoint|name|O-CREDENTIALS;support Q2|*(inferred, Q2)*|
|C01 scan|Root/manifest/lock|T root/U bytes|name;data;topology|O-SOURCE;parser subset|*(documented, [Routine dependency updates][maintenance])*|
|C01|Names/ecosystems/versions|U package|name;data|O-OUTPUT;identity rechecked|*(documented, [Routine dependency updates][maintenance])*|
|C01|OSV JSON/continuation|U service|state;size/rate|O-EVIDENCE;failure≠clean|*(documented, [Routine dependency updates][maintenance])*|
|C01|Ecosyste.ms metadata/counts|U service|state|O-EVIDENCE;unknown stays unknown|*(documented, [Routine dependency updates][maintenance])*|
|C01|Offline selector|T|capability|O-EVIDENCE;no fabricated intelligence|*(inferred, Q1)*|
|C02 select|Scan/time/open PRs/state|M evidence|state|O-COST;fresh dedup≠exactly-once|*(documented, [Selection][maintenance])*|
|C02|Mode/plan ID/approval|T maintainer|name;capability|O-MIGRATE;major-upgrade plans are read-only, not executable same-package upgrades|*(documented, [Migration planning; Migration execution][maintenance])*|
|C03 validate|Selection/hash/plan|T controller|state|O-MIGRATE;independent intent match|*(documented, [Independent validation][maintenance])*|
|C03|Manifest/lock/source|U candidate|data;topology|O-STORAGE;update existing supported lock. If absent, manifest-only candidate plus native temporary v3 lock in fresh offline worker; never export that lock. Verify agreement, exact resolution and unchanged source/lock during tests.|*(documented, [Routine dependency updates; Independent validation][maintenance])*|
|C03|Original npm scripts|U project|code|O-HOST;fresh offline worker|*(documented, [Independent validation][maintenance])*|
|C03|Extra/migration commands|T approval|code|O-MIGRATE;offline|*(documented, [Migration execution][maintenance])*|
|C03|Advisory/resolution output|U service/worker|state|O-EVIDENCE;source/exec-bit checks|*(documented, [Independent validation][maintenance])*|
|C04 publish|Result/evidence|T records/U narrative|state|O-RECORDS;matching completed live evidence|*(documented, [Publication][maintenance])*|
|C04|Base/branch/repository|T|name|O-CONTROL;installed repo|*(documented, [publication])*|
|C05 toolchain|Policy/build-file list|T|name;data|O-OVERRIDE;held proposals|*(documented, [Node toolchain maintenance][maintenance])*|
|C05|Schedule/source syntax|U|state;data|O-EVIDENCE;recognized literals|*(documented, [Node toolchain maintenance][maintenance])*|
|C06 upstream|Config/parent/remotes|M selection/platform|name|O-INSTALL;read-only upstream|*(documented, [Upstream stewardship][maintenance])*|
|C06|Issues/PRs/releases/closed issues|U|data;state|O-OUTPUT;not rulings|*(documented, [Upstream stewardship][maintenance])*|
|C06|Tracking markers|M author-qualified|state|O-RECORDS;dedup≠authority|*(documented, [Upstream stewardship][maintenance])*|
|C06|Create-local/output/maxItems|T|capability;name;size/rate|O-RETRY;confirmed mirrors persist|*(documented, [Upstream stewardship][maintenance])*|
|C07 inspector|Model path/Markdown|T path/unratified claims|name;data|O-EVIDENCE|*(inferred, Q5)*|
|C08 skills|URL/cache|T instruction source|name;data|O-CONTROL|*(inferred, Q9)*|
|C08|Install/root|T|capability;name|O-INSTALL;helper copies skills|*(inferred, Q3)*|
|C09 gates|Number/state/draft/author/labels/base/head|M platform/maintainer|name;auth|O-CI;fresh exact head|*(documented, [gates])*|
|C09|Files/rename origins/changed_files|U paths/platform count|name;size/rate|O-CI;unique complete ≤3,000|*(documented, [gates])*|
|C09|Diff|U contributor|data|O-OUTPUT;data-only review|*(documented, [gates])*|
|C09|Fresh review|U judgment/T record|state|O-CI;no comment approval reuse|*(documented, [gates])*|
|C09|Checks/statuses|M service|state;auth|O-CI;SHA/context/App≠workflow|*(documented, [checks])*|
|C09|Autonomy/bot controls|T|capability|O-OVERRIDE;distinct exceptions|*(documented, [merge])*|
|D01 GitHub|Repo/server/GH defaults|T identity|name;credential|O-CREDENTIALS;GitHub.com binding|*(documented, [publication])*|
|D01|Command/argv|T operation/U text|code;data|O-CONTROL;not hostile-command API|*(inferred, Q2)*|
|D01/D05 rendering|Body/notes|U|data;size/rate|O-OUTPUT;P-TEXT|*(documented, [publication])*|
|D01|Body-file path|T path/U bytes|name|O-CONTROL;renderer applies|*(documented, [publication])*|
|D01/D05|Title/merge subject/commit|U|data|O-OUTPUT;plain handling|*(documented, [outcomes])*|
|D01|Closing-issue number|T controller|name|O-CONTROL;local reference exception|*(documented, [publication])*|
|D02 push|Flags/ref|T controller|name|O-RETRY;automation/nonforced tags|*(documented, [publication])*|
|D02|Origin push URLs|T checkout|name|O-INSTALL;sole installed HTTPS|*(documented, [publication])*|
|D02|Token/helper|T secret|credential|O-CREDENTIALS;command-scoped, unpersisted|*(documented, [publication])*|
|D03 review|PR/head|T target/fresh identity|name;auth|O-CI;commit_id|*(documented, [gates])*|
|D03|Verdict/body|U|data|O-OUTPUT;self-COMMENT≠approval|*(documented, [gates])*|
|D04 PR|Head/base/repository|T|name|O-RETRY;matching open PR|*(documented, [A branch was pushed but no PR appeared][operations])*|
|D04|Title/body/bodyFile/labels|M narrative/T label intent|data;name|O-OUTPUT;confirm target|*(documented, [outcomes])*|
|D06 preparation|Commit subjects/bodies|U history|data|O-OVERRIDE;bump cap≠compatibility|*(documented, [Version policy][releases])*|
|D06|Tags/current version|M history|data;name|O-EVIDENCE;history failure aborts|*(documented, [Version policy][releases])*|
|D06|Version/manifest|T version/U syntax|data|O-RETRY;prevalidate, no set rollback|*(documented, [Version policy][releases])*|
|D06|Settings/dry-run|T|capability|O-RELEASE|*(documented, [Controls][releases])*|
|D07 plan|Event/author/label/base/SHA|M platform/maintainer|auth|O-CONTROL;qualifying default-branch source|*(documented, [Release lifecycle][releases])*|
|D07|Version marker/title/version|U qualifying text|state;data|O-RELEASE;committed-manifest match|*(documented, [Manual release dispatch][releases])*|
|D07|Token-presence/provenance|T|capability|O-CREDENTIALS;select job before secrets|*(documented, [Registry support][releases])*|
|D08 build|Root/backend|T executable source|code|O-HOST;no registry/OIDC|*(documented, [artifacts])*|
|D08|Ecosystem/version/output|T plan|data;name|O-RELEASE;package-only handoff|*(documented, [artifacts])*|
|D09 inspect|Manifest/archive|U build|state;size/rate|O-STORAGE;hash≠identity authority|*(documented, [release-isolation])*|
|D09|Expected names|T source/config|name|O-RELEASE;exact version/complete set|*(documented, [artifacts])*|
|D09|Members/metadata classes|U archive|topology;type|No execution/extraction;reject unsafe structure|*(documented, [artifacts])*|
|D09|npm publishConfig|U metadata|state;name|Only registry/access/tag;fixed registry|*(documented, [artifacts])*|
|D10 upload|Set/version/ecosystem|U bytes/validated identity|data;name|O-RELEASE;fresh outside-source validation|*(documented, [release-isolation])*|
|D10|Token/OIDC|T capability|credential|O-CREDENTIALS|*(documented, [Registry support][releases])*|
|D10|Response|U confirmation|state|O-RETRY;partial success|*(documented, [artifacts])*|
|E01 CLI|Subcommand/task/tier/item/plan/version/ecosystem|T operation|capability;name|O-CONTROL;fixed operations|*(documented, [Tasks and providers][local])*|
|E01|Policy path|T operator|name|O-RECORDS;repo cannot widen|*(documented, [Quick start][local])*|
|E01|Output/run paths|T managed|name|O-RECORDS;selected cleanup|*(documented, [recovery])*|
|E01|Repository/ref|T selection/M identity|name|O-INSTALL;resolved SHA|*(documented, [local-publish])*|
|E01|Four publication flags|T grants|auth|O-PUBLISH;policy intersection|*(documented, [local-publish])*|
|E01|WSL distro/credential variable names|T host|name;credential|O-HOST|*(documented, [Quick start][local])*|
|E02 policy|Repository/upstreams|T operator|name|O-PUBLISH;upstream read-only|*(documented, [network])*|
|E02|Images|T executable|implementation|O-HOST;immutable/loaded/Linux|*(documented, [Dependencies and custom images][local])*|
|E02|Rule host|T scope|name|O-CREDENTIALS;public DNS/TLS|*(documented, [network])*|
|E02|Rule path|T scope|name|Exact or trailing-slash subtree|*(documented, [network])*|
|E02|Methods/roles|T capabilities|auth|O-PUBLISH;independent grants|*(documented, [network])*|
|E02|Secret env/file|T source|name;credential|O-CREDENTIALS;operation-specific loading|*(documented, [Quick start][local])*|
|E02|Header/prefix/basic user/forwardAuthorization|T binding|credential|O-CREDENTIALS;narrow Copilot exception|*(documented, [Tasks and providers][local])*|
|E02|Limits|T|size/rate|O-STORAGE;request/response/count/deadline|*(documented, [network])*|
|E02|Upstream CA|T root|implementation|O-HOST;verification retained|*(documented, [network])*|
|E03 fetch|Git objects/metadata|U remote|state;topology|O-HOST;exact repo/SHA,no candidate .git|*(documented, [Tasks and providers][local])*|
|E03|PR head/files/diff|U contributor|data;name|O-VALIDATE;offline-head/trusted-config Q7|*(inferred, Q7)*|
|E04 analysis|Config/request/context|M policy/U data|state|O-CONTROL;tooling separate|*(documented, [Tasks and providers][local])*|
|E04|Credential/state mount|T|credential;name|O-CREDENTIALS;no worker secrets|*(documented, [Tasks and providers][local])*|
|E05 supervisor|Connection/method/path|T private socket|name;auth|O-HOST;no worker access|*(documented, [network])*|
|E05|Operation/source/worker ID|T issued handle|state;name|O-RECORDS;lifetime Q6|*(inferred, Q6)*|
|E05|Command|U executable|code;size/rate|O-HOST;fixed restrictions,no caller Docker flags|*(documented, [validation])*|
|E06 gateway|Host/scheme/port/userinfo|M client|name|HTTPS/public DNS/pinned IP/TLS|*(documented, [network])*|
|E06|Raw/decoded path/query|M client|name;data|Canonical route;query Q6|*(inferred, Q6)*|
|E06|Method|M client|auth|O-PUBLISH;rule/capability|*(documented, [network])*|
|E06|Host/Upgrade|M client|data|Matching host;no tunnels/upgrades|*(documented, [network])*|
|E06|Content-Length/Transfer-Encoding|M client|size/rate|Measured bounded body;edges Q6|*(inferred, Q6)*|
|E06|Authorization/cookie/key|M client|credential|Rule injection;stripping/forwarding Q6|*(inferred, Q6)*|
|E06|Body/Git ref JSON|M request|state;size/rate|O-PUBLISH;scoped mutation|*(documented, [local-publish])*|
|E06|DNS/certificate|U peer|implementation|O-HOST;all public/TLS verified|*(documented, [network])*|
|E06|Response/status|U service|data;size/rate|O-OUTPUT;caps/no redirects|*(documented, [network])*|
|E06|Audit/counter sink|T supervisor|name;state|O-RECORDS;P-AUDIT|*(documented, [network])*|
|E07 prepare|Bundle name/URL/hash|T identity/U bytes|name;data|O-HOST;inert verified download|*(documented, [Dependencies and custom images][local])*|
|E07|Docker/npmRegistry|T transport|implementation|O-STORAGE;outside audit|*(documented, [Dependencies and custom images][local])*|
|E08 validate|Profile/image/platform|T required case|name;implementation|O-VALIDATE;unavailable blocks|*(documented, [validation])*|
|E08|Commands|T code/U project|code|O-VALIDATE;no dropped coverage|*(documented, [validation])*|
|E08|Limits/timeout|T|size/rate|O-STORAGE;readiness shares deadline|*(documented, [validation])*|
|E08|Service image/command/health|T executable|code;implementation|O-VALIDATE;offline loopback|*(documented, [services])*|
|E08|Service ports/data paths|T declarations|name;size/rate|O-VALIDATE;no host ports/mounts|*(documented, [services])*|
|E08|Service environment|T synthetic|data|O-VALIDATE;no production secrets|*(documented, [services])*|
|E08|Bundle/outputs|T declarations/U bytes|data;topology|O-VALIDATE;hash/type/source/exec-bit checks|*(documented, [validation])*|
|E09 publish|Policy/run/snapshot/result/validation/grants|T records/U narrative|state|O-RECORDS;identity binding|*(documented, [local-publish])*|
|E09|Tree/branch/files|U validated candidate|data;name|O-PUBLISH;new branch,no default/force|*(documented, [local-publish])*|
|E09|PR/head/checks/tag|M fresh platform|state;identity|O-CI;separate reviewer/real CI|*(documented, [local-publish])*|
|E09|Credential/artifacts|T secret/U package|credential;data|O-RELEASE;token,no simulated OIDC|*(documented, [local-publish])*|
|E09|Response|U confirmation|state|O-RETRY;record partial effects|*(documented, [local-publish])*|
|E10 status/cleanup|Run/lock/status|T managed|name;identity|O-RETRY;inspect/preserve state|*(documented, [recovery])*|
|F01 setup|Repo/ref/directory|T selection|name|O-INSTALL;new directory|*(documented, [Prepare a target][demo])*|
|F01|Provider/model/controller image|T collaborator|name;implementation|O-HOST;no setup inference|*(documented, [Run a documentation agent][demo])*|
|F01|Registry/host npm config|T transport|name|O-CREDENTIALS;selected unauthenticated HTTPS,no fallback|*(documented, [Requirements and limits][demo])*|
|F01|GitHub auth/read token|T|credential|O-CREDENTIALS;fetch-only,not image|*(documented, [Prepare a target][demo])*|
|F02 resolve|Requirements/name/version/platform/peers|U|state|Inert subset;no scripts|*(documented, [Prepare a target][demo])*|
|F02|Alternate locks/.npmrc|U config|name;data|Unsupported lockless fallback blocks|*(documented, [Prepare a target][demo])*|
|F02|Registry metadata|U|state;size/rate|Restricted prepare GETs;no node_modules/hooks|*(documented, [Prepare a target][demo])*|
|F03 acquire|Lock locations/names/versions/integrity|U|name;state|O-STORAGE;never download resolved URL|*(documented, [Requirements and limits][demo])*|
|F03|Pack metadata/archive|U|data;size/rate|Identity/integrity;post-download caps|*(documented, [Requirements and limits][demo])*|
|F03|Cache/generated lock|M verified|state|O-EVIDENCE;validation-only|*(documented, [Prepare a target][demo])*|
|F04 run|Task/allow-inference|T|capability|O-COST;no publication|*(documented, [Run a documentation agent][demo])*|
|F04|demo.json/policies/provenance|T prepared|state|O-RECORDS;SHA/digests,no grants|*(documented, [Inspect the result][demo])*|
|F05 wrapper|npm ci arguments|M invocation|data;code|O-HOST;expected offline/ignore-scripts only|*(documented, [Prepare a target][demo])*|
|F05|Manifest/generated lock/digest|U source/T preparation|state|O-EVIDENCE;no source-lock replacement|*(documented, [Prepare a target][demo])*|
|G01 PowerShell installer|TargetDir|T path|name;topology|O-INSTALL;hostile-tree Q3|*(inferred, Q3)*|
|G01|SourceDir/RepoUrl/override|T executable source|implementation|O-INSTALL|*(documented, [Install the files][install])*|
|G01|DryRun/Force|T modes|capability|O-INSTALL;preview≠replacement|*(documented, [Installation side effects][install])*|
|G01|CreateLabels/SkipLabels/origin|T grants/identity|auth;name|O-INSTALL;inspected origin|*(documented, [Installation side effects][install])*|
|G02 POSIX installer|Target/source/branch|T source choice|name;implementation|O-INSTALL;branch fallback Q3|*(inferred, Q3)*|
|G02|dry-run/force/create-labels/skip-labels|T|capability|O-INSTALL|*(documented, [Installation side effects][install])*|
|G03 discovery|Repo/branch|T target|name|O-CI;not open-PR policy|*(documented, [discovery])*|
|G03|Rules/checks/statuses/runs|M platform|state|O-CI;ambiguity/missing blocks|*(documented, [discovery])*|
|G03|Root/config/workflow|T policy|name;state|O-INSTALL;preserve different explicit list|*(documented, [discovery])*|
|G03|write/update-workflows|T grants|capability|O-INSTALL;no commit/protection writes|*(documented, [discovery])*|
|G04 tooling|Directory/backend|T installation|name;implementation|O-HOST;outside target|*(documented, [Copilot CLI preparation][config]; [sdk])*|
|G04|Registry/config/package|M transport/U dependency|implementation;data|O-HOST;integrity≠benevolence|*(documented, [providers])*|
|G05 site/Pages|Assets/default-branch dispatch|T|data;capability|O-CONTROL;no maintenance API|*(documented, [Static site][web])*|
|G06 reports|Title/message/details/confirmed URL|M text/verified link|data;name|O-OUTPUT;recognized-secret redaction only|*(documented, [outcomes])*|
|G06|Environment/summary path/write callback|T executable|name;code|O-CONTROL;not hostile plugin|*(inferred, Q2)*|
|Shared helpers|fetch/spawn/exec/sandbox/runtime/SDK-loader/completion/API/clock|T executable|code;implementation|O-HOST;no inherited wrapper guarantees|*(inferred, Q2)*|

### Contract-dimension matrix

All 56 rows use exact dimensions. Claimed rows inherit only referenced conditions; unresolved extensions never become exclusions.

|Component|Dimension|Status|Conditions / routes|Provenance|
|---|---|---|---|---|
|A|numeric-domain|claimed|PROP-RATE-LIMIT/P-CONFIG;not old size cap|*(documented, [limits]; [Loading and syntax][config])*|
|A|failure-atomicity|unresolved|P-HANDOFF;corrupt ledger blocks;cross-write/settlement Q10/Q12|*(inferred, Q10)*|
|A|recursive-cyclic-topology|claimed|P-CONFIG/D-YAML;not cyclic JS|*(documented, [yaml])*|
|A|callback-execution|claimed|PROP-SHELL-SAFE/PROP-SLASH-AUTHZ;trusted controller|*(documented, [state]; [Prior §1.11][prior])*|
|A|serialization-reconstruction|claimed|P-CONFIG/P-STATE;never recovered approval|*(documented, [yaml]; [state])*|
|A|reference-lifecycle|unresolved|Stop conflict Q4;D-LEDGER|*(inferred, Q4)*|
|A|concurrency-reentrancy|claimed|PROP-RATE-LIMIT;shared concurrency/locks≠distributed linearizability|*(documented, [limits])*|
|A|resource-complexity|disclaimed|D-BILLING;configured checks retained|*(documented, [usage])*|
|B|numeric-domain|claimed|PROP-RATE-LIMIT;standalone/range Q11|*(documented, [limits])*|
|B|failure-atomicity|claimed|Invalid tool executes none;P-EXPORT/P-OFFLINE;Q10|*(documented, [providers]; [candidate])*|
|B|recursive-cyclic-topology|claimed|P-PATH;depth Q11|*(documented, [candidate])*|
|B|callback-execution|claimed|P-OFFLINE/P-INFERENCE/P-READONLY;SDK client TCB|*(documented, [providers])*|
|B|serialization-reconstruction|claimed|P-INFERENCE/P-EXPORT;actual inventory≠narrative|*(documented, [providers]; [outcomes])*|
|B|reference-lifecycle|claimed|P-INFERENCE;fresh/unshared/unresumed sessions,shutdown|*(documented, [sdk])*|
|B|concurrency-reentrancy|unresolved|Mutable helpers/callbacks Q2/Q10|*(inferred, Q10)*|
|B|resource-complexity|unresolved|PROP-RATE-LIMIT/P-OFFLINE;candidate/depth/CPU/heap Q11|*(inferred, Q11)*|
|C|numeric-domain|claimed|P-DEPENDENCY/P-GATES;one dependency,≤3,000 files|*(documented, [Selection][maintenance]; [gates])*|
|C|failure-atomicity|claimed|P-DEPENDENCY/P-HANDOFF/D-TRANSACTION;missing proof blocks;Q10|*(documented, [Independent validation; Upstream stewardship][maintenance]; [Troubleshooting][operations])*|
|C|recursive-cyclic-topology|claimed|P-DEPENDENCY/P-GATES;npm/files/renames;Q1|*(documented, [Routine dependency updates][maintenance]; [gates])*|
|C|callback-execution|claimed|P-DEPENDENCY/P-READONLY;offline commands|*(documented, [Independent validation; Migration planning][maintenance])*|
|C|serialization-reconstruction|claimed|P-DEPENDENCY/P-GATES/P-STATE/P-HANDOFF;revalidated evidence|*(documented, [gates]; [Troubleshooting][operations])*|
|C|reference-lifecycle|unresolved|P-GATES/P-REVIEW retained;CI-invocation conflict Q4;off-switch support Q2|*(inferred, Q4)*|
|C|concurrency-reentrancy|unresolved|Dedup≠cross-installation exactly-once;Q10|*(inferred, Q10)*|
|C|resource-complexity|unresolved|D-ANALYSIS;total parser/resources Q11|*(inferred, Q11)*|
|D|numeric-domain|unresolved|P-PACKAGE;parser/expansion Q11|*(inferred, Q11)*|
|D|failure-atomicity|disclaimed|D-TRANSACTION|*(documented, [artifacts])*|
|D|recursive-cyclic-topology|claimed|P-PACKAGE;safe forms,not arbitrary objects|*(documented, [artifacts])*|
|D|callback-execution|claimed|P-RELEASE/P-PACKAGE;nonexecuting uploader|*(documented, [artifacts])*|
|D|serialization-reconstruction|claimed|P-PACKAGE/P-TEXT;trusted identity/set|*(documented, [release-isolation]; [publication])*|
|D|reference-lifecycle|claimed|P-REPO/P-REVIEW/P-TAG|*(documented, [publication]; [Release lifecycle][releases])*|
|D|concurrency-reentrancy|claimed|P-REVIEW/D-TRANSACTION;head/commit_id/merge SHA|*(documented, [gates])*|
|D|resource-complexity|unresolved|P-PACKAGE/P-TEXT;expansion/stack/disk Q11|*(inferred, Q11)*|
|E|numeric-domain|claimed|P-EGRESS/P-VALIDATE/D-STORAGE|*(documented, [network]; [validation])*|
|E|failure-atomicity|disclaimed|D-TRANSACTION/D-RECOVERY;response loss|*(documented, [local-publish]; [recovery])*|
|E|recursive-cyclic-topology|claimed|P-VALIDATE/P-OFFLINE;no caller mounts/flags|*(documented, [validation])*|
|E|callback-execution|claimed|P-OFFLINE/P-EGRESS/P-RELEASE|*(documented, [network]; [validation])*|
|E|serialization-reconstruction|claimed|P-GRANTS/P-VALIDATE;not hostile-operator attestation|*(documented, [local-publish])*|
|E|reference-lifecycle|unresolved|D-RECOVERY;protocol/handles Q6|*(inferred, Q6)*|
|E|concurrency-reentrancy|claimed|P-EGRESS/D-BILLING;run locks/counters,not all policies/Actions|*(documented, [network]; [recovery])*|
|E|resource-complexity|claimed|P-EGRESS/P-VALIDATE/D-STORAGE;configured bounds|*(documented, [network]; [validation])*|
|F|numeric-domain|claimed|P-DEMO-PREP/D-STORAGE;post-download caps|*(documented, [Requirements and limits][demo])*|
|F|failure-atomicity|unresolved|D-DEMO-IMAGES;cross-image/file rollback Q10|*(inferred, Q10)*|
|F|recursive-cyclic-topology|claimed|P-DEMO-LOCK/D-DEMO-FORMAT|*(documented, [Prepare a target][demo])*|
|F|callback-execution|claimed|P-DEMO-PREP/P-OFFLINE;no acquisition hooks|*(documented, [Prepare a target][demo])*|
|F|serialization-reconstruction|claimed|P-DEMO-LOCK;integrity/re-pin/refuse synthetic scan|*(documented, [Requirements and limits][demo])*|
|F|reference-lifecycle|claimed|P-DEMO-LOCK/P-DEMO-GRANTS;prepared bindings|*(documented, [Inspect the result][demo])*|
|F|concurrency-reentrancy|unresolved|Shared-directory setup/edit/run Q7/Q10|*(inferred, Q10)*|
|F|resource-complexity|disclaimed|D-STORAGE/D-AUDIT|*(documented, [Requirements and limits][demo])*|
|G|numeric-domain|unresolved|Discovery/report caps≠installer limits;Q11|*(inferred, Q11)*|
|G|failure-atomicity|unresolved|P-PREVIEW;cross-file rollback Q10|*(inferred, Q10)*|
|G|recursive-cyclic-topology|unresolved|Hostile-target installer confinement Q3|*(inferred, Q3)*|
|G|callback-execution|claimed|P-PREVIEW/P-DISCOVERY/§1.5;reviewed source/static site|*(documented, [Preview before installing][install]; [discovery]; [Static site][web])*|
|G|serialization-reconstruction|claimed|P-DISCOVERY;exact identities/preserve policy|*(documented, [discovery])*|
|G|reference-lifecycle|claimed|P-PREVIEW/P-DISCOVERY/§1.5;no commit/push,manual Pages|*(documented, [Installation side effects][install]; [Static site][web])*|
|G|concurrency-reentrancy|unresolved|Editor/installer/discovery races Q10|*(inferred, Q10)*|
|G|resource-complexity|unresolved|Acquisition/deployment totals Q11|*(inferred, Q11)*|

## 1.8 Assumptions and guarantees about outputs

|Output channel|Family|Taint / invariant|Must not assume|Provenance|
|---|---|---|---|---|
|Config/GITHUB_OUTPUT|A|Parsed policy/single-line selected values,no credentials|Shell/HTML/policy safety|*(documented, [Loading and syntax][config]; [Prior §1.8 GitHub Output Variables][prior])*|
|Ledger/state JSON|A|Bookkeeping/U metadata,unknown distinguished|Signed authorization/durable billing/arbitrary-object safety|*(documented, [usage]; [state])*|
|Public markers|A/D|Literal bookkeeping;P-STATE/P-TEXT|Encryption/approval/author-independent authenticity|*(documented, [state]; [publication])*|
|Provider requests|B|Source/context/tools disclosed|Delimiter-based secrecy/injection immunity|*(documented, [source-secrets]; [risks])*|
|Reads/stdout/stderr|B/E|Output is as untrusted as input; no sanitization, normalization or new-context encoding|Truth/completeness/terminal/HTML/shell safety|*(inferred, Q8)*|
|Code/diffs|B/C/E|Untrusted;P-PATH/P-EXPORT/lane checks|Safe execution/dependencies/semantics|*(documented, [candidate]; [risks])*|
|Results/verdict/risk|B|Claims mixed with controller facts|Completion=publication/model gates=CI|*(documented, [outcomes])*|
|Usage JSON|A/B/E|Reported/estimated/partial/unavailable; private telemetry counted once, distinct units|Null=zero/Copilot units=USD/invoice cap|*(documented, [usage])*|
|Dependency report|C|Parsed source/external intelligence/missing evidence|Complete SBOM/vulnerability/compatibility proof|*(documented, [Routine dependency updates][maintenance]; [risks])*|
|Dependency validation|C|Identity/hash/commands;P-DEPENDENCY;temporary lock hash/mode recorded but lock not published|Arbitrary-code safety/unrelated-file permission or every future range resolution|*(documented, [Independent validation][maintenance])*|
|Upstream snapshots/tracking|C|Trimmed external text/local rendering|Complete history/quoted ruling authority|*(documented, [Upstream stewardship][maintenance])*|
|Toolchain/release proposals|C/D|Deterministic edits/external text|Approval/nonbreaking minor bump|*(documented, [Node toolchain maintenance][maintenance]; [Version policy][releases])*|
|Inspection/generated model|C|Presence/counts/unratified claims|Semantic/provenance/companion validity/sign-off|*(inferred, Q5)*|
|GitHub bodies/files|D/E|Restricted Markdown;P-TEXT|Truth/cross-context safety|*(documented, [publication])*|
|Titles/commits|D/E|Plain reference neutralization|Code-span/universal safety|*(documented, [outcomes])*|
|Branch/PR/review/merge confirmations|D/E|Confirmed identity/state/SHA|Branch=PR/COMMENT=approval/guaranteed CI|*(documented, [outcomes]; [local-publish])*|
|Packages/manifests/uploads|D/E|Identity/set/hash;P-PACKAGE|Benevolence/transactions|*(documented, [artifacts])*|
|Local snapshot/run/validation|E|Policy/code/source/candidate linkage|Hostile-operator attestation/remote checks|*(documented, [local-publish]; [validation])*|
|network.jsonl|E|Gateway metadata; sensitive path/query/body/auth omitted|Host/syscall/blocked-socket/acquisition/remote-CI audit|*(documented, [network]; [recovery])*|
|publication.json|E|Confirmed partial actions;retry refused|Exactly-once/all orphan inventory|*(documented, [local-publish])*|
|Demo lock/policy/image|F|Resolution/manifest/archive provenance|Source-authoritative/committable lock/image benevolence|*(documented, [Prepare a target; Inspect the result][demo])*|
|Preview/discovery|G|Diff/config evidence|Installation/protection mutation/observations=requirements|*(documented, [Preview before installing][install]; [discovery])*|
|Annotations/summary|G|Bounded escaping/recognized-secret redaction/confirmed links|Universal child-log/source redaction/URL authority|*(documented, [outcomes])*|
|HTML/CSS/SVG|G|Authored public assets|Running service/deployment|*(documented, [Static site][web])*|

Specific encoders/normalization/identity checks remain; stronger log secrecy or cross-context promises are Q8. *(inferred, Q8)*

## 1.9 Assumptions about dependencies

Dependency-contract routing needs a named contract, conformant use and dependency root cause. Integration misuse stays here; bundled remediation ownership remains Q9. Inferred authority never closes. *(inferred, Q9)*

|Dependency|Relied-on contract/boundary|Provenance|
|---|---|---|
|DEP-NODE Node24/built-ins|Filesystem/JSON/argv/environment/fetch/TLS/process;not risk elimination|*(inferred, Q9)*|
|DEP-HOST OS/Docker/images|Namespace/mount/UID/capabilities/resources;project config retained|*(documented, [candidate]; [recovery])*|
|DEP-WSL|Distro/path/credential forwarding;not native isolation|*(documented, [Quick start][local])*|
|DEP-GIT|Refs/identity/helpers/argv;misuse retained|*(inferred, Q9)*|
|DEP-GH|API/host/target/arguments;binding project-owned|*(inferred, Q9)*|
|DEP-ACTIONS|Provenance/permissions/cache/artifact transport;not step isolation|*(documented, [audit]; [permissions])*|
|DEP-GITHUB|Association/SHA/check identity/responses;App≠workflow|*(documented, [checks]; [gates])*|
|DEP-CLI @github/copilot1.0.98|Inference subprocess/telemetry;standalone PATH not pinned|*(documented, [Copilot CLI preparation][config])*|
|DEP-SDK @github/copilot-sdk1.0.22/transitives|Client TCB;empty child/deny/accounting/shutdown|*(documented, [providers]; [sdk])*|
|DEP-PROVIDERS four services|TLS/auth/response/telemetry;intentional disclosure,not judgment/cost completeness|*(documented, [Provider routing][config]; [usage])*|
|DEP-GATEWAY mitmproxy/Python|Parsing/TLS/DNS/sockets/bounded streaming;policy project-owned|*(inferred, Q9)*|
|DEP-PARSERS Python archive/TOML/JSON/email/XML|Nonexecuting inspection;no expected-name authority|*(documented, [artifacts])*|
|DEP-PSYCH Ruby/Psych|AST,no objects;duplicate/alias/tag restrictions|*(documented, [artifacts])*|
|DEP-BUILDERS npm/Python/MSBuild/Cargo/RubyGems|Project execution only build/offline zone|*(documented, [artifacts])*|
|DEP-UPLOADERS npm/dotnet/gem/twine/PyPA/registries|Fixed destination/token/OIDC;no rollback|*(documented, [Registry support][releases]; [artifacts])*|
|DEP-OSV|Advisories/missing evidence;not benevolence|*(documented, [Routine dependency updates][maintenance])*|
|DEP-ECOSYSTEMS|Health/dependents;not compatibility proof|*(documented, [Routine dependency updates][maintenance]; [risks])*|
|DEP-NODE-SCHEDULE|Official lifecycle data;held proposals,not merge authority|*(documented, [Node toolchain maintenance][maintenance])*|
|DEP-SKILLS|Trusted instructions/cache;not ratification|*(inferred, Q5)*|
|DEP-WEB|Browser/Pages static rendering/manual deployment;no maintenance API|*(documented, [Static site][web])*|

## 1.10 Adversary model

Public GitHub repository or trusted local operator/host; hostile repository/package data. Actions does not inherit local gateway isolation. *(documented, [Execution zones][architecture]; [network])*

|Actor|Scope/control|Excluded capability; goal|Provenance|
|---|---|---|---|
|ADV-EVENT|In: issue/comment/marker/slash text,rate|Not trusted code/association;injection/paid work|*(documented, [admission]; [state])*|
|ADV-PR|In: bytes/paths/renames/descriptions/new heads|Not trusted base/labels;gate bypass/backdoor|*(documented, [gates])*|
|ADV-MODEL|In: tools/commands/candidates/claims|Not credentials/network/host dispatch/grants;escape/disclosure|*(documented, [Execution zones][architecture]; [candidate])*|
|ADV-PACKAGE|In: archives/metadata/advisories/upstream text|Not expected identities/policy;artifact/authority confusion|*(documented, [release-isolation]; [Upstream stewardship][maintenance])*|
|ADV-NETWORK|In: DNS/certificates/protocol data|Not CA/operator authority;SSRF/egress/exhaustion|*(documented, [network])*|
|ADV-WORKER|In: files/commands/loopback|Not control sockets/host ports/mounts;escape/forged evidence|*(documented, [validation]; [services])*|
|ADV-OPERATOR|Out: deliberate trusted-code/policy/host replacement|Data-induced acquisition stays in scope|*(documented, [Prior §1.12 Malicious Maintainer Commits][prior]; [recovery])*|
|ADV-HELPER|Unresolved executable collaborator replacement|Remote data is not JS callback authority;Q2|*(inferred, Q2)*|

Flooding/denial-of-wallet is covered by admission/configured bounds, not invoice/Actions-minute promises. *(documented, [Paid-work admission and remaining resource risks][architecture]; [usage])*

## 1.11 Security properties the project provides

Each claim includes its conditions. No unratified extension is security-critical. Locators identify enforcement, not authority: basenames under `.github\lights-on\runner`, workflows under `.github\workflows`; all bind §1.1.

|ID / claim|Violation symptom|Tier|Voided by / controls and locator|Provenance|
|---|---|---|---|---|
|PROP-SHELL-SAFE event fields never become host-shell source|integrity-bypass|security-critical|Trusted workflow replacement, not event values; `lights-on-events.yml:63-128`|*(maintainer, 2026-10)*|
|PROP-SLASH-AUTHZ OWNER/MEMBER/COLLABORATOR required|integrity-bypass|security-critical|Altered trusted metadata/controller; paid opt-in never waives `lights-on-events.yml:103-105`|*(documented, [state]; [audit])*|
|PROP-EXT-PR-GATE external auto-merge defaults off|integrity-bypass|security-critical|Author opt-in/`lights-on:automerge`, not unrelated gates; `verify-pr-safety.mjs:223-231`|*(documented, [merge]; [admission])*|
|PROP-RATE-LIMIT reserve before inference; enforce configured checks|x-unapproved-paid-execution|security-critical|Defaults: 262144 bytes, 30 shared calls, 25 turns/attempt, 100000 known tokens/$2 between turns, 25 recorded runs/day, 10 responses/hour, 2 attempts/item, $10 recorded/day. Config changes thresholds; force cannot bypass `run-agent.mjs:483`; D-BILLING.|*(documented, [limits])*|
|P-CONFIG reject unsupported YAML/duplicates/wrong known types; no executable reconstruction|bad-data-accepted|security-critical|Permissive helpers Q2; unknown keys not universally rejected; size Q4; `load-config.mjs:422-423`|*(documented, [yaml])*|
|P-STATE recognized-author bookkeeping never becomes approval|integrity-bypass|security-critical|Trusted identity/evidence replacement; recovered fields Q12; `state-store.mjs:441,450`|*(documented, [state])*|
|P-HANDOFF promised results/evidence missing or malformed are errors, not successful absence; disabled runs emit skipped JSON; absent upstream uses optional outputs/skipped snapshots; bootstrap requires core skill; cache operations obey effective grants|wrong-output|correctness-only|Executed promised producers/explicit evidence paths only, not unselected optional steps; no skill-trust/ratification/durability extension. `lights-on-events.yml:224`, `sync-upstream.mjs:698`, `ensure-threat-model.mjs:302`|*(documented, [Troubleshooting; Cache and recovery][operations]; [gates])*|
|P-PATH confine regular paths; reject symlink/special traversal|integrity-bypass|security-critical|`allowTmp:true` widens helper; tools pass false; `workspace-path.mjs:16`, `openrouter-agent.mjs:249`; host mutation/helper substitution unresolved|*(documented, [candidate])*|
|P-EXPORT require completion, validated changeset, protected paths and unchanged source|integrity-bypass|security-critical|Bootstrap model exception `agent-sandbox.mjs:18`; tool `ALLOW_WORKFLOW_EDIT` never bypasses export; all-.github Q4|*(documented, [candidate]; [limits])*|
|P-OFFLINE workers lack credentials/external network/host home/Docker socket/controller mounts; no fallback|info-leak; integrity-bypass|security-critical|Trusted runtime replacement, not reviewed image; `agent-sandbox.mjs:82-89`, `local\runtime.mjs:230-233`; services use offline loopback|*(documented, [candidate]; [validation]; [services])*|
|P-READONLY reviewers/planners cannot write or execute commands|integrity-bypass|security-critical|Different task/direct dispatcher; `run-agent.mjs:534-535`, `openrouter-agent.mjs:245-317`|*(documented, [Migration planning][maintenance]; [gates])*|
|P-INFERENCE validate controller tools; deny native activity; shut down before export|integrity-bypass|security-critical|Trusted CLI/SDK replacement, not SDK selection; deny `copilot-sdk-completion.mjs:97-98,115-117`; cleanup blocks fallback `run-agent.mjs:629`|*(documented, [providers]; [sdk])*|
|P-GATES ordinary merge needs complete ≤3,000-file inventory, current metadata, fresh live APPROVE/four PASS and successful exact-head required CI|integrity-bypass|security-critical|CI disable `verify-pr-safety.mjs:279,294`; absent-review `:289`; protected/breaking override `:205,255`. Supplied failing gates/dangerous diffs still block; Q2.|*(documented, [gates]; [merge])*|
|P-REVIEW explicit commit_id/exact-head merge; refuse stale/closed heads|integrity-bypass|security-critical|No unbound retry; self-review COMMENT≠approval; `github-io.mjs:101-106,208`, `local\publisher.mjs:63`|*(documented, [gates]; [local-publish])*|
|P-DEPENDENCY independently check selected npm scope/resolution/advisories/original offline tests; exact approved migration plan|bad-data-accepted|security-critical|Existing locks must be updated. Without a source lock, publish only the manifest after temporary offline native-lock verification; source/validation lock remain unchanged. Missing evidence blocks export; other lanes do not inherit. `dependency-work.mjs:186-327`|*(documented, [Independent validation; Migration execution][maintenance])*|
|P-REPO installed GitHub.com/restricted refs; upstream read-only|integrity-bypass|security-critical|Publisher replacement, not GH_HOST/GH_REPO; `github-io.mjs:12-15,182-187`; automation force allowed, tags not|*(documented, [publication])*|
|P-TEXT inert references/HTML/entities/hashes; all fences text; separate plain titles/commits|x-cross-repository-reference-effect|security-critical|Local closing number/confirmed report links active; no rebase; oversize rejected, not truncated; `github-io.mjs:82,123-127`|*(documented, [publication]; [outcomes])*|
|P-RELEASE builds lack registry secrets/OIDC; fresh artifact-only upload executes no source/package|info-leak; integrity-bypass|security-critical|Trusted role/script replacement, not token/provenance choice; `release-artifacts.mjs:17-18,125`|*(documented, [Release lifecycle][releases]; [artifacts])*|
|P-PACKAGE safe metadata/exact name/version/complete expected set; nonexecuting inspection|bad-data-accepted|security-critical|Trusted expected-name override, not artifact authority; `package-identity.py:188-193,227-235,280-304`; upload revalidates|*(documented, [artifacts])*|
|P-TAG existing tag cannot move commits|integrity-bypass|security-critical|Outside-path mutation, not GitHub Release disable; `lights-on-release.yml:176-177`, `local\publisher.mjs:143-151`|*(documented, [Release lifecycle][releases]; [local-publish])*|
|P-EGRESS enforce role/host/method/exact-or-subtree path/grants; public pinned DNS/TLS; no redirects/tunnels|integrity-bypass|security-critical|Custom rules widen public destinations, not capabilities; `local\network\policy.py:94-175`, `local\policy.mjs:100-105`; extra CA retains TLS. Configured request/response/aggregate/count/deadline bounds apply.|*(documented, [network])*|
|P-AUDIT persistence failure stops current/later traffic|integrity-bypass|security-critical|Trusted gateway/storage replacement; no disable key; `local\network\policy.py:46-48,63-68`; not host-wide|*(documented, [network])*|
|P-VALIDATE required profiles/outputs pass; preserve source/exec bits; bind candidate|bad-data-accepted|security-critical|Inadequate operator tests do not waive enforcement; `local\validation.mjs:60`, `local\publisher.mjs:72-73`; deadline includes services/readiness|*(documented, [validation]; [local-publish])*|
|P-GRANTS fresh publisher rechecks code/policy/source/candidate and intersects flags/policy|integrity-bypass|security-critical|Malicious operator, not model; `local\policy.mjs:133-134`, `local\lights-on.mjs:98`; independent publish/merge/release/registry grants|*(documented, [local-publish])*|
|P-DEMO-PREP no acquisition hooks; selected-registry identity/integrity before cache export|bad-data-accepted|security-critical|Committed SHA-512; generated SHA-1 verified/re-pinned at `local\demos\npm\common.mjs:154-155,173-179`; ≤512 versions/128 MiB archives checked post-download|*(documented, [Requirements and limits; Prepare a target][demo])*|
|P-DEMO-LOCK synthetic lock is validation-only, manifest-bound; never replaces source lock|bad-data-accepted|security-critical|Changed source needs preparation; scan refusal `local\demos\npm\run.mjs:14-15`; `local\demos\npm\npm-install.mjs:21-23`|*(documented, [Prepare a target; Validate and scan][demo])*|
|P-DEMO-GRANTS no publication; explicit inference consent|integrity-bypass|security-critical|`--allow-inference` grants charges only; `local\demos\npm\run.mjs:17-27`|*(documented, [Run a documentation agent][demo])*|
|P-PREVIEW no target files/directories/labels changed|wrong-output|correctness-only|Removing dry-run installs; force affects config; source acquisition remains; `install.ps1:234`, `install.sh:251`|*(documented, [Preview before installing][install])*|
|P-DISCOVERY trusted policy/exact publishers; preserve explicit requirements; opt-in local writes|integrity-bypass|security-critical|`--write` applies ready plan, not forced replacement; workflow additions only; `discover-required-checks.mjs:219-224,284`|*(documented, [discovery])*|

`PROP-POLICY-BLOCK` and immediate-stop/guaranteed-CI/all-.github/config-size promises remain retained conflicts, not narrower replacements or disclaimers. Applicable clear violations can remain `VALID`; contradictions mean `MODEL-GAP`. *(inferred, Q4)*

### Worked routing examples

|Sink / required capability|Symptom|Disposition / status|Licensing claim|Provenance|
|---|---|---|---|---|
|Scheduled ledger / ordinary multistage run|Later restore erases already-recorded in-run usage|`VALID`|§1.11 PROP-RATE-LIMIT;§1.7 A03,not D-LEDGER|*(documented, [limits]; [audit])*|
|GitHub body / model-controlled text|Diagram fence activates an external link|`VALID`|§1.11 P-TEXT;not semantic-judgment disclaimer|*(documented, [publication])*|
|Public marker / public reader|Only own nonsecret task/attempt/cooldown fields visible|`KNOWN-NON-FINDING` (`closed`)|§1.15 KNF-PUBLIC-STATE;no credentials/recovery authority|*(documented, [Prior §1.15][prior])*|
|Direct helper / independent executable-callback replacement|Caller-supplied executor performs host actions|`OUT-OF-MODEL: trusted-input` (`escalated`)|§1.7 Shared helpers;§1.1 inferred gate;Q2|*(inferred, Q2)*|

## 1.12 Security properties the project does not provide

Disclaimers cannot waive adjacent positive boundaries. Silence cannot close serious reports.

|ID|Not provided / false friend|Boundary|Tier|Provenance|
|---|---|---|---|---|
|D-JUDGMENT|Review/tests≠semantic/backdoor/injection proof|B/C/D/E; not tool/credential/gate bypass|security-critical|*(documented, [risks])*|
|D-PACKAGE|Identity/hash/provenance≠benevolence|D/E/F; not mismatch/execution waiver|security-critical|*(documented, [artifacts])*|
|D-BILLING|Accounting≠invoice/minute/distributed quota|A/B/E; configured bounds retained|security-critical|*(documented, [usage]; [limits]; [recovery])*|
|D-LEDGER|Cache≠durable global ledger|A eviction/grants; corruption fails closed|correctness-only|*(documented, [audit])*|
|D-TRANSACTION|Publication steps≠transaction|C/D/E partial effects; authorization/validation retained|correctness-only|*(documented, [artifacts]; [local-publish])*|
|D-RECOVERY|Cleanup≠automatic recovery/remote rollback|E inspect crashes; selected inactive run only|correctness-only|*(documented, [recovery])*|
|D-STORAGE|Container/post-download caps≠host disk quota|B/E/F; finite checks retained|security-critical|*(documented, [recovery]; [Requirements and limits][demo])*|
|D-AUDIT|Gateway≠whole-host trace|E/F omissions; P-AUDIT retained|correctness-only|*(documented, [recovery]; [Requirements and limits][demo])*|
|D-STATE-SECRET|Public markers≠secret storage|A/D own nonsecret fields only; not credentials/recovered authority|security-critical|*(documented, [Prior §1.15 state comments not encrypted][prior])*|
|D-YAML|Subset≠YAML1.2 loader|A anchors/tags/aliases/multiline/multidocument; not unsafe parsing/prototype mutation/effects|correctness-only|*(documented, [yaml]; [Prior §1.15 parseSimpleYaml][prior])*|
|D-ANALYSIS|No advisory≠complete SBOM/history/compatibility proof|C supported subsets; one temporary resolved graph does not prove historical installations or all future allowed versions; lane requirements retained|correctness-only|*(documented, [Routine dependency updates; Upstream stewardship][maintenance]; [risks])*|
|D-REMOTE-CHECKS|Local pass≠remote App checks|E real CI still required|security-critical|*(documented, [local-publish])*|
|D-APP-IDENTITY|App≠workflow identity|C/G inspect definitions/server protection|security-critical|*(documented, [gates])*|
|D-DEMO-FORMAT|Demo≠general package-manager acquisition|F supported formats; rejection never waives isolation/integrity|correctness-only|*(documented, [Requirements and limits][demo])*|
|D-DEMO-IMAGES|Cleanup≠image deletion|F persistent images/operator storage|correctness-only|*(documented, [Inspect the result][demo])*|
|D-RELEASE-LAYOUT|Detection≠monorepo/private-registry setup|D explicit builders; fixed destinations retained|correctness-only|*(documented, [artifacts])*|

Prompt injection remains in scope for boundary violations. SSRF, foreign-reference effects, credential theft, unsafe archive reconstruction and approval replay route through P-EGRESS/P-REPO/P-TEXT/P-OFFLINE/P-PACKAGE/P-GATES. *(documented, [network]; [publication]; [release-isolation]; [gates])*

Decompression bombs, ReDoS, depth/cycles and numeric/clock extremes beyond published bounds remain Q11. XML DTD/entities and Ruby objects are rejected, not disclaimed. *(inferred, Q11)*

No replacement disclaimer withdraws old stop/CI/path/classifier guarantees or eliminates supply-chain risk. *(inferred, Q4)*

## 1.13 Downstream responsibilities

|ID|Required action|Provenance|
|---|---|---|
|O-CONTROL|Protect default-branch automation, prompts, policy, command files and overrides. Accept the association policy; never execute PR-head code in a privileged controller.|*(documented, [audit]; [Quick start][local])*|
|O-SOURCE|Supply a clean, secret-free, provider-appropriate checkout. Inspect context paths before disclosure.|*(documented, [source-secrets])*|
|O-HOST|Trust and review host, Docker, images, CLI/SDK and executable collaborators. Stronger support contracts remain Q2.|*(inferred, Q2)*|
|O-CREDENTIALS|Scope provider/GitHub/registry identities separately. Configure package-scoped tokens or trusted publishers; workflow permissions do not limit PATs.|*(documented, [permissions]; [Registry support][releases])*|
|O-COST|Set provider spending caps. Preserve concurrency, reservations and effective cache grants; inspect unknown usage and separate local/Actions ledgers.|*(documented, [limits]; [usage]; [recovery])*|
|O-CI|Protect the default branch; configure exact contexts/publishers/triggers. Retain review/CI gates, verify actual execution and inspect workflow definitions, not App ID alone.|*(documented, [checks]; [gates]; [local-publish])*|
|O-OVERRIDE|Review hold/needs-human and security/compatibility changes. Distinguish author opt-in from protected/breaking overrides; keep sensitive external merge off unless coverage justifies it.|*(documented, [Maintainer controls][operations]; [Prior §1.13 High-Sensitivity Repos][prior])*|
|O-MIGRATE|Approve the committed exact plan, files, replacement evidence and offline commands. Labels or planning issues cannot authorize execution.|*(documented, [Migration execution][maintenance])*|
|O-VALIDATE|Supply every required profile, image/cache, output declaration and synthetic service. Missing/blocked cases fail; passing proves neither semantics nor remote CI.|*(documented, [validation]; [services])*|
|O-RECORDS|Protect state/output/policy/snapshots. Rerun after code/policy/source/candidate changes; writable hashes are not signatures. Never delete publication records to bypass retry refusal.|*(documented, [local-publish]; [recovery])*|
|O-PUBLISH|Grant only intended independent capabilities; intersect flags with policy. Preserve installed-repository writes and read-only upstream access.|*(documented, [local-publish]; [network])*|
|O-RELEASE|Configure trusted expected names, exact committed versions and builders. Enable release only after identity/auth setup; inspect artifacts and partial registry outcomes.|*(documented, [Introduction; Build and upload constraints][releases])*|
|O-RETRY|Inspect confirmed branches/PRs/tags/versions and interrupted runs before retrying. Distinguish proposed, prepared, validated, published and merged outcomes.|*(documented, [outcomes]; [recovery]; [artifacts])*|
|O-STORAGE|Set separate host/VM storage bounds covering downloads, source copies, cache and persistent images.|*(documented, [recovery]; [Requirements and limits][demo])*|
|O-INSTALL|Review source/target/origin and save customizations. Understand replacement/force/label options; inspect preview and discovery proposals before applying them.|*(documented, [Installation side effects; Preview before installing][install]; [discovery])*|
|O-OUTPUT|Encode raw logs/JSON/paths/code/diffs for each consumer. Never execute/render them as instructions or reuse context-specific encoding elsewhere.|*(inferred, Q8)*|
|O-EVIDENCE|Distinguish claims/facts, known/unknown usage, live/synthetic evidence and source/generated locks. Review model authority rather than accepting headings/counts.|*(inferred, Q5)*|

Unresolved support never supplies operator-blame closure; retain ordinary safeguards pending Q2. *(inferred, Q2)*

## 1.14 Known misuse patterns

|ID|Misuse → required boundary|Provenance|
|---|---|---|
|M-FORK-HOST|Privileged fork checkout/execution → data-only controller/offline tests|*(maintainer, 2026-10)*|
|M-BLIND-OVERRIDE|Routine override → inspect exact gate/change|*(documented, [state]; [Maintainer controls][operations])*|
|M-NO-COVERAGE|External merge/model confidence without coverage → independent gates/contexts|*(documented, [Prior §1.14 Without CI Tests][prior]; [merge])*|
|M-SOURCE-SECRET|Checked-in token despite isolation → clean source/context|*(documented, [source-secrets])*|
|M-TRUST-CONFUSION|Controller/SDK called worker → separate executable isolation|*(documented, [providers]; [permissions])*|
|M-SYNTHETIC-AUTHORITY|Generated lock/local pass/model verdict promoted → preserve evidence boundaries|*(documented, [Validate and scan][demo]; [local-publish]; [outcomes])*|
|M-BLIND-RETRY|Deleting records/retrying registries → inspect partial effects|*(documented, [local-publish]; [artifacts])*|
|M-RAW-RENDER|GitHub escaping reused/raw terminal logs → consumer encoding|*(inferred, Q8)*|

`VALID-HARDENING` applies only without a violated claim; never dismiss supported-default defects.

## 1.15 Known non-findings

Exact matches only, subject to §1.17; backtested within these conditions. No new patterns promoted.

|ID/component|Reported symptom|Exact conditions / discharge|Provenance|
|---|---|---|---|
|KNF-PUBLIC-STATE A/D markers|info-leak:unencrypted bookkeeping|Own nonsecret attempt/task/cooldown fields only;no credential/authorization/recovery issue;D-STATE-SECRET|*(documented, [Prior §1.15 state comments not encrypted][prior])*|
|KNF-YAML-SUBSET A parser|wrong-output:full YAML unsupported|Syntax demand only;no dangerous reconstruction/mutation/effects;D-YAML/P-CONFIG|*(documented, [Prior §1.15 parseSimpleYaml][prior]; [yaml])*|
|KNF-EXTERNAL-GATE C gate|wrong-output:external merge refused|Disabled author category/no opt-in;refusal only,not evidence loss/other effects;PROP-EXT-PR-GATE|*(documented, [Prior §1.1 quick-start step 2][prior]; [merge])*|

Broad “prompt injection opens a bad PR” remains an inactive candidate (Q4). Proposed scope: unmerged proposal without credential leak, foreign write/reference effect, unauthorized paid work, protected-path breach or review/CI bypass. Missing evidence cannot license suppression. *(inferred, Q4)*

## 1.16 Conditions that would change this model

Refresh published-version binding/companions after changes to admission, rights, providers/tools/callbacks, accounting/cache, parsers/artifacts, local protocols/grants/validation, acquisition/adoption, dependencies or configurations—especially new endpoints/executable authority. *(inferred, Q5)*

Missing/contradictory routing means `MODEL-GAP` and revision. Provenance-only blockage retains intended disposition as `escalated`; historical versions retain their promises. *(documented, [Prior §1.16 MODEL-GAP][prior])*

## 1.17 Triage dispositions

First supported match in this order; genuine contradictions override mechanical closure.

|Order|Disposition|License|
|---|---|---|
|1|`KNOWN-NON-FINDING`|Exact component/sink/symptom/conditions/authoritative discharge,§1.15|
|2|`OUT-OF-MODEL: unsupported-component`|Explicit exclusion,§1.3;not unread code|
|3|`OUT-OF-MODEL: non-default-build`|Explicit unsupported/dev-only/discouraged exposure,§1.6;not merely nondefault|
|4|`OUT-OF-MODEL: dependency-contract`|Named contract/conformant use/dependency cause,§1.9;not integration misuse|
|5|`OUT-OF-MODEL: trusted-input`|Independent trusted-operand control,§1.7;not data-induced authority|
|6|`OUT-OF-MODEL: adversary-not-in-scope`|Explicit excluded capability,§1.10|
|7|`BY-DESIGN: property-disclaimed`|Exact boundary/tier,§1.12|
|8a|`VALID`|In-scope violation,§§1.7/1.10/1.11|
|8b|`VALID-HARDENING`|No violation;eligible §1.14 misuse,maintainer discretion;not insufficient-evidence rejection|
|9|`MODEL-GAP`|No unique supported route,§1.16|

**All-status closure constraint:** apply §1.1's provenance gate. **Inferred** never closes. **Assumption** only permits listed low-blast-radius provisional routes; never KNF/dependency-contract/security-critical disclaimer. Silence cannot close security-critical reports, KNFs or dependency-contract even if documented. Missing disclaimer tiers escalate. Clear violations remain `VALID`; narrowing old promises/historically fixed classes needs explicit authority.

`closed` requires authoritative supported closure; `provisional` cites open Q-ID/reopens on challenge; `escalated` sends intended route/blocking Q-ID to maintainers. Every OUT-OF-MODEL/BY-DESIGN/KNOWN-NON-FINDING gets a status; VALID/MODEL-GAP do not. Acceptance requires no inferred/assumption tags and explicit sign-off.

### Legacy compatibility, not runtime migration

|Legacy|Canonical condition|
|---|---|
|VULNERABILITY/CONFIRM|VALID only with violation|
|HARDENING/NEEDS-INFO|Eligible VALID-HARDENING only|
|MODEL-GAP/ESCALATE-MAINTAINER|Gap versus provenance-only escalated route|
|BY-DESIGN/CLOSE-ASSUMPTION/CLOSE-DISCLAIMED|Actual trusted-input/adversary/disclaimer route plus gate|
|NON-FINDING/CLOSE-KNOWN|Exact authoritative KNF|
|OUT-OF-SCOPE|Specific OUT-OF-MODEL subtype|

Prior orderings conflicted. This crosswalk changes no runtime enums/prompts/inspectors/configuration enforcement; headings/intent do not implement routing. *(inferred, Q5)*

## 1.18 Open questions for the maintainers

All unanswered; Q-I01–Q-I12 map respectively to Q1–Q12. Historical Q1/Q2 below are not current answers.

- **Q1** — Proposed answer: retain seven families and unread code; supported Actions/local paths have documented contracts. Independently confirm helper/standalone/probe/non-npm/rewrite contracts; tests remain nonnormative unless declared otherwise. (§§1.2–1.4/1.7/1.10)
- **Q2** — Proposed answer: classify each disabled gate/opt-in/label/custom controller/image/rule/host/release flag/helper option/endpoint/PATH/callback exposure separately. Preserve supported nondefaults and ordinary gates; choose conditional guarantees or explicit bounded limits, never defaultness-based exclusions. (§§1.5–1.7/1.11–1.14/1.17)
- **Q3** — Proposed answer: retain §1.5 effects/preview boundary. Confirm installer source/target topology/POSIX branch fallback. Apply scoped locale/FPU/umask observation only to eligible relaxed provisional routes; dependency effects remain open. (§§1.5/1.7–1.9/1.13)
- **Q4** — Proposed answer: obtain dated retention/correction/prospective narrowing for stop/CI/all-.github/config-size/unknown-key/classifier/host-egress/risk-elimination conflicts. Keep broad bad-PR KNF inactive pending exact §1.15 ruling/backtest; no retroactive withdrawal. (§§1.5–1.7/1.11–1.12/1.15/1.17/appendix)
- **Q5** — Proposed answer: retain uppercase prose > YAML > JSON, relaxed floors, canonical precedence and prose crosswalk; generated headings/skills/intent cannot ratify. Confirm semantic-validation extensions and final acceptance explicitly. (§§1.1/1.8–1.9/1.15–1.19)
- **Q6** — Proposed answer: retain documented gateway guarantees; confirm rule order/overlap/query/headers/framing/Copilot forwarding/issued-handle lifetime, or precise narrower protocols—not blanket egress disclaimer. (§§1.4–1.8/1.11–1.12)
- **Q7** — Proposed answer: retain profiles/source/exec-bit/remote-CI/no-acquisition-hooks/no-demo-publication/generated-lock boundaries. Confirm offline PR-head versus trusted-config split and concurrent-mutation conditions. (§§1.6–1.8/1.11–1.14)
- **Q8** — Proposed answer: retain publication encoding/recognized-secret redaction/package checks; raw logs/JSON/diffs/code stay tainted. Confirm stronger encoders/archive acceptance or bounded limits without waiving credentialed boundaries. (§§1.7–1.9/1.11–1.13)
- **Q9** — Proposed answer: retain enumerated dependencies; require named contracts/conformant use/actual upstream cause. Confirm bundled-version remediation ownership; built-ins/hashes/pins never eliminate risk. (§§1.5/1.9/1.11–1.12/1.17)
- **Q10** — Proposed answer: retain no unfinished export/host fallback, partial effects and manual inspection. Specify cross-write/settlement/callback/install/preparation/helper-sharing/response-loss rollback or bounded correctness limits. Never classify leaks/unauthorized writes/failed gates as acceptable partial failure. (§§1.5/1.7–1.8/1.11–1.13)
- **Q11** — Proposed answer: retain published caps; confirm candidate/archive expansion/output/numeric/version/time/skew/recursion/cycle/parser/helper thresholds and failure modes. No implicit total CPU/heap/disk/arbitrary-precision/distributed-clock guarantee; never waive published limits. (§§1.7/1.11–1.13)
- **Q12** — Proposed answer: author-qualified bookkeeping never approves; protect storage/cache provenance and separate ledgers/unknown costs. Confirm recovered fields/replay/merge/clock/allocation/direct-object contracts without expanding historical author-check authority. (§§1.5/1.7–1.8/1.11–1.13)

## 1.19 Machine-readable companions

Uppercase prose remains canonical. Generated YAML (`threat-model-sidecar/v2`, exact prose SHA-256) and JSON (`schema.json`) must be regenerated after changes; prose > YAML > JSON. *(documented, [Prior §1.19 Authority Order and Configured Path][prior])*

JSON lacks policy/precedence/tiers/exact binding and is not a triage input. Baseline backtesting completed with owned gaps; full integration backtesting and acceptance remain pending. The installed official validator's known limitation is `SC.prose-version`, which hard-codes lowercase `threat-model.md`. The required uppercase filename and exact-byte hash must be checked independently; this does not claim an all-green official gate. The validator was not modified.

## Appendix — prior security-policy back-map

All 113 old claims remain mapped. Locators address the [bound prior model][prior], not this draft. Conflicts mean no authorized withdrawal; historical tags do not expand ratification. The old confidence/all-resolved assertions are historical only.

|Exact old locator / claim|New mapping|Provenance|
|---|---|---|
|§1.1 project/installed Actions repository|§§1.1–1.2|*(documented, [Prior §1.1][prior])*|
|§1.1 v1 identifies modeled version|§1.1 configuration-only v1|*(documented, [Prior §1.1][prior])*|
|§1.1 date 2026-10-16|Historical date|*(documented, [Prior §1.1][prior])*|
|§1.1 generator/schema and sections 1.1–1.19|§§1.1/1.19|*(documented, [Prior §1.1][prior])*|
|§1.1 relaxed triage|§§1.1/1.17|*(documented, [Prior §1.1][prior])*|
|§1.1 confidence 36/14/0|Historical only;Q12 inconsistency|*(documented, [Prior §1.1][prior])*|
|Quick-start upstream infrastructure exclusion|S-PLATFORM/S-PROVIDER|*(documented, [Prior §1.1 quick-start step 1][prior])*|
|Quick-start unmerged PR/missing external auto-merge non-finding|KNF-EXTERNAL-GATE/PROP-EXT-PR-GATE/Q4|*(documented, [Prior §1.1 quick-start step 2][prior])*|
|Quick-start issue/PR/comment/fork input untrusted|§1.7/ADV-EVENT/ADV-PR|*(documented, [Prior §1.1 quick-start step 3][prior])*|
|Quick-start shell/workflow/merge boundary breach valid|PROP-SHELL-SAFE/P-EXPORT/P-GATES|*(documented, [Prior §1.1 quick-start step 3][prior])*|
|Quick-start compromised maintainer/config by design|ADV-OPERATOR|*(documented, [Prior §1.1 quick-start step 3][prior])*|
|Quick-start hardening/no-route gap|§§1.14/1.16–1.17|*(documented, [Prior §1.1 quick-start step 4][prior])*|
|§1.2 Actions-native autonomous maintenance|A–G;no daemon|*(documented, [Prior §1.2 opening][prior])*|
|§1.2 threat-model lifecycle/enforcement|C07/C08/Q5|*(documented, [Prior §1.2 capability 1][prior])*|
|§1.2 issue triage/closure/tested fix proposals|A–D/Q5|*(documented, [Prior §1.2 capability 2][prior])*|
|§1.2 dependency intelligence/replacement|C01–C04/P-DEPENDENCY/O-MIGRATE|*(documented, [Prior §1.2 capability 3][prior])*|
|§1.2 independent human/agent PR review|C09/P-READONLY/P-GATES/P-REVIEW|*(documented, [Prior §1.2 capability 4][prior])*|
|§1.2 CI/review/all listed policies before auto-merge|P-GATES/Q4|*(documented, [Prior §1.2 capability 5][prior])*|
|§1.2 external auto-merge off by default|PROP-EXT-PR-GATE|*(documented, [Prior §1.2 capability 5][prior])*|
|§1.2 cache/labels/markers/slash state|A04/A06–A08/P-STATE|*(documented, [Prior §1.2 capability 6][prior])*|
|config-loader component|A05/P-CONFIG|*(documented, [Prior §1.2 component table][prior])*|
|state-store component|A06–A08/P-STATE|*(documented, [Prior §1.2 component table][prior])*|
|ecosystem-intel component|C01/DEP-OSV/DEP-ECOSYSTEMS|*(documented, [Prior §1.2 component table][prior])*|
|safety-guard component|C07/C09/Q5|*(documented, [Prior §1.2 component table][prior])*|
|release-engine component|D06–D10/P-RELEASE/P-PACKAGE/P-TAG|*(documented, [Prior §1.2 component table][prior])*|
|agent-runner component|B01–B09/P-OFFLINE/P-INFERENCE|*(documented, [Prior §1.2 component table][prior])*|
|dependency-stages component|C02–C04|*(documented, [Prior §1.2 component table][prior])*|
|toolchain-maintenance component|C05/§1.6|*(documented, [Prior §1.2 component table][prior])*|
|workflows component/least-privilege grants|A/D/§1.4|*(documented, [Prior §1.2 workflows row][prior])*|
|§1.3 upstream API availability/correctness|S-PROVIDER/D-JUDGMENT|*(documented, [Prior §1.3][prior])*|
|§1.3 Actions hypervisor/control-plane exclusion|S-PLATFORM|*(maintainer, 2026-10)*|
|§1.3 no subtle-backdoor guarantee even with external opt-in|D-JUDGMENT/P-GATES|*(documented, [Prior §1.3][prior])*|
|§1.3 no external secret rotation/vault/audit|S-SECRET-OPS|*(maintainer, 2026-10)*|
|§1.4 event enable/association/data-only boundary|A01/PROP-SHELL-SAFE/PROP-SLASH-AUTHZ/Q4|*(documented, [Prior §1.4 diagram][prior])*|
|§1.4 inference auth controller, commands offline, candidate checks|§1.4/P-INFERENCE/P-OFFLINE/P-EXPORT|*(documented, [Prior §1.4 diagram][prior])*|
|§1.4 review/CI/protected/external gates|P-GATES/PROP-EXT-PR-GATE/Q4|*(documented, [Prior §1.4 diagram][prior])*|
|§1.4 public issue/PR reachability|ADV-EVENT/ADV-PR|*(maintainer, 2026-10)*|
|§1.4 slash association precondition|PROP-SLASH-AUTHZ|*(documented, [Prior §1.4 Reachability Preconditions][prior])*|
|§1.4 automerge mode/checks/policies/override precondition|§1.6/P-GATES/Q4|*(documented, [Prior §1.4 Reachability Preconditions][prior])*|
|§1.5 trusted ephemeral host/Docker/worker restrictions|S-HOST/O-HOST/P-OFFLINE|*(documented, [Prior §1.5 Runner Integrity][prior])*|
|§1.5 build identity absent/fresh registry-scoped uploader|P-RELEASE/P-PACKAGE/O-CREDENTIALS|*(documented, [Prior §1.5 Release Build Isolation][prior])*|
|§1.5 routine manifest/lock scope, fresh offline tests, missing evidence blocks|P-DEPENDENCY|*(documented, [Prior §1.5 Dependency Candidate Validation][prior])*|
|§1.5 read-only planning/approved migration/no semantic proof|P-READONLY/O-MIGRATE/D-JUDGMENT|*(documented, [Prior §1.5 Dependency Candidate Validation][prior])*|
|§1.5 private CLI/SDK telemetry counted once, unknown not zero/USD|§1.8/DEP-SDK/D-BILLING/Q12|*(documented, [Prior §1.5 Usage Accounting][prior])*|
|§1.5 admission/reservations/shared accounting/call bounds|PROP-RATE-LIMIT/O-COST|*(documented, [Prior §1.5 Paid-Event Admission and Reservations][prior])*|
|§1.5 no durable/global invoice cap|D-BILLING/D-LEDGER|*(documented, [Prior §1.5 Usage Accounting and Reservations][prior])*|
|§1.5 package internal identity from trusted names/exact version|P-PACKAGE|*(documented, [Prior §1.5 Distribution Identity][prior])*|
|§1.5 fork pull_request read-only token/no repository secrets|Ordinary fork event only,not pull_request_target/step isolation|*(maintainer, 2026-10)*|
|§1.5 filesystem only checkout/GITHUB_OUTPUT/state|Conflict Q3/Q4;§1.5|*(documented, [Prior §1.5 No-Surprise inventory][prior])*|
|§1.5 installed-repo writes/upstream reads/no worker Git metadata|P-REPO/P-OFFLINE|*(documented, [Prior §1.5 Installed-Repository Write Boundary][prior])*|
|§1.5 GitHub.com target binding/Enterprise unsupported|P-REPO/S-GH-HOST|*(documented, [Prior §1.5 Host and Content Publication Boundary][prior])*|
|§1.5 restricted Markdown/inert references/entities/HTML/hashes|P-TEXT|*(documented, [Prior §1.5 Host and Content Publication Boundary][prior])*|
|§1.5 text-only fences/no Mermaid/math enrichment|P-TEXT|*(documented, [Prior §1.5 Host and Content Publication Boundary][prior])*|
|§1.5 separate title/commit handling/local close exception/no rebase|P-TEXT|*(documented, [Prior §1.5 Host and Content Publication Boundary][prior])*|
|§1.5 four-category runner egress restriction|Historical conflict Q3/Q4,not local/preparation expansion|*(maintainer, 2026-10)*|
|§1.6 disabling false/0 immediately halts all runs|Conflict Q4;§1.6|*(documented, [Prior §1.6 enable row][prior])*|
|§1.6 review-only blocks all auto-merges|§1.6/P-GATES|*(documented, [Prior §1.6 mode row][prior])*|
|§1.6 external opt-in / agent opt-out author categories|PROP-EXT-PR-GATE/§1.6|*(documented, [Prior §1.6 author rows][prior])*|
|§1.6 independent-review disabling effect|P-GATES/Q2|*(documented, [Prior §1.6 review row][prior])*|
|§1.6 exact required checks/Apps/legacy null, all observed successful|P-GATES/O-CI;empty blocks|*(documented, [Prior §1.6 required_checks row][prior])*|
|§1.6 reviewed sandbox image does not grant network/credentials|P-OFFLINE/O-HOST|*(documented, [Prior §1.6 sandbox row][prior])*|
|§1.6 committed migration approval only, protected files excluded|P-DEPENDENCY/O-MIGRATE|*(documented, [Prior §1.6 migrations row][prior])*|
|§1.6 toolchain opt-in/active-LTS coverage/hold/no public-policy change|C05/§1.6/O-OVERRIDE|*(documented, [Prior §1.6 toolchains row][prior])*|
|§1.6 triage setting changes automatic closure|Q5/§1.6 intent conflict|*(documented, [Prior §1.6 triage row][prior])*|
|§1.7 trusted YAML pure parsing/no eval/prototype pollution|A05/P-CONFIG/Q2|*(documented, [Prior §1.7 config input][prior])*|
|§1.7 trusted normalized repository variables|A05/§1.6|*(documented, [Prior §1.7 variable input][prior])*|
|§1.7 issue text data-only|PROP-SHELL-SAFE|*(maintainer, 2026-10)*|
|§1.7 slash text authorized by association|A01/PROP-SLASH-AUTHZ|*(documented, [Prior §1.7 slash input][prior])*|
|§1.7 marker JSON/dangerous-key filtering/trusted authors|A07/P-STATE/Q12|*(documented, [Prior §1.7 marker input][prior])*|
|§1.7 no reused approvals/complete ≤3,000 files|P-GATES/P-STATE/P-REVIEW|*(documented, [Prior §1.7 prior approval input][prior])*|
|§1.7 model label delimiter/protected-label filtering|B06/P-STATE/O-OVERRIDE|*(documented, [Prior §1.7 label input][prior])*|
|§1.7 full .github/.claude/model/install protected paths|Conflict Q4/P-EXPORT|*(documented, [Prior §1.7 external PR input][prior])*|
|§1.7 intelligence data/timeouts/name/version validation before CLI|C01/D07/Q1/Q11;historical Q1 below|*(documented, [Prior §1.7 API input][prior])*|
|§1.7 config <64 KB/subset/UTF-8/known keys|P-CONFIG;size/unknown-key conflict Q4/Q11|*(documented, [Prior §1.7 matrix config row][prior])*|
|§1.7 GitHub 65,536-character Markdown input limit|Historical platform assertion;not byte cap;Q11|*(documented, [Prior §1.7 matrix issue row][prior])*|
|§1.7 single-line slash format/association|A01/PROP-SLASH-AUTHZ|*(documented, [Prior §1.7 matrix slash row][prior])*|
|§1.8 single-line GITHUB_OUTPUT fields|§1.8 config|*(documented, [Prior §1.8 GitHub Output Variables][prior])*|
|§1.8 marker removal/angle escape/controlled replacement/no approval reuse|P-STATE/P-TEXT/§1.8|*(documented, [Prior §1.8 State Comment Markers][prior])*|
|§1.8 proposal branches/PRs rather than default push|P-REPO/P-GRANTS|*(documented, [Prior §1.8 Agent-Generated Pull Requests][prior])*|
|§1.8 guaranteed CI and lights-on-pr-gate.yml inspection|Conflict Q4;actual lights-on-pr.yml,token suppression/local non-dispatch|*(documented, [Prior §1.8 Agent-Generated Pull Requests][prior])*|
|§1.9 built-ins eliminate config/state supply-chain risk|Conflict DEP-NODE/Q4/Q9|*(documented, [Prior §1.9 Zero Runtime NPM Dependencies][prior])*|
|§1.9 trusted Node/Git/gh/Docker/CLI/SDK and inference APIs|§1.9|*(documented, [Prior §1.9 External CLIs and Action Runners][prior])*|
|§1.9 OSV/ecosyste.ms dependencies|DEP-OSV/DEP-ECOSYSTEMS|*(documented, [Prior §1.9 External Intelligence APIs][prior])*|
|§1.10 prompt injector|ADV-EVENT/ADV-MODEL|*(documented, [Prior §1.10 actor 1][prior])*|
|§1.10 unauthorized slash caller|ADV-EVENT/PROP-SLASH-AUTHZ|*(documented, [Prior §1.10 actor 2][prior])*|
|§1.10 malicious external PR author|ADV-PR/P-GATES/Q4|*(documented, [Prior §1.10 actor 3][prior])*|
|§1.10 denial-of-wallet actor|§1.10/PROP-RATE-LIMIT/D-BILLING|*(documented, [Prior §1.10 actor 4][prior])*|
|§1.11 PROP-SHELL-SAFE|Same historical scope|*(maintainer, 2026-10)*|
|§1.11 PROP-SLASH-AUTHZ|Same ID|*(documented, [Prior §1.11][prior])*|
|§1.11 PROP-EXT-PR-GATE/exact-head formal review|PROP-EXT-PR-GATE/P-REVIEW|*(documented, [Prior §1.11][prior])*|
|§1.11 PROP-POLICY-BLOCK broad dependency/API/model checks/override|Retained conflict Q4;not replaced by P-GATES|*(documented, [Prior §1.11][prior])*|
|§1.11 PROP-RATE-LIMIT and no global max_prs/invoice guarantee|PROP-RATE-LIMIT/D-BILLING|*(documented, [Prior §1.11][prior])*|
|§1.12 no immunity to malicious maintainer commits|ADV-OPERATOR|*(documented, [Prior §1.12][prior])*|
|§1.12 no subtle logic-bug detection guarantee|D-JUDGMENT|*(documented, [Prior §1.12][prior])*|
|§1.12 unsigned markers affect only own attempts/cooldowns|Old inference≠ratification;P-STATE/Q12|*(documented, [Prior §1.12 Cryptographic Attestation][prior])*|
|§1.13 default-branch protection|O-CI|*(maintainer, 2026-10)*|
|§1.13 external merge off for sensitive repos|O-OVERRIDE/M-NO-COVERAGE|*(documented, [Prior §1.13][prior])*|
|§1.13 scoped provider tokens/spending limits|O-CREDENTIALS/O-COST|*(documented, [Prior §1.13][prior])*|
|§1.13 needs-human review before override|O-OVERRIDE|*(documented, [Prior §1.13][prior])*|
|§1.14 external auto-merge without CI misuse|M-NO-COVERAGE|*(documented, [Prior §1.14][prior])*|
|§1.14 privileged pull_request_target/fork checkout misuse|M-FORK-HOST|*(maintainer, 2026-10)*|
|§1.14 blind override misuse|M-BLIND-OVERRIDE|*(documented, [Prior §1.14][prior])*|
|§1.15 bad-PR prompt injection contained by gates|Inactive candidate/Q4|*(documented, [Prior §1.15 item 1][prior])*|
|§1.15 public marker non-encryption|KNF-PUBLIC-STATE/D-STATE-SECRET|*(documented, [Prior §1.15 item 2][prior])*|
|§1.15 limited YAML non-finding|KNF-YAML-SUBSET/D-YAML|*(documented, [Prior §1.15 item 3][prior])*|
|§1.16 secret-bearing execution change trigger|§1.16|*(documented, [Prior §1.16][prior])*|
|§1.16 new endpoint/registry trigger|§1.16|*(documented, [Prior §1.16][prior])*|
|§1.16 MODEL-GAP update trigger|§§1.16–1.17|*(documented, [Prior §1.16][prior])*|
|§1.17 legacy dispositions/order/actions|§1.17/Q5;runtime unchanged|*(documented, [Prior §1.17][prior])*|
|§1.18 all initial questions ratified|Historical only;Q1–Q12 unanswered|*(documented, [Prior §1.18][prior])*|
|Historical Q1, resolved 2026-10-16|Recorded: SAFE_PKG_NAME_REGEX/SAFE_SEMVER_REGEX strictly validate names/versions before any CLI. Original scope retained,not expanded/withdrawn;Q1/Q11.|*(maintainer, 2026-10)*|
|Historical Q2, resolved 2026-10-16|Recorded: recovery/PR safety enforce isTrustedStateAuthor() for github-actions[bot]/OWNER/MEMBER/COLLABORATOR markers. Not approval reuse/all-field ratification;Q12.|*(maintainer, 2026-10)*|
|§1.19 uppercase configured prose and companion authority|§1.19|*(documented, [Prior §1.19][prior])*|

[revision]: https://github.com/scovetta/lights-on/commit/5f8b3c062a90feef367cc0683e41cb4e8785c248
[prior]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/THREAT_MODEL.md
[architecture]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md
[permissions]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#workflow-token-permissions
[providers]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#provider-integration
[candidate]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#candidate-and-command-isolation
[publication]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#github-publication-boundary
[source-secrets]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#check-source-files-for-secrets
[audit]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#workflow-audit-decisions
[gates]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#deterministic-pr-gates
[risks]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#remaining-risks
[state]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#state-and-authorization
[release-isolation]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/architecture.md#release-isolation
[config]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md
[yaml]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#use-the-supported-yaml-subset
[sdk]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#copilot-sdk-backend
[admission]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#paid-event-admission
[merge]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#merge-policy
[checks]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#required-ci-checks
[discovery]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#discover-required-checks
[limits]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#usage-and-rate-limits
[intent]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/configuration.md#upstream-threat-model-and-dependency-health-settings
[maintenance]: https://github.com/scovetta/lights-on/blob/5f8b3c062a90feef367cc0683e41cb4e8785c248/docs/maintenance.md
[operations]: https://github.com/scovetta/lights-on/blob/5f8b3c062a90feef367cc0683e41cb4e8785c248/docs/operations.md
[stop]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/operations.md#stop-new-work
[usage]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/operations.md#usage-and-cost
[outcomes]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/operations.md#read-run-outcomes
[releases]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/releases.md
[artifacts]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/releases.md#build-and-upload-constraints
[local]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md
[network]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md#network-policy-and-audit
[validation]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md#arbitrary-ci-tools-offline
[services]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md#databases-and-other-test-services
[local-publish]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md#publication-and-real-github-ci
[recovery]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/local-container.md#results-state-and-recovery
[demo]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/local/demos/npm/README.md
[install]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/docs/getting-started.md
[web]: https://github.com/scovetta/lights-on/blob/abf1125826227badca1977b8389efc9b599814d9/web/README.md
