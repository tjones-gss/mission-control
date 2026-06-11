# Releasing Mission Control

This document is the canonical procedure for cutting a release and the policy for
the **three independent version axes** in this monorepo. Get the axes straight
before touching any version field — they answer different questions and move on
different cadences.

## The three independent version axes

| Axis                           | Where it lives                                                                            | What it answers                                                                            | Owner of the bump                             |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| **Package SEMVER**             | the 5 `package.json` + 2 `pyproject.toml` `[project].version` fields, moving **LOCKSTEP** | "which release of the _product_ is this?"                                                  | release engineering (this doc)                |
| **Contracts `SCHEMA_VERSION`** | `packages/contracts/schema-version.json` (sidecar) `schemaVersion`                        | "which revision of the emitted `harness status --json` **contract surface** is this?"      | the contract change that adds/breaks a schema |
| **`APPROVAL_SCHEMA_VERSION`**  | the same sidecar `approvalSchemaVersion`                                                  | "which revision of the **per-document** approval files (`.harness/approvals/**`) is this?" | the approval-format change                    |

These are deliberately **decoupled**. A release can ship with the contract surface
unchanged (semver moves, `SCHEMA_VERSION` does not), and the contract surface can
move within a single release (a schema is added mid-cycle). Never collapse them
into one number "for simplicity" — they version different things and a consumer
keys off them independently.

### Current values

- **Package SEMVER:** `0.4.0` (the first tagged version off the historical `0.1.0`;
  Phases 0–3 were pre-tag development on the `0.1.0` line).
- **Contracts `SCHEMA_VERSION`:** `9` (breaking: `audit-event.controlState` added in PR #10 — approval events require it; see `packages/contracts/CHANGELOG.md`).
- **`APPROVAL_SCHEMA_VERSION`:** `2`.

The contracts `package.json` also carries a **display** `schemaVersion` field that
must equal the sidecar (single source of truth). `index.js` (Node) and
`packages/harness/tools/harness` (Python) both DERIVE their version constants from
the sidecar — never hand-copy a literal.

## Single-sourcing invariants (machine-checked)

Two gates enforce the axes so a drift reds CI instead of shipping silently:

- **`apps/cockpit/server/tests/contracts/version-consistency.contract.test.js`** —
  all 7 semver sources agree and equal the locked target; the contracts display
  `schemaVersion` equals the sidecar.
- **`apps/cockpit/server/tests/contracts/changelog-lint.contract.test.js`** —
  the repo-root `CHANGELOG.md` has exactly one `[Unreleased]`, its top released
  heading equals the package version, and it is valid Keep-a-Changelog.
- **`node scripts/release/check-versions.mjs`** — a standalone exit-code wrapper of
  the same semver invariants for release pipelines that want a check without a test
  runner.

The version source enumeration is `scripts/release/version-sources.js` (the single
list of files that move on each axis). If you add a version-bearing file, add it
there.

## How to cut a release

A release is **human-cut** — the proof artifact (a real git tag → GitHub release
with the SBOM + OpenAPI spec attached) is created by a maintainer, not by a merge.
The repository keeps everything _ready_ to tag; the tag is the deliberate act.

1. **Land all release content on `main`** (each change TDD-first, through the
   pre-commit gate). The `[Unreleased]` block of `CHANGELOG.md` accumulates entries
   as features land.
2. **Bump SEMVER lockstep** (if this release moves the product version): set all 5
   `package.json` + 2 `pyproject.toml` `[project].version` to the new version. Run:
   ```
   node scripts/release/check-versions.mjs
   ```
   It must print `Version consistency OK`.
3. **Flip the CHANGELOG.** Move the `[Unreleased]` accumulated entries under a new
   dated heading `## [<version>] - <YYYY-MM-DD>`, leaving an empty `[Unreleased]`
   above it. This is the **only** edit that flips the heading (single owner). Run
   the changelog-lint test to confirm Keep-a-Changelog validity.
4. **Regenerate the SBOM locally to sanity-check** (optional; CI/release does this):
   ```
   node scripts/release/generate-sbom.mjs bom.json
   ```
   It writes a CycloneDX 1.5 document spanning the npm lockfiles (full transitive
   graph) plus the DIRECT python deps from each `pyproject.toml`. NOTE: transitive
   python deps are **not** resolved — there is no committed python lockfile, so the
   python side is direct-only and says so in `metadata.properties`.
5. **Run the full local gate** (mirror of CI):
   ```
   cd apps/cockpit/server && npx vitest run --coverage
   cd apps/cockpit/client && npx vitest run --coverage
   node --test scripts/release/sbom.smoke.test.mjs
   cd packages/harness && python -m unittest <enumerated modules>   # see ci.yml
   ```
6. **Tag and push the tag.** Tagging `v<version>` (e.g. `v0.4.0`) triggers
   `.github/workflows/release.yml`, which runs the already-tested node scripts to
   produce `bom.json` + the cockpit `openapi.json` and publishes a GitHub release
   with both attached:
   ```
   git tag v0.4.0
   git push origin v0.4.0
   ```

### Out-of-repo step (cannot be a file)

A repo admin must mark the CI status checks **required** on `main`
(`cockpit (Node)`, `cockpit e2e (Fleet + Playwright)`, `harness (Python)`) — see
[`docs/ci.md`](docs/ci.md). Branch protection is a GitHub repo setting, not a file;
CI passing in-repo does not by itself block a merge.
