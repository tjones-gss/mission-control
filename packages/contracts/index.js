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
export const approvalRequestSchema = loadSchema("approval-request.schema.json");
export const approvalDecisionSchema = loadSchema("approval-decision.schema.json");

// 2: additive — harness-status gained optional `plans` + `pipeline.plan_status`
// (PRD planning layer). Non-breaking: the schema is additionalProperties:true,
// so peers on v1 still validate.
export const SCHEMA_VERSION = 2;

export const schemas = {
  harnessStatus: harnessStatusSchema,
  approvalRequest: approvalRequestSchema,
  approvalDecision: approvalDecisionSchema,
};

export default {
  SCHEMA_VERSION,
  harnessStatusSchema,
  approvalRequestSchema,
  approvalDecisionSchema,
  schemas,
};
