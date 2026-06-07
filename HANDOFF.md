# Handoff — `feature/harness-scaffold`

The centerpiece for the next session. Phase 0 (decisions/docs) and Phase 1
(hardening) are **complete on this branch**; Phases 2–4 are **parked at a
reassessment gate** with three open decisions that must be resolved before any
Phase-2 code is written. Read this first.

## 1. Current state

- **Branch:** `feature/harness-scaffold` · **PR:** #5 · 14 commits ahead of `main`.
- **What's committed:** Phase 0 (ADRs 0004–0007, `SCOPE.md`, `DOD-LADDER.md`,
  `.prettierrc` `endOfLine:"auto"`) and Phase 1 items 1a–1g, all TDD-first, every
  commit through the pre-commit gate (lint + tests + secret scan).
- **Suites — all green:** **981 server** / **504 client** (Vitest) · **77 python**
  (1 skip, pytest) · **2 gated e2e** (real-subprocess, `RUN_E2E=1`).
- **Contract boundary intact:** the cockpit still shells out to `harness status
  --json` and renders the structured output — it never reparses harness YAML.

## 2. What shipped

### Phase 0 — decisions and docs

| Artifact | What it pins down |
|---|---|
| `docs/adr/0004-deployment-topology.md` | Localhost-first, architect-for-team deployment topology |
| `docs/adr/0005-moat-and-surface-strategy.md` | Moat thesis + the "no window-only polish" rule |
| `docs/adr/0006-canonical-orchestration-model.md` | Harness pipeline is the SPINE; Fleet is a phase STRATEGY; Workflow is a degenerate single-phase pipeline |
| `docs/adr/0007-core-vs-experimental-scope.md` | CORE vs EXPERIMENTAL scope split |
| `SCOPE.md` | CORE vs EXPERIMENTAL manifest + the freeze rule: *no new tab without retiring an overlap* |
| `DOD-LADDER.md` | L0 honest → L1 trustworthy → L2 adoptable → L3 standard, each rung a release gate with testable exit criteria |
| `apps/cockpit/.prettierrc` | `endOfLine:"auto"` so the pre-commit gate passes on Windows |

### Phase 1 — hardening (council gaps closed)

| Item | What it does | Closes | Key files |
|---|---|---|---|
| **1a** | `buildSpawn()` always `shell:false`; `.cmd`/`.bat` via `cmd.exe /d /s /c <bin> <args>`, `.ps1` via `powershell -NoProfile -NonInteractive -File <bin> <args>`, args passed as discrete literal argv — closes Windows `.cmd`/`.ps1` command injection | HIGH #4(a) | `server/claude-cli.js`, `server/lib/claude-bin.js` (`isShellScript`) |
| **1b** | `resolvePermissionArgs()`: the interactive front door no longer defaults to `--dangerously-skip-permissions`; defaults to `--permission-mode acceptEdits` (GUARDED), escalates to skip only for a cwd in the new default-DENY per-cwd trust store. An explicit valid `permissionMode` is still honored | HIGH #4(b) | `server/pty-session.js`, `server/lib/trust-store.js` |
| **1c** | Fleet harness-escalation branch calls `runHarnessApprove()` as a DIRECT python subprocess — no Claude session in the deterministic approval write path; `isKnownHarnessRoot` gate preserved; harness CLI stays the single writer | MED #6 | `server/fleet/fleet-runner.js`, `server/parsers/harness.js` |
| **1d** | Single canonical `packages/contracts/schema-version.json`; `index.js` derives `SCHEMA_VERSION` (now **6**) and `APPROVAL_SCHEMA_VERSION` (**2**) as DISTINCT concepts; python `_resolve_schema_versions()` reads the same sidecar; cross-language parity test reds on drift. New `pipeline-phase.schema.json` — DEFINED + exported but NOT YET consumed (the Phase-2 spine contract) | MED #7 | `packages/contracts/{index.js,schema-version.json,schemas/pipeline-phase.schema.json}`, `packages/harness/tools/harness`, `packages/harness/tests/test_contract.py` |
| **1e** | New `claude-format.js` degrade layer (`makeDegraded`/`isDegraded`, `signalDegraded` → deduped `parser_degraded` SSE, `readClaudeJson`). EVERY `~/.claude` parser is now degrade-guarded — a present-but-unparseable file emits `parser_degraded` + a distinguishable marker instead of silently returning empty/null. Client: `ParserDegradedBanner` + a `parser_degraded` channel in `useSSE` | HIGH #1 | `server/lib/claude-format.js`, all `server/parsers/*` + `server/lib/session-discovery.js`, client `ParserDegradedBanner` + `useSSE` |
| **1f/1g** | Durable Fleet: `reconcileFleetRuns()` boot reconciler (wired in `index.js`) cross-checks pid liveness and marks unrecoverable non-terminal runs the new terminal status `orphaned`. Settle is now a pure predicate (`allChildrenSettled`) + idempotent `maybeFinalize`; `child.pid` captured via an `onSpawn` hook. Global kill-switch at `/api/fleet/kill` (GET/POST/DELETE). `fleet-run.schema.json` adds `orphaned` + `child.pid`; `schemaVersion` → **6** | HIGH #2 | `server/fleet/fleet-runner.js`, `server/index.js`, `server/routes/fleet.js`, `packages/contracts/schemas/fleet-run.schema.json` |

**Loose ends also landed:** real-child e2e Fleet test (verify→reject→retry→synthesis,
closes HIGH #3) + the kill-and-restart durability test, both in the gated lane;
python `_SCHEMA_VERSION_FALLBACK` 5→6 with a parity test guarding fallback drift;
`.gitignore` now ignores `apps/cockpit/server/data/fleet/` and `data/fleet-templates/`
(`session-names.json` stays tracked); `test_contract.py` now **fails** (not skips)
when `jsonschema` is absent.

## 3. How to run / verify

**Install topology — root `npm install` is not enough.** The cockpit manages its
own `server/` and `client/` via `cd` scripts; both need their own installs before
tests will run.

```
npm install                                   # root: cockpit + contracts workspaces
npm --prefix apps/cockpit/server install       # server deps
npm --prefix apps/cockpit/client install       # client deps
```

Tests, per subproject:

```
# Server (Vitest) — 981
cd apps/cockpit/server && npx vitest run

# Client (Vitest) — 504
cd apps/cockpit/client && npx vitest run

# Both at once (from apps/cockpit)
npm --prefix apps/cockpit test

# Python harness (pytest) — 77 (1 skip)
cd packages/harness && pytest

# Gated e2e — 2 real-subprocess tests, opt-in
cd apps/cockpit/server && RUN_E2E=1 npx vitest run --config vitest.e2e.config.js
```

Without `RUN_E2E=1` the e2e include set is empty and the lane exits 0 (clean
no-op). The gated lane drives a real verify→reject→retry→synthesis cycle plus the
kill-and-restart durability test.

## 4. What's next — PARKED at the reassessment gate

Phases 2–4 are intentionally not started. Three **open decisions** must be resolved
before Phase-2 code:

1. **Verification cost ceiling** — stronger verify defaults multiply tokens; pick a
   defensible ceiling.
2. **Cross-vendor scope** — either build a real Cursor/Codex oversight reader or
   honestly drop the cross-vendor label (ADR-0005 / DOD L3).
3. **Trust-grant UX** — un-defaulting `--dangerously-skip-permissions` (item 1b)
   changed the zero-setup front-door experience; decide how the operator grants
   per-cwd trust.

**Deferred features (conscious, not forgotten):**

- Trust-grant UI/route. `lib/trust-store.js` has `trustCwd()`, but **no route wires
  it yet** — the store is write-capable, the UI is not built.
- `/api/fleet/kill` already exists server-side; the `orphaned` UI badge is not built.
- `parser_recovered` self-clear SSE event (banner currently does not auto-clear).
- Real-key nightly e2e (the gated lane uses stubbed subprocesses by default).

**Phase 2 starting point:** `pipeline-phase.schema.json` is built, exported, and
schema-versioned (`SCHEMA_VERSION` 5 added it) but **not yet consumed** — it is the
spine contract waiting to be wired.

## 5. Pointers

- **ADRs:** `docs/adr/` (0004–0007, plus `0000-template.md` and `README.md`).
- **Scope manifest:** `SCOPE.md`. **DoD ladder:** `DOD-LADDER.md`.
- **Full plan:** `~/.claude/plans/do-what-you-need-ticklish-flamingo.md`.
- **Council + premortem artifacts** are retained locally and **gitignored**
  (`council-*.{md,html,json}` at repo root).
- **Contract boundary reminder:** if the dashboard needs new data, the harness
  emits it via `harness status --json` and the cockpit consumes it — never duplicate
  harness parsing in the cockpit.
