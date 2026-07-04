<!--
  GENERATED FILE — do not edit by hand.
  Source of truth: packages/contracts/schemas/*.json
  Regenerate with: node packages/contracts/tools/generate-spec.mjs --write
  The TestSpecDocFreshness gate fails CI if this file drifts from the schemas.
-->

# Mission Control Contract Specification

**Contract surface version (schemaVersion): 10**  
**Approval document version (approvalSchemaVersion): 2**

This is the versioned, **vendor-neutral** specification of the data shapes that cross the boundary between the oversight dashboard (the window) and the opt-in control-plane rails. The dashboard does not import the rails as a library — it shells out to the control-plane CLI (`harness status --json`) and reads/writes the approval, fleet, pipeline and audit documents described below. These schemas are the single source of truth; this document is generated from them so it can never silently drift.

The spec is deliberately vendor-neutral: it describes an integration surface any tool can build to, not a single agent vendor. See `docs/adr/0005-moat-and-surface-strategy.md` — the versioned vendor-neutral contract is the surviving moat artifact.

## Versioning

- `schemaVersion` versions the contract surface as a whole. The single canonical source is `packages/contracts/schema-version.json`; both the JS package and the Python harness derive their numbers from it (a cross-language parity test fails CI on a one-sided change). The per-version timeline lives in `packages/contracts/CHANGELOG.md`.
- `approvalSchemaVersion` is a separate, independently-versioned concept: the per-document `schemaVersion` integer stamped into the approval-request / approval-decision files.

## Schemas

### HarnessStatus

- **Schema file:** `schemas/harness-status.schema.json`
- **\$id:** `https://mission-control.dev/schemas/harness-status.schema.json`
- **Top-level type:** `object`
- **Extensibility:** permissive (`additionalProperties: true` — extra fields allowed)
- **Required:** `project`, `pipeline`

Output of `harness status --json`, shelled out by the cockpit. Permissive on purpose: older installed harnesses may emit fewer fields.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `project` | object | yes |  |
| `stack` | object | no |  |
| `pipeline` | object | yes |  |
| `plans` | object | no |  |
| `missions` | object | no |  |
| `readiness_overall` | object | no |  |
| `next` | object | no |  |
| `phases` | array | no | Ordered phases of the ACTIVE pipeline definition (pipeline.active resolved through the harness pipeline loader). Absent when no active pipeline definition can be loaded. Each phase is the canonical phase-contract shape (see pipeline-phase schema); a permissive subset is described here. |
| `transitions` | object | no | Phase-transition rules copied verbatim from pipeline-state.yml (allowed_transitions / blocked_transitions). Keys are omitted when their source key is absent. |
| `guardrails` | object | no | Summary of which guardrail config files exist and their shape (counts + names, not full policy dumps). Each sub-object is always present with a boolean `present`; details appear only when the config file exists. |
| `budget` | object | no | Run cost ceiling + spend for the active harness loop ledger. Omitted entirely when no cost policy and no ledger exist (cost tracking is opt-in). |
| `gates` | object | no | Classification of every gate name referenced by the active pipeline's phases. auto=true when the gate name is in the harness gate registry and is not a human-approval gate; auto=false for human-approval gates and names not in the registry. Absent when no active pipeline definition can be loaded. |


### HarnessScaffoldResult

- **Schema file:** `schemas/harness-scaffold.schema.json`
- **\$id:** `https://mission-control.dev/schemas/harness-scaffold.schema.json`
- **Top-level type:** `object`
- **Extensibility:** permissive (`additionalProperties: true` — extra fields allowed)
- **Required:** `ok`

Output of `harness scaffold <mode> --json`, shelled out by the cockpit's POST /api/harness/create. A single object: ok:true on success (carrying the new project's mode/stage/phase and the list of created files), or ok:false on a refusal/error (carrying a machine-readable error code). The canonical mode set lives in the CLI (packages/harness/tools/harness VALID_MODES) — keep this enum in sync.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `ok` | boolean | yes |  |
| `root` | string | no | Absolute path of the scaffolded project root. |
| `mode` | enum("idea-to-mvp" \| "mvp-sketch" \| "existing-repo-retrofit" \| "feature-development" \| "bugfix" \| "refactor" \| "release-readiness") | no |  |
| `stage` | string | no |  |
| `phase` | string | no |  |
| `created` | array | no | Project-relative (POSIX) paths created by the scaffold. |
| `error` | enum("invalid_mode" \| "no_target" \| "already_initialized" \| "pipeline_missing") | no |  |
| `message` | string | no |  |


### ApprovalRequest

- **Schema file:** `schemas/approval-request.schema.json`
- **\$id:** `https://mission-control.dev/schemas/approval-request.schema.json`
- **Top-level type:** `object`
- **Extensibility:** closed (`additionalProperties: false` — unknown fields rejected)
- **Required:** `id`, `schemaVersion`, `projectPath`, `riskLevel`, `commandHash`, `requestedAt`

File the harness hook writes to .harness/approvals/pending/<uuid>.json when a command needs human approval.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `schemaVersion` | integer | yes |  |
| `projectPath` | string | yes |  |
| `tool` | string | no |  |
| `command` | string | no |  |
| `matchedPattern` | string | no |  |
| `riskLevel` | enum("SAFE_READONLY" \| "CODE_EXECUTION" \| "DESTRUCTIVE" \| "REQUIRES_REVIEW") | yes |  |
| `commandHash` | string | yes |  |
| `sessionId` | string | no |  |
| `requestedAt` | string | yes |  |


### ApprovalDecision

- **Schema file:** `schemas/approval-decision.schema.json`
- **\$id:** `https://mission-control.dev/schemas/approval-decision.schema.json`
- **Top-level type:** `object`
- **Extensibility:** closed (`additionalProperties: false` — unknown fields rejected)
- **Required:** `id`, `schemaVersion`, `decision`, `approver`, `commandHash`, `decidedAt`

File written to .harness/approvals/decided/<uuid>.json. commandHash MUST equal the matching request's commandHash so a stale or replayed decision cannot unblock a different command.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes |  |
| `schemaVersion` | integer | yes |  |
| `decision` | enum("allow" \| "deny") | yes |  |
| `approver` | string | yes |  |
| `commandHash` | string | yes |  |
| `decidedAt` | string | yes |  |
| `reason` | string | no |  |


### FleetRun

- **Schema file:** `schemas/fleet-run.schema.json`
- **\$id:** `https://mission-control.dev/schemas/fleet-run.schema.json`
- **Top-level type:** `object`
- **Extensibility:** permissive (`additionalProperties: true` — extra fields allowed)
- **Required:** `id`, `goal`, `status`, `children`

One Fleet meta-orchestrator run, persisted by the cockpit at apps/cockpit/server/data/fleet/<id>.json via atomicWriteJson and emitted (summarised) on the SSE fleet_update event. A goal fans out to N governed child sessions (each in its own git worktree/branch) and fans back in to one synthesis session. Permissive on purpose (additionalProperties:true, few required) so the shape can grow and so a future migration onto the Workflow engine does not break older persisted runs.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Filesystem-safe run id: slugify(goal) + ISO timestamp. |
| `goal` | string | yes |  |
| `createdAt` | string | no |  |
| `updatedAt` | string | no |  |
| `status` | string | yes | Derived run status. Canonical values: pending \| running \| partial \| succeeded \| failed \| cancelled \| budget_exceeded \| orphaned. budget_exceeded means a running cost total crossed policy.budgetUsd and no further children were spawned (in-flight children were allowed to finish). orphaned is a TERMINAL state set by the boot reconciler (reconcileFleetRuns) when a server restart left a run in a non-terminal status whose live process/lifecycle is gone: the run can never settle itself, so it is honestly closed as orphaned rather than left wedged at 'running'. Kept a free string (not an enum) so the shape can grow without breaking validation. |
| `spentUsd` | number | no | Running total USD across ALL children that report a cost (workers + verifiers + synthesis), summed from each child.cost.totalCost (missing/null treated as 0). Recomputed on every cost movement. |
| `budgetRemaining` | number \| null | no | max(0, policy.budgetUsd - spentUsd) when a budget is set, else null. Stored for the UI budget bar. |
| `policy` | object | no |  |
| `children` | array | yes |  |
| `synthesis` | object \| null | no |  |


### FleetTemplate

- **Schema file:** `schemas/fleet-template.schema.json`
- **\$id:** `https://mission-control.dev/schemas/fleet-template.schema.json`
- **Top-level type:** `object`
- **Extensibility:** permissive (`additionalProperties: true` — extra fields allowed)
- **Required:** `name`, `goal`, `children`

A saved, repeatable Fleet config (goal shape + child set + policy), persisted by the cockpit at apps/cockpit/server/data/fleet-templates/<name>.json via atomicWriteJson. Implements the dynamic-workflows 'SAVE WORKING WORKFLOWS' rule so a good fleet config is not retyped. A template is a request-construction convenience: POST /api/fleet { template: name } loads it and starts a run, the same lifecycle as an inline start. Permissive on purpose (additionalProperties:true).

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `name` | string | yes | Filesystem-safe template name (letters, digits, underscores, hyphens). Used as the on-disk filename and traversal-guarded. |
| `goal` | string | yes |  |
| `createdAt` | string | no |  |
| `updatedAt` | string | no |  |
| `children` | array | yes |  |
| `policy` | object | no |  |


### PipelinePhase

- **Schema file:** `schemas/pipeline-phase.schema.json`
- **\$id:** `https://mission-control.dev/schemas/pipeline-phase.schema.json`
- **Top-level type:** `object`
- **Extensibility:** closed (`additionalProperties: false` — unknown fields rejected)
- **Required:** `id`, `agent`

The canonical phase-contract object (ADR-0006). A pipeline is ordered phases; each phase carries its id, the agent and (optionally) the model tier that run it, the gate set that must pass, its fan-out strategy (single\|fleet), and the original goal it serves. Fleet is a phase strategy; a Workflow is a degenerate single-phase pipeline compiled to this same shape. Phase 2 makes this the CONSUMED spine: it validates real authored pipeline YAML, so only id and agent are hard-required; gate/tier/strategy/goal and the authored fields (description/inputs/outputs/rules/checks/loop/no_gate_reason/no_outputs_reason) are optional — the harness loader (harness_core/pipelines.py::pipeline_phases) materializes their canonical defaults (strategy=single, goal carried from the pipeline, empty gate) at load time and model_tiers.py resolves the model. A gateless phase documents itself with no_gate_reason. additionalProperties stays false so a typo in a known field is still rejected.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `id` | string | yes | Stable phase identifier, unique within a pipeline. |
| `agent` | string | yes | The agent/role that executes this phase. |
| `tier` | string | no | Optional model tier for this phase (resolved by harness_core/model_tiers.py, e.g. 'planning', 'implementation', 'review'). When omitted the harness resolves a default tier. |
| `model` | string | no | Optional explicit model id, overriding the tier when a concrete model is pinned. |
| `gate` | object | no | The gate set that must pass before this phase is allowed to proceed/hand off. |
| `strategy` | enum("single" \| "fleet") | no | Fan-out strategy: a single agent, or a Fleet of worktree-isolated workers. Optional in authored YAML; defaults to 'single' at load time. |
| `goal` | string | no | The original goal this phase serves (carried through for goal-alignment checks). Optional in authored YAML; the loader carries the pipeline description/goal into each phase when omitted. |
| `description` | string | no | Human-authored description of what this phase does. |
| `inputs` | array | no | Authored list of input artifacts/paths this phase reads. |
| `outputs` | array | no | Authored list of output artifacts/paths this phase produces. |
| `rules` | array | no | Authored ordered heuristics/policies the agent applies during this phase. |
| `checks` | array | no | Authored list of things this phase inspects/looks for (e.g. retrospective signals). |
| `loop` | object | no | Marks this phase as delegating to a sub-pipeline (a nested loop). |
| `no_outputs_reason` | string | no | Documented reason a phase legitimately produces no outputs. |
| `no_gate_reason` | string | no | Documented reason a phase legitimately has no required gates. |


### AuditEvent

- **Schema file:** `schemas/audit-event.schema.json`
- **\$id:** `https://mission-control.dev/schemas/audit-event.schema.json`
- **Top-level type:** `object`
- **Extensibility:** permissive (`additionalProperties: true` — extra fields allowed)
- **Required:** `schemaVersion`, `ts`, `eventType`, `source`

One record in the append-only audit log: a durable account of a consequential action the oversight dashboard orchestrated — an agent spawn, a human approval decision, or a branch merge. The cockpit is the SOLE writer (one append-only JSONL log via the existing atomic-write helper, ADR-0004 local-JSON, no DB); it records both the events it performs directly and the rails-mediated ones it drives via the control-plane CLI shell-out. v9 adds `controlState` — the runtime-governance record of WHICH guardrails were in force, whether the gate was blocking, and who decided — REQUIRED on 'approval' events (see the conditional below) so an approval can never be recorded without its control context. KNOWN LIMITATION: actions taken against the rails CLI directly (outside the dashboard) are not captured by this log yet — there is no second writer this phase. Permissive (additionalProperties:true) so emitters can attach event-specific detail under `payload` without a schema bump.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `schemaVersion` | integer | yes | The contracts surface version this record was written under (derived from the single-source schema-version.json sidecar), so a reader can interpret older records as the surface evolves. |
| `ts` | string | yes | ISO-8601 timestamp of when the event occurred (UTC, e.g. 2026-06-08T14:03:11.000Z). |
| `eventType` | enum("spawn" \| "approval" \| "merge") | yes | The kind of consequential action recorded: 'spawn' (an agent session was started), 'approval' (a human decided on a gated/danger-zone request), or 'merge' (a branch was merged). |
| `actor` | string \| null | no | Who or what initiated the action — a human operator identity for approvals, or an orchestrator/system identifier for automated steps. Null when not attributable. |
| `subjectId` | string \| null | no | Identifier of the thing the event acted ON (e.g. the approval-request id for an approval, the branch ref for a merge). Null when not applicable. |
| `sessionId` | string \| null | no | The agent session this event relates to, when one exists (e.g. the spawned session for a 'spawn' event). Null when no session is involved. |
| `projectKey` | string \| null | no | The project this event belongs to, scoping the record to one workspace in a multi-project view. Null when not project-scoped. |
| `decision` | string \| null | no | For an 'approval' event: the human decision recorded (e.g. approved / denied). Null for non-approval events. |
| `outcome` | string \| null | no | The result of the action once known (e.g. succeeded / failed / skipped). Null while pending or not applicable. |
| `source` | enum("cockpit" \| "harness") | yes | Which control surface the event flowed through: 'cockpit' for an action the dashboard performed directly, 'harness' for a rails-mediated action the dashboard drove via the control-plane CLI shell-out. |
| `correlationId` | string \| null | no | An id that ties related events together across surfaces (e.g. a request that triggers a spawn then an approval then a merge), so a multi-step flow can be reconstructed. Null when standalone. |
| `controlState` | object \| null | no | The control state in force WHEN the event occurred — the runtime-governance record that makes the log auditable as enforcement, not just observation: which guardrails were active, whether the gate blocked execution, and who decided. Required (with gateType + decisionMaker) on 'approval' events via the conditional below; optional but encouraged elsewhere (e.g. a spawn records the policies the agent was launched under). Fields the emitter does not know are omitted or null — NEVER fabricated. |
| `payload` | object | no | Event-specific detail. Permissive on purpose: emitters attach the extra fields a given eventType needs (e.g. cost, branch name, gate id) without requiring a schema-surface bump for each. |
