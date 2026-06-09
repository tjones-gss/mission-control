// Pure enumeration of the repo's version source files. Lives under
// scripts/release/ — OUTSIDE the server coverage include globs (routes/lib/
// utils/parsers) — so adding it does not move the coverage floor.
//
// SEMVER axis: the 5 package.json + 2 pyproject.toml [project] version fields
// move LOCKSTEP (e.g. all 0.4.0). This is a DISTINCT axis from the contracts
// SCHEMA_VERSION (sidecar schema-version.json) and from APPROVAL_SCHEMA_VERSION.
//
// The contracts package.json ALSO carries a DISPLAY `schemaVersion` field that
// must equal the sidecar's schemaVersion (the single source of truth). That is a
// separate consistency rule from the semver lockstep, enumerated below.
//
// Paths are repo-root-relative POSIX strings; callers resolve against repoRoot().
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// scripts/release/ -> repo root is two levels up.
export function repoRoot() {
  return path.resolve(__dirname, "../..");
}

// The 5 package.json files whose `version` field moves on the semver axis.
export const PACKAGE_JSON_VERSION_SOURCES = [
  "package.json",
  "apps/cockpit/package.json",
  "apps/cockpit/server/package.json",
  "apps/cockpit/client/package.json",
  "packages/contracts/package.json",
];

// The 2 pyproject.toml files whose [project] version moves on the semver axis.
export const PYPROJECT_VERSION_SOURCES = [
  "packages/harness/sdk/python/pyproject.toml",
  "packages/harness/harness_core/pyproject.toml",
];

// The contracts package.json display `schemaVersion` field and the sidecar that
// owns its value. The display field must equal the sidecar's schemaVersion.
export const CONTRACTS_DISPLAY_SCHEMA_SOURCE =
  "packages/contracts/package.json";
export const CONTRACTS_SIDECAR_SOURCE =
  "packages/contracts/schema-version.json";

// A valid semantic version: MAJOR.MINOR.PATCH with optional pre-release/build.
// Anchored so the whole string must match.
export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/;

// Extract the [project] version from raw pyproject.toml text. Returns the
// version string, or null if no [project] version line is found. Intentionally
// minimal (no full TOML parser dependency): matches the first `version = "..."`
// that appears after a `[project]` table header.
export function parsePyprojectVersion(tomlText) {
  if (typeof tomlText !== "string") return null;
  const lines = tomlText.split(/\r?\n/);
  let inProject = false;
  for (const line of lines) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      inProject = header[1].trim() === "project";
      continue;
    }
    if (inProject) {
      const m = line.match(/^\s*version\s*=\s*["']([^"']+)["']/);
      if (m) return m[1];
    }
  }
  return null;
}
