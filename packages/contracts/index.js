// @mission-control/contracts
// Single source of truth for JSON-schema contracts shared between the Node
// cockpit (apps/cockpit) and the Python harness (packages/harness).
//
// Schemas are loaded via fs.readFileSync + JSON.parse (resolved relative to
// import.meta.url) rather than JSON import assertions, to avoid the
// import-assertion / import-attributes syntax churn across Node versions.
// This runs cleanly under Node 22 ESM.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSchema(name) {
  const path = join(__dirname, "schemas", name);
  return JSON.parse(readFileSync(path, "utf8"));
}

// Single canonical source of truth for the contracts package versions. Both
// this JS index and the Python harness (packages/harness/tools/harness) DERIVE
// their version numbers from this committed sidecar — neither hand-copies the
// other. A cross-language parity test (packages/harness/tests/test_contract.py)
// fails CI if the Python-resolved values drift from this file.
const versionSidecar = JSON.parse(
  readFileSync(join(__dirname, "schema-version.json"), "utf8"),
);

export const harnessStatusSchema = loadSchema("harness-status.schema.json");
export const harnessScaffoldSchema = loadSchema("harness-scaffold.schema.json");
export const approvalRequestSchema = loadSchema("approval-request.schema.json");
export const approvalDecisionSchema = loadSchema(
  "approval-decision.schema.json",
);
export const fleetRunSchema = loadSchema("fleet-run.schema.json");
export const fleetTemplateSchema = loadSchema("fleet-template.schema.json");
export const pipelinePhaseSchema = loadSchema("pipeline-phase.schema.json");

// SCHEMA_VERSION versions the contracts package as a whole. History:
//   4: additive — Fleet Phase 4. Extended `fleet-run` with budget fields
//      (policy.budgetUsd / perChildUsd, run.spentUsd / budgetRemaining, the
//      `budget_exceeded` run status), adversarial verification (policy.verify,
//      the `verifying`/`rejected` child statuses, child.childKind / verdicts /
//      rounds / verifiedBy), and quarantine (child.quarantine). Added the
//      standalone `fleet-template` schema (saved repeatable fleet configs).
//   5: additive — added the `pipeline-phase` schema (ADR-0006 canonical
//      phase-contract object). Non-breaking: a new optional schema, no change to
//      existing shapes.
// Sourced from schema-version.json so the Python side derives the same number.
export const SCHEMA_VERSION = versionSidecar.schemaVersion;

// APPROVAL_SCHEMA_VERSION is a SEPARATE concept: the per-document `schemaVersion`
// integer stamped into approval-request / approval-decision files
// (.harness/approvals/**). It is versioned independently of the package-wide
// SCHEMA_VERSION above (the two are deliberately allowed to differ). The Python
// harness reads the same sidecar to stamp these files, so the two sides cannot
// silently drift.
export const APPROVAL_SCHEMA_VERSION = versionSidecar.approvalSchemaVersion;

export const schemas = {
  harnessStatus: harnessStatusSchema,
  harnessScaffold: harnessScaffoldSchema,
  approvalRequest: approvalRequestSchema,
  approvalDecision: approvalDecisionSchema,
  fleetRun: fleetRunSchema,
  fleetTemplate: fleetTemplateSchema,
  pipelinePhase: pipelinePhaseSchema,
};

export default {
  SCHEMA_VERSION,
  APPROVAL_SCHEMA_VERSION,
  harnessStatusSchema,
  harnessScaffoldSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
  fleetRunSchema,
  fleetTemplateSchema,
  pipelinePhaseSchema,
  schemas,
};
