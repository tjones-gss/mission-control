# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.0.0/); the project is pre-1.0
(`0.1.0`) and not yet semantically versioned.

## [Unreleased]

Phase 0 (decisions/docs) and Phase 1 (hardening) on `feature/harness-scaffold`
(PR #5). All changes TDD-first; suites green at 981 server / 504 client / 77 python
(1 skip) / 2 gated e2e.

### Added

- Program ADRs `0004`–`0007` in `docs/adr/`: deployment topology (localhost-first,
  architect-for-team), moat + surface strategy (the "no window-only polish" rule),
  the canonical orchestration model (harness pipeline = spine, Fleet = a phase
  strategy, Workflow = a degenerate single-phase pipeline), and the
  core-vs-experimental scope split.
- Root `SCOPE.md` — CORE vs EXPERIMENTAL manifest with the freeze rule *no new tab
  without retiring an overlap*.
- Root `DOD-LADDER.md` — the L0→L3 definition-of-done ladder with testable exit
  criteria per rung.
- `packages/contracts/schema-version.json` — single canonical source for
  `SCHEMA_VERSION` and `APPROVAL_SCHEMA_VERSION`, read by both the Node `index.js`
  and the Python harness (no hand-copied literals).
- `packages/contracts/schemas/pipeline-phase.schema.json` — the ADR-0006 phase
  contract (`id`, `agent`, `tier`, optional `model`, `gate.required[]`, `strategy`
  single|fleet, `goal`); defined and exported but not yet consumed (Phase-2 spine).
- `apps/cockpit/server/lib/claude-format.js` — degrade layer (`makeDegraded`,
  `isDegraded`, `signalDegraded` → deduped `parser_degraded` SSE, `readClaudeJson`).
- `apps/cockpit/server/lib/trust-store.js` — persisted, default-DENY per-cwd trust
  store for the interactive front door (no UI/route to grant trust yet).
- Client `ParserDegradedBanner` + a `parser_degraded` channel in `useSSE`.
- Durable Fleet: `reconcileFleetRuns()` boot reconciler (wired in `index.js`), a
  global kill-switch at `/api/fleet/kill` (GET/POST/DELETE), and child `pid` capture
  via an `onSpawn` hook.
- Gated real-subprocess e2e lane (`RUN_E2E=1`, `server/vitest.e2e.config.js`):
  verify→reject→retry→synthesis plus a kill-and-restart durability test.

### Changed

- `apps/cockpit/server/claude-cli.js` `buildSpawn()` now always spawns with
  `shell:false`; `.cmd`/`.bat` route through `cmd.exe /d /s /c` and `.ps1` through
  `powershell -NoProfile -NonInteractive -File`, with arguments passed as discrete
  literal argv.
- `pty-session.js` `resolvePermissionArgs()` defaults to `--permission-mode
  acceptEdits` (GUARDED) instead of `--dangerously-skip-permissions`; skip-permissions
  is used only for a cwd in the trust store. An explicit valid `permissionMode` is
  still honored.
- Fleet harness-escalation branch calls `runHarnessApprove()` as a direct Python
  subprocess — no Claude session in the deterministic approval write path; the
  harness CLI remains the single writer.
- Fleet settle logic replaced the hand-counted pending counters with a pure
  predicate (`allChildrenSettled`) plus an idempotent `maybeFinalize`.
- `SCHEMA_VERSION` bumped to **6** (durable-Fleet `orphaned` status + `child.pid`);
  `APPROVAL_SCHEMA_VERSION` is **2**, versioned independently. `fleet-run.schema.json`
  extended with the terminal `orphaned` status and `child.pid`.
- Every `~/.claude` parser (sessions, config, hooks, session-discovery, mcp, memory,
  skills, plans, history, tasks, teams, conductor, messages) is now degrade-guarded:
  a present-but-unparseable file emits `parser_degraded` + a distinguishable marker
  instead of silently returning empty/null.
- Python harness `_SCHEMA_VERSION_FALLBACK` updated 5→6, with a parity test guarding
  fallback drift; `test_contract.py` now fails (not skips) when `jsonschema` is absent.
- `apps/cockpit/.prettierrc` gained `endOfLine:"auto"` so the pre-commit gate passes
  on Windows.
- `.gitignore` now ignores `apps/cockpit/server/data/fleet/` and
  `data/fleet-templates/` (`session-names.json` stays tracked).

### Fixed

- Fleet runs no longer wedge at `running` across a server restart — the boot
  reconciler cross-checks pid liveness and marks unrecoverable non-terminal runs
  `orphaned` (run + child).
- Parsers no longer misreport "nothing configured" when a `~/.claude` file is present
  but unparseable.

### Security

- Closed Windows `.cmd`/`.ps1` command injection in the spawn path (literal argv,
  `shell:false`).
- The interactive front door no longer disables permission prompts by default;
  choosing a cwd is not consent to skip permissions.
- Removed the Claude session from the deterministic `harness approve` write path.
