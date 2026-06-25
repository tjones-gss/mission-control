# Full Build Summary

_Loop date: 2026-06-24. Driven by GOALS_FULL_BUILD.md §1 self-assessment._

## What this loop delivered

Two complete phases, each TDD-first, committed on green, lint-clean:

| Phase | Commit | What landed |
|---|---|---|
| **V2 — Pipeline Canvas** | `3c23283` | Drag-drop SVG pipeline composer as a **mode inside Runs** (not a sibling tab). 7 node types, persists to `server/data/pipelines/` via new `GET/POST /api/pipelines`, "Run Pipeline" serialises to the existing `POST /api/fleet` batch — no new runner. |
| **V3 — Hook Instrumentation** | `b2f8c7c` | Opt-in hook bridge turns real Claude Code tool calls into live MeshView packets. File-drop transport → `lib/hook-receiver.js` watches `server/data/hook-log/` → `tool_call` SSE → MeshView real packets, with simulated fallback preserved. |

## Final state

- **Final git hash:** `b2f8c7c` (HEAD on `main`)
- **Tag:** `v0.4.0` is the latest existing tag. **`v0.1.0` NOT applied** — the spec's §9 "done" tag is `v0.1.0`, but the repo already versions at 0.4.0; tagging is deferred to the release phase (L3-d) and was out of scope for this loop. Flagged, not silently skipped.
- **Branch:** committed directly to `main`, matching the V1 (MeshView) commit pattern and the GOALS loop protocol ("commit, update the progress log... no manual intervention between loops").

## Test counts

| Suite | Start of loop | End of loop |
|---|---|---|
| Server (vitest) | 1256 pass / 1 fail | **1282 pass / 1 fail** (+26: 11 pipelines, 9 hook-receiver, 6 hook-emitter) |
| Client (vitest) | 642 pass / 0 fail | **662 pass / 0 fail** (+20: 8 NodeTypes, 7 PipelineCanvas, 1 RunsTab, 4 MeshView V3; useSSE/FeatureBrief guards updated) |
| Python | not run this loop (not in §1 JS gates; pre-existing suite) | — |

### The 1 server failure (pre-existing, environmental — NOT introduced by this loop)

`tests/contracts/cli-args.contract.test.js > rejects --output-format stream-json WITHOUT --verbose` — a **real-binary** test that spawns the actual `claude` CLI and times out at 5s on this box. It was red at the start of the loop (baseline) and is unrelated to any code changed here (pipelines/hooks/mesh). Lint (`prettier --check .`) is fully green.

## DoD ladder — status (verified this loop)

All of L0–L3 are green or effectively green; the self-assessment found far more already built than the spec's `[ ]` checklist implied:

- **L0-a/b, L1-a..g** — green (artifacts + passing suites: `ParserDegradedBanner`, `trust-store`, `reconcileFleetRuns`, schema-version single-source + CI parity, fleet/loop suites).
- **L2-a** — `WelcomeHero.jsx` ✓. **L2-b** — `routes/rails.js` + `lib/rails-installer.js` pure-Node fallback ✓. **L2-c** — `ci.yml` gates server+client `--coverage`, e2e job, parity, lint ✓.
- **L3-a** — no multi-vendor reader text in client ✓. **L3-b** — `contracts/SPEC.md` + `generate-spec` ✓. **L3-c** — `mountOpenApi` serves `/api/docs`, `lib/otel.js`, audit-log wired to sessions/trust/fleet ✓. **L3-d** — CI has SBOM smoke + OpenAPI export; `v0.1.0` tag deferred (`~`).
- **V1** — MeshView ✓ (`8e4795c`). **V2/V3** — this loop ✓.

## Deviations from spec (with rationale)

1. **V3 transport: file-drop + hook script, not MCP-over-WebSocket.** The spec sketched an MCP server emitting WebSocket events. Shipped instead: a zero-dependency `PreToolUse` hook script (`packages/hook-server/index.js`) that drops one JSON-per-tool-call into `server/data/hook-log/`, which the cockpit watches via chokidar. Rationale: no new deps (the constraint), **no inbound network path** (ADR-0004 localhost-first), and it reuses the L2-b hook-log directory. The cockpit-side contract (a `tool_call` SSE event) is byte-identical to what a WS relay would produce. Documented in `packages/hook-server/README.md`.
2. **V3 file-watch lives in `lib/hook-receiver.js` + a boot-started watcher, not by editing `watcher.js`.** A dedicated, self-contained watcher avoids branching the core multi-root watcher (and risking its existing test suite) for a server/data path; the `tool_call` event still flows on the shared `emit()` SSE channel ("relayed").
3. **`v0.1.0` not tagged** (see Final state) — repo is already at `v0.4.0`; tagging belongs to the L3-d release pass.

## Where the loop stopped, and why

Stopped after V3 — a **clean, disciplined stop**, not a blocker. L0–L3 and V1–V3 are all complete; the next phase in §8 order is **I1 (Session Anomaly Detection)**, an entirely-unbuilt phase of comparable size to V3 with substantial live wiring (SSE `anomaly` event, `anomalies.jsonl`, triggers + App integration). Remaining context was insufficient to complete I1 *and* keep it green in one atomic commit; starting it would have risked a half-finished, uncommitted phase, violating §7.9 ("commit only on green"). `PROGRESS.md` and `STATE.md` leave a clean baseline pointing the next loop at I1.

## Screenshots

None captured this loop (no live-server Playwright run; the dev servers were not started). The Pipeline canvas and MeshView real-packet paths are covered by component tests. `docs/screenshots/` capture is deferred to a loop that runs `npm run up` + Playwright.

## Time per phase (from git log timestamps)

- V2: through `3c23283` @ 19:37:06
- V3: through `b2f8c7c` @ 19:51:23 (~14 min of wall-clock between commits)
- (Self-assessment + STATE/PROGRESS preceded V2 from loop start ~19:16.)
