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

export const harnessStatusSchema = loadSchema("harness-status.schema.json");
export const harnessScaffoldSchema = loadSchema("harness-scaffold.schema.json");
export const approvalRequestSchema = loadSchema("approval-request.schema.json");
export const approvalDecisionSchema = loadSchema("approval-decision.schema.json");
export const fleetRunSchema = loadSchema("fleet-run.schema.json");
export const fleetTemplateSchema = loadSchema("fleet-template.schema.json");

// 4: additive — Fleet Phase 4. Extended `fleet-run` with budget fields
// (policy.budgetUsd / perChildUsd, run.spentUsd / budgetRemaining, the
// `budget_exceeded` run status), adversarial verification (policy.verify, the
// `verifying`/`rejected` child statuses, child.childKind / verdicts / rounds /
// verifiedBy), and quarantine (child.quarantine). Added the standalone
// `fleet-template` schema (saved repeatable fleet configs). Non-breaking: every
// fleet-run addition is on an additionalProperties:true object and statuses are
// free strings, so older persisted runs (and peers on v1–v3) still validate.
export const SCHEMA_VERSION = 4;

export const schemas = {
  harnessStatus: harnessStatusSchema,
  harnessScaffold: harnessScaffoldSchema,
  approvalRequest: approvalRequestSchema,
  approvalDecision: approvalDecisionSchema,
  fleetRun: fleetRunSchema,
  fleetTemplate: fleetTemplateSchema,
};

export default {
  SCHEMA_VERSION,
  harnessStatusSchema,
  harnessScaffoldSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
  fleetRunSchema,
  fleetTemplateSchema,
  schemas,
};
