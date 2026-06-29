// xvendor-contract.test.js — proves the `harness status` contract is
// CROSS-VENDOR: a non-Claude agent's `harness status --json` validates against
// the same shared schema a Claude harness emits. This is the Sprint 2-d proof of
// ADR-0005's surviving moat — "the versioned vendor-neutral contract is the
// integration surface other tools build to."
//
// Runs on Node's built-in test runner (node --test, Node 22.13+) so the
// contracts package is independently testable with no cockpit toolchain. The
// only dev dependency is ajv (the house JSON-schema validator, matching the
// cockpit-side contract tests). The complementary consumer-side test — that the
// cockpit's parser ingests this same synthetic fixture without throwing — lives
// in apps/cockpit/server/tests/contracts/xvendor-harness.contract.test.js, where
// the parser + its spawn mock already live (correct dependency direction:
// cockpit depends on contracts, never the reverse).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = join(__dirname, "..");

const loadJson = (...parts) =>
  JSON.parse(readFileSync(join(CONTRACTS_DIR, ...parts), "utf-8"));

const schema = loadJson("schemas", "harness-status.schema.json");
const syntheticFixture = loadJson("fixtures", "synthetic-non-claude-harness.json");
const claudeFixture = loadJson("fixtures", "claude-harness.sample.json");

// One compiled validator, shared across tests. strict:false matches the
// cockpit-side contract test (the schema is permissive by design).
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

const errorsFor = (doc) => {
  validate(doc);
  return validate.errors ?? [];
};

test("test_synthetic_fixture_validates_against_schema", () => {
  const errors = errorsFor(syntheticFixture);
  assert.deepEqual(
    errors,
    [],
    `synthetic non-Claude (vendor="${syntheticFixture.vendor}") status must validate ` +
      `with zero errors:\n${JSON.stringify(errors, null, 2)}`,
  );
  // Guard the fixture is actually non-Claude and actually exercises a running
  // pipeline — not an empty stub that would pass vacuously.
  assert.notEqual(syntheticFixture.vendor, "claude");
  assert.equal(syntheticFixture.vendor, "openai-codex");
  assert.equal(syntheticFixture.pipeline.phase, "implement");
  assert.ok(
    Array.isArray(syntheticFixture.sessions) && syntheticFixture.sessions.length > 0,
  );
});

test("test_claude_fixture_validates_against_schema", () => {
  // Regression guard: the real Claude harness output (no vendor field — the
  // current CLI does not emit one) must keep validating. Cross-vendor support
  // must not break the incumbent.
  const errors = errorsFor(claudeFixture);
  assert.deepEqual(
    errors,
    [],
    `real Claude harness output must validate with zero errors:\n${JSON.stringify(errors, null, 2)}`,
  );
});

test("test_vendor_field_is_not_required_to_be_claude", () => {
  // The schema must NOT lock the integration surface to a single vendor. It does
  // this two ways, both asserted here:
  //   (1) it carries no `vendor` constraint that enumerates only "claude", and
  //   (2) the same schema accepts a vendor-bearing payload, a differently-
  //       vendored payload, and a vendor-less payload alike.
  const vendorSchema = schema.properties?.vendor;
  if (vendorSchema && Array.isArray(vendorSchema.enum)) {
    assert.ok(
      vendorSchema.enum.length !== 1 || vendorSchema.enum[0] !== "claude",
      "schema must not pin `vendor` to a claude-only enum — that would defeat " +
        "the vendor-neutral contract (ADR-0005)",
    );
  }

  assert.deepEqual(errorsFor({ ...syntheticFixture, vendor: "openai-codex" }), []);
  assert.deepEqual(errorsFor({ ...syntheticFixture, vendor: "gemini" }), []);
  // vendor-less still validates (backward compat with today's Claude harness)
  const { vendor, ...vendorless } = syntheticFixture;
  void vendor;
  assert.deepEqual(errorsFor(vendorless), []);
});

test("test_schema_drift_detected", () => {
  // The contract IS executable: structural/type drift fails validation.
  //
  // NOTE on the model: the schema is deliberately permissive
  // (additionalProperties:true everywhere) so older or other-vendor harnesses
  // that emit EXTRA additive fields are NOT rejected — that forward-compat is
  // the whole point of a vendor-neutral surface. So drift is caught not by
  // "unknown field present" but by the two violations the typed contract really
  // enforces (this mirrors the Python guard
  // test_drift_is_caught_and_by_which_guard):
  //   (a) a schema-REQUIRED top-level key is missing, and
  //   (b) a known field carries the wrong type.

  // (a) drop a required key — `pipeline` is required.
  const missingRequired = structuredClone(syntheticFixture);
  delete missingRequired.pipeline;
  assert.ok(
    errorsFor(missingRequired).length > 0,
    "schema must reject a status missing the required `pipeline` key",
  );

  // (b) type drift on a known field — readiness_overall.score must be a number.
  const typeDrift = structuredClone(syntheticFixture);
  typeDrift.readiness_overall.score = "not-a-number";
  assert.ok(
    errorsFor(typeDrift).length > 0,
    "schema must reject a non-numeric readiness_overall.score (type drift)",
  );

  // Document the permissive half explicitly so the guarantee is not overstated:
  // a purely-additive unknown field is ACCEPTED by design (forward compat).
  const additive = structuredClone(syntheticFixture);
  additive.some_future_vendor_field = { anything: true };
  assert.deepEqual(
    errorsFor(additive),
    [],
    "permissive schema must ACCEPT a purely-additive unknown field (forward " +
      "compat); drift is caught by required-key / type checks, not extra props",
  );
});
