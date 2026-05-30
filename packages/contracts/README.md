# @mission-control/contracts

Shared JSON-schema contracts for the mission-control monorepo. This package is
the **single source of truth** for the data shapes that cross the boundary
between the Node cockpit (`apps/cockpit`) and the Python harness
(`packages/harness`).

## Why this exists (contract-drift rationale)

The cockpit does not import the harness as a library — it shells out to the
harness CLI, primarily:

```
harness status --json
```

and reads/writes approval files under `.harness/approvals/`. Because the two
sides are written in different languages and ship on different release
cadences, their understanding of these shapes can silently drift apart. A field
the harness renames or drops can break the cockpit at runtime with no compile-time
signal.

These schemas close that gap: the cockpit validates the harness output (and the
approval files) against the schemas here, so drift surfaces as a clear
validation error instead of a mysterious downstream bug. The harness side can
validate against the same files.

## Schemas

- `schemas/harness-status.schema.json` — output of `harness status --json`.
  Intentionally **permissive** (`additionalProperties: true`, few required
  fields) because older installed harnesses emit fewer fields; only `project`
  and `pipeline` are required.
- `schemas/approval-request.schema.json` — `.harness/approvals/pending/<uuid>.json`.
- `schemas/approval-decision.schema.json` — `.harness/approvals/decided/<uuid>.json`.
  Its `commandHash` must equal the matching request's `commandHash`, so a stale
  or replayed decision cannot unblock a different command.

## Usage

```js
import {
  SCHEMA_VERSION,
  harnessStatusSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
} from "@mission-control/contracts";
```

## Versioning

The current contract version is exported as `SCHEMA_VERSION` (and mirrored in
`package.json` as `schemaVersion`). **Bump `schemaVersion` on any breaking
change** to a schema (renamed/removed field, tightened required set, changed
type or enum). Both the cockpit and the harness key off this number to detect an
incompatible peer.
