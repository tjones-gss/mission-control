#!/usr/bin/env node
// packages/contracts/tools/generate-spec.mjs
//
// Zero-dependency, in-repo generator for the vendor-neutral contract SPEC.md.
// It renders a single human-readable spec FROM the JSON schemas (the single
// source of truth) so the published spec can never silently drift from the
// shapes the harness emits and the cockpit consumes.
//
// The spec is deliberately VENDOR-NEUTRAL: it documents `harness status --json`
// (and the sibling approval / fleet / pipeline / audit shapes) as an integration
// surface any tool can build to — it does not name a specific agent vendor. This
// is the surviving moat artifact recorded in docs/adr/0005.
//
// Modes:
//   --write   regenerate packages/contracts/SPEC.md from the schemas (default
//             when run with no recognised mode is --check to stay safe in CI).
//   --check   print the regenerated spec to stdout and exit non-zero if it
//             differs from the committed SPEC.md (the freshness gate).
//
// No external deps: schemas are read with fs + JSON.parse, the spec is plain
// Markdown assembled with string templates. Runs under Node 22 ESM.

import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONTRACTS_DIR = join(__dirname, "..");
const SCHEMAS_DIR = join(CONTRACTS_DIR, "schemas");
export const SPEC_PATH = join(CONTRACTS_DIR, "SPEC.md");

// Stable, intentional ordering so the generated spec is deterministic regardless
// of filesystem listing order. Any schema not enumerated here is still rendered
// (appended, sorted) so a newly added schema can never be silently dropped — the
// freshness gate would catch it, and this keeps the omission obvious.
const SCHEMA_ORDER = [
  "harness-status.schema.json",
  "harness-scaffold.schema.json",
  "approval-request.schema.json",
  "approval-decision.schema.json",
  "fleet-run.schema.json",
  "fleet-template.schema.json",
  "pipeline-phase.schema.json",
  "audit-event.schema.json",
];

export function listSchemaFiles(dir = SCHEMAS_DIR) {
  const present = readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
  const ordered = SCHEMA_ORDER.filter((f) => present.includes(f));
  const extras = present.filter((f) => !SCHEMA_ORDER.includes(f)).sort();
  return [...ordered, ...extras];
}

export function loadSchemas(dir = SCHEMAS_DIR) {
  return listSchemaFiles(dir).map((file) => ({
    file,
    schema: JSON.parse(readFileSync(join(dir, file), "utf8")),
  }));
}

function loadSidecar(dir = CONTRACTS_DIR) {
  return JSON.parse(readFileSync(join(dir, "schema-version.json"), "utf8"));
}

// Render a JSON-schema `type` (string | array | undefined) to a readable label.
function renderType(prop) {
  if (!prop) return "any";
  if (prop.enum) {
    return `enum(${prop.enum.map((v) => JSON.stringify(v)).join(" | ")})`;
  }
  const t = prop.type;
  if (Array.isArray(t)) return t.join(" | ");
  if (typeof t === "string") return t;
  return "object";
}

// Escape Markdown table-cell-breaking characters in prose so a description with
// a pipe doesn't corrupt the rendered table.
function cell(text) {
  if (text === undefined || text === null) return "";
  return String(text).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function renderPropertyRows(properties = {}, required = []) {
  const requiredSet = new Set(required);
  const names = Object.keys(properties);
  if (names.length === 0)
    return ["_No declared properties (permissive shape)._", ""];
  const rows = [
    "| Field | Type | Required | Description |",
    "| --- | --- | --- | --- |",
  ];
  for (const name of names) {
    const prop = properties[name];
    rows.push(
      `| \`${name}\` | ${cell(renderType(prop))} | ${requiredSet.has(name) ? "yes" : "no"} | ${cell(prop.description)} |`,
    );
  }
  rows.push("");
  return rows;
}

function renderSchemaSection({ file, schema }) {
  const title = schema.title || file;
  const lines = [];
  lines.push(`### ${title}`);
  lines.push("");
  lines.push(`- **Schema file:** \`schemas/${file}\``);
  if (schema.$id) lines.push(`- **\\$id:** \`${schema.$id}\``);
  lines.push(`- **Top-level type:** \`${renderType(schema)}\``);
  const additional =
    schema.additionalProperties === false
      ? "closed (`additionalProperties: false` — unknown fields rejected)"
      : "permissive (`additionalProperties: true` — extra fields allowed)";
  lines.push(`- **Extensibility:** ${additional}`);
  if (Array.isArray(schema.required) && schema.required.length) {
    lines.push(
      `- **Required:** ${schema.required.map((r) => `\`${r}\``).join(", ")}`,
    );
  } else {
    lines.push("- **Required:** _(none)_");
  }
  lines.push("");
  if (schema.description) {
    lines.push(cell(schema.description));
    lines.push("");
  }
  lines.push(...renderPropertyRows(schema.properties, schema.required));
  return lines.join("\n");
}

// Pure, deterministic spec renderer. Given the loaded schemas + sidecar it
// returns the exact Markdown SPEC.md content. No clock, no randomness, no env —
// the same inputs always yield the same bytes, which is what makes the freshness
// gate (committed SPEC.md == regenerated) a meaningful check.
export function renderSpec(schemas, sidecar) {
  const out = [];
  out.push("<!--");
  out.push("  GENERATED FILE — do not edit by hand.");
  out.push("  Source of truth: packages/contracts/schemas/*.json");
  out.push(
    "  Regenerate with: node packages/contracts/tools/generate-spec.mjs --write",
  );
  out.push(
    "  The TestSpecDocFreshness gate fails CI if this file drifts from the schemas.",
  );
  out.push("-->");
  out.push("");
  out.push("# Mission Control Contract Specification");
  out.push("");
  out.push(
    `**Contract surface version (schemaVersion): ${sidecar.schemaVersion}**  `,
  );
  out.push(
    `**Approval document version (approvalSchemaVersion): ${sidecar.approvalSchemaVersion}**`,
  );
  out.push("");
  out.push(
    "This is the versioned, **vendor-neutral** specification of the data shapes that cross the " +
      "boundary between the oversight dashboard (the window) and the opt-in control-plane rails. " +
      "The dashboard does not import the rails as a library — it shells out to the control-plane " +
      "CLI (`harness status --json`) and reads/writes the approval, fleet, pipeline and audit " +
      "documents described below. These schemas are the single source of truth; this document is " +
      "generated from them so it can never silently drift.",
  );
  out.push("");
  out.push(
    "The spec is deliberately vendor-neutral: it describes an integration surface any tool can " +
      "build to, not a single agent vendor. See `docs/adr/0005-moat-and-surface-strategy.md` — the " +
      "versioned vendor-neutral contract is the surviving moat artifact.",
  );
  out.push("");
  out.push("## Versioning");
  out.push("");
  out.push(
    "- `schemaVersion` versions the contract surface as a whole. The single canonical source is " +
      "`packages/contracts/schema-version.json`; both the JS package and the Python harness derive " +
      "their numbers from it (a cross-language parity test fails CI on a one-sided change). The " +
      "per-version timeline lives in `packages/contracts/CHANGELOG.md`.",
  );
  out.push(
    "- `approvalSchemaVersion` is a separate, independently-versioned concept: the per-document " +
      "`schemaVersion` integer stamped into the approval-request / approval-decision files.",
  );
  out.push("");
  out.push("## Schemas");
  out.push("");
  for (const entry of schemas) {
    out.push(renderSchemaSection(entry));
    out.push("");
  }
  // Single trailing newline (POSIX text file convention).
  return out.join("\n").replace(/\n+$/, "\n");
}

export function generateSpec({
  dir = SCHEMAS_DIR,
  contractsDir = CONTRACTS_DIR,
} = {}) {
  const schemas = loadSchemas(dir);
  const sidecar = loadSidecar(contractsDir);
  return renderSpec(schemas, sidecar);
}

function readCommittedSpec(specPath = SPEC_PATH) {
  try {
    return readFileSync(specPath, "utf8");
  } catch (err) {
    // ENOENT is meaningful here (no committed spec yet → --check should fail
    // loudly rather than crash); rethrow anything else with context.
    if (err && err.code === "ENOENT") return null;
    throw new Error(
      `failed to read committed SPEC.md at ${specPath}: ${err.message}`,
    );
  }
}

function main(argv) {
  const mode = argv.includes("--write") ? "write" : "check";
  const generated = generateSpec();
  if (mode === "write") {
    writeFileSync(SPEC_PATH, generated, "utf8");
    process.stdout.write(`wrote ${SPEC_PATH}\n`);
    return 0;
  }
  // --check (default): compare against the committed file, exit non-zero on drift.
  const committed = readCommittedSpec();
  if (committed === generated) {
    process.stdout.write("SPEC.md is up to date with the schemas.\n");
    return 0;
  }
  process.stderr.write(
    "SPEC.md is STALE — it does not match the schemas. " +
      "Regenerate with: node packages/contracts/tools/generate-spec.mjs --write\n",
  );
  return 1;
}

// Only run the CLI when invoked directly, not when imported by a test.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)));
}
