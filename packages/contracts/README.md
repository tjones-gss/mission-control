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

`schema-version.json` is the **single canonical source of truth** for the
contract versions. Both this JS package and the Python harness
(`packages/harness/tools/harness`) DERIVE their numbers from it — neither
hand-copies the other. A cross-language parity test
(`packages/harness/tests/test_contract.py::TestSchemaVersionParity`) fails CI on
a one-sided change. To bump a version, edit `schema-version.json` only.

Two independent concepts live in the sidecar:

- **`schemaVersion`** — the contracts package version as a whole, exported as
  `SCHEMA_VERSION`. **Bump it on any breaking change** to a schema
  (renamed/removed field, tightened required set, changed type or enum), and
  additively when adding a new schema. Both the cockpit and the harness key off
  this number to detect an incompatible peer.
- **`approvalSchemaVersion`** — a *separate* version: the per-document
  `schemaVersion` integer stamped into the `approval-request` /
  `approval-decision` files the harness writes under `.harness/approvals/**`.
  Exported as `APPROVAL_SCHEMA_VERSION`. It is versioned independently of
  `schemaVersion` (the two are deliberately allowed to differ).

`package.json`'s `schemaVersion` is kept in sync with the sidecar for display
purposes but is not read by code.
