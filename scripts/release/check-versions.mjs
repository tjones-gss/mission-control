#!/usr/bin/env node
// Release-engineering CLI guard: verifies the version single-sourcing invariants
// and exits non-zero on any mismatch. Lives under scripts/release/ (outside the
// server coverage include globs). The authoritative assertions live in the
// version-consistency.contract.test.js suite; this wrapper is for CI / release
// pipelines that want a standalone exit code without a test runner.
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  repoRoot,
  PACKAGE_JSON_VERSION_SOURCES,
  PYPROJECT_VERSION_SOURCES,
  CONTRACTS_DISPLAY_SCHEMA_SOURCE,
  CONTRACTS_SIDECAR_SOURCE,
  SEMVER_RE,
  parsePyprojectVersion,
} from "./version-sources.js";

const ROOT = repoRoot();
const problems = [];
const versions = new Map();

function readText(rel) {
  return readFileSync(path.join(ROOT, rel), "utf-8");
}

for (const rel of PACKAGE_JSON_VERSION_SOURCES) {
  try {
    const { version } = JSON.parse(readText(rel));
    if (typeof version !== "string" || !SEMVER_RE.test(version)) {
      problems.push(
        `${rel}: invalid semver version ${JSON.stringify(version)}`,
      );
    }
    versions.set(rel, version);
  } catch (err) {
    problems.push(`${rel}: could not read/parse version (${err.message})`);
  }
}

for (const rel of PYPROJECT_VERSION_SOURCES) {
  try {
    const version = parsePyprojectVersion(readText(rel));
    if (typeof version !== "string" || !SEMVER_RE.test(version)) {
      problems.push(
        `${rel}: invalid [project] semver version ${JSON.stringify(version)}`,
      );
    }
    versions.set(rel, version);
  } catch (err) {
    problems.push(`${rel}: could not read [project] version (${err.message})`);
  }
}

const distinct = new Set([...versions.values()]);
if (distinct.size > 1) {
  problems.push(
    `version mismatch across sources: ${[...versions.entries()]
      .map(([rel, v]) => `${rel}=${v}`)
      .join(", ")}`,
  );
}

// Contracts display schemaVersion must equal the sidecar (single source of truth).
try {
  const display = JSON.parse(
    readText(CONTRACTS_DISPLAY_SCHEMA_SOURCE),
  ).schemaVersion;
  const sidecar = JSON.parse(readText(CONTRACTS_SIDECAR_SOURCE)).schemaVersion;
  if (!Number.isInteger(sidecar)) {
    problems.push(
      `${CONTRACTS_SIDECAR_SOURCE}: schemaVersion is not an integer (${sidecar})`,
    );
  }
  if (display !== sidecar) {
    problems.push(
      `contracts display schemaVersion (${display}) != sidecar schemaVersion (${sidecar})`,
    );
  }
} catch (err) {
  problems.push(`contracts schemaVersion check failed: ${err.message}`);
}

if (problems.length > 0) {
  console.error("Version consistency check FAILED:");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const agreed = [...distinct][0];
console.log(
  `Version consistency OK: all ${versions.size} sources at ${agreed}.`,
);
process.exit(0);
