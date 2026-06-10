# Contracts schema-version changelog

The schema-version timeline for `@mission-control/contracts`. This is the
**schema-surface** axis — a different concern from the repo-root `CHANGELOG.md`
(package semver) and from the per-document `approvalSchemaVersion` (timeline at
the bottom of this file).

The single canonical source of truth for the current numbers is
`schema-version.json`; both the JS package (`index.js`) and the Python harness
(`packages/harness/tools/harness`) derive from it. The human-readable spec
rendered from these schemas is `SPEC.md` (regenerate with
`node packages/contracts/tools/generate-spec.mjs --write`).

Bump `schemaVersion` on any breaking change to a schema (renamed/removed field,
tightened required set, changed type or enum), and additively when adding a new
schema.

## `schemaVersion` (contract surface as a whole)

### [9]

- **Breaking — runtime governance (audit v2).** `audit-event` gains
  `controlState` — the record of which guardrails were in force when the event
  occurred (`policiesInForce`), whether the gate blocked execution
  (`gateType: hard | soft | policy`), who decided (`decisionMaker: human |
  auto`), and the `permissionMode` / `model` snapshot when knowable. An
  `approval` event now REQUIRES `controlState` with `gateType` +
  `decisionMaker` (schema `allOf` conditional) — enforcement and audit are the
  same act, so an approval can never be recorded without its control context.
  Tightened required set ⇒ breaking ⇒ sidecar bump. Optional elsewhere
  (spawns record the policies the agent launched under); unknown fields stay
  null/omitted — never fabricated.

### [8]

- **Additive — Phase 4 (D-audit-otel).** Added the standalone `audit-event`
  schema: one record in the cockpit's append-only audit log (spawn / approval /
  merge events, vendor-neutral `source` enum `cockpit | harness`). Schema-only
  landing — no emitter writes records yet. Adding a consumable record type is a
  surface change, hence the sidecar bump.

### [7]

- **Phase 2 (the spine becomes CONSUMED).** Relaxed `pipeline-phase` so it
  validates real authored pipeline YAML: only `id` / `agent` stay required;
  `gate` / `tier` / `strategy` / `goal` become optional (the harness loader
  materializes their canonical defaults; a gateless phase documents
  `no_gate_reason`); the authored fields `description` / `inputs` / `outputs` /
  `rules` / `checks` / `loop` / `no_outputs_reason` / `no_gate_reason` are
  accepted (`additionalProperties` stays `false` so typos still fail). Extended
  `harness-status.pipeline` with optional `goal` / `strategy` / `transitioned_at`
  for live phase-transition surfacing.

### [6]

- **Additive — Durable Fleet (item 1g).** Extended `fleet-run` with the TERMINAL
  `orphaned` run + child status (boot reconciler reaps non-terminal runs left by
  a restart) and the durable child `pid` registry field. Non-breaking: new
  optional values/field on the permissive (`additionalProperties:true`) schema.

### [5]

- **Additive.** Added the `pipeline-phase` schema (ADR-0006 canonical
  phase-contract object). Non-breaking: a new optional schema, no change to
  existing shapes.

### [4]

- **Additive — Fleet Phase 4.** Extended `fleet-run` with budget fields
  (`policy.budgetUsd` / `perChildUsd`, `run.spentUsd` / `budgetRemaining`, the
  `budget_exceeded` run status), adversarial verification (`policy.verify`, the
  `verifying` / `rejected` child statuses, `child.childKind` / `verdicts` /
  `rounds` / `verifiedBy`), and quarantine (`child.quarantine`). Added the
  standalone `fleet-template` schema (saved repeatable fleet configs).

### [1]–[3]

- Earlier surface revisions predate this dedicated changelog (the original
  `harness-status` / `approval-request` / `approval-decision` /
  `harness-scaffold` / `fleet-run` shapes). The history was migrated here from
  the version comments that lived in `index.js`; revisions before [4] were not
  individually recorded at the time.

## `approvalSchemaVersion` (per-document approval files)

A **separate** version from the surface `schemaVersion` above: the per-document
`schemaVersion` integer stamped into the `approval-request` /
`approval-decision` files the harness writes under `.harness/approvals/**`.
Versioned independently — the two are deliberately allowed to differ.

### [2]

- Current per-document approval version (see `schema-version.json`
  `approvalSchemaVersion`).
