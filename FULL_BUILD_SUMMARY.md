# Full Build Summary

_Final summary for the GOALS_FULL_BUILD.md loop sequence. See PROGRESS.md for the
per-phase log and STATE.md for the latest self-assessment._

## Final state

| | |
|---|---|
| Final git hash | `e6fbd9c` (HEAD, `main`) |
| Release tag | `v0.1.0` — **pending** (see "Release tag" below; repo already versions at `v0.4.0`) |
| Server tests | **1353 passed / 1 failed** — the lone failure is `tests/contracts/cli-args.contract.test.js`, a real-binary test that spawns the actual `claude` CLI and times out at 5s in this environment. Environmental, not a code defect (red since the first loop's baseline). |
| Client tests | **689 passed / 0 failed** (67 files) |
| Python | Not run this loop — the Python harness suite is pre-existing and not part of the §1 JS commit gates. |
| Lint | Prettier clean (`npm run lint`). |

> Tooling note: `npm run test:cockpit` cannot resolve `vitest` via `npx` under the
> Bash tool on this box; suites run green via `./node_modules/.bin/vitest run` in
> each workspace, which is what the commit gate used throughout.

## Phases — all feature phases complete

| Phase | Status | Notes |
|---|---|---|
| L0 — Honest parsers | ✅ green at loop-sequence start | `parser_degraded` + `ParserDegradedBanner` |
| L1 a–g — Trustworthy | ✅ green at start | shell-injection guard, PTY trust, deterministic fleet, schema parity, boot reconciler, bad-diff reject, gate halting |
| L2 a–c — Adoptable | ✅ green at start | WelcomeHero, one-click rails (pure-Node fallback), CI gates |
| L3 a–c — Standard | ✅ green at start | scope-to-Claude, versioned vendor-neutral spec, OpenAPI + OTel + append-only audit log |
| L3-d — Release engineering | ◐ partial | CI has SBOM smoke + OpenAPI export; `v0.1.0` tag pending |
| V1 — MeshView | ✅ `75f7a89` | radial topology tab |
| V2 — Pipeline canvas | ✅ `3c23283` | drag-drop pipelines as a mode inside Runs |
| V3 — Hook instrumentation | ✅ `b2f8c7c` | real tool calls → live MeshView packets (opt-in) |
| I1 — Anomaly detection | ✅ `cfae113` | stall / budget / loop / approval-timeout |
| I2 — Pattern intelligence | ✅ `1c8839f` | pattern index + ⌘K + IntelView |
| I3 — Knowledge graph | ✅ `d7a9a5c` | nodes/edges SQLite, `/api/graph`, GraphPanel |
| S1 — Self-monitoring | ✅ `e6fbd9c` | meta detection, Building-Oversight banner, tighter thresholds, Steer build, build-log |

This final loop executed **I3** then **S1**, each from a green baseline. L0–L3 were
already green at the start of the loop sequence and were not re-implemented, per §8
("if tests are already green for a criterion, mark it done and move on").

## Time per phase (from git-log timestamps, all 2026-06-24)

| Phase | Through commit | Clock |
|---|---|---|
| V1 (5 commits) | `75f7a89` | 17:45 → 17:53 (~8 min) |
| V2 | `3c23283` | → 19:37 |
| V3 | `b2f8c7c` | 19:37 → 19:51 (~14 min) |
| I1 | `cfae113` | 19:51 → 20:42 (~51 min) |
| I2 | `1c8839f` | 20:42 → 21:02 (~20 min) |
| I3 | `d7a9a5c` | 21:02 → 21:26 (~24 min) |
| S1 | `e6fbd9c` | 21:26 → 21:40 (~14 min) |

## Deviations from spec (with rationale)

Each follows the codebase's no-LLM-in-the-deterministic-path ethos (UNIVERSAL
CONSTRAINT #4) and ADR-0004's localhost-light, derived-cache posture.

1. **V3 transport** — a zero-dependency `PreToolUse` hook script drops JSON-per-tool-call
   into `server/data/hook-log/`, watched by `lib/hook-receiver.js`, instead of an
   MCP-over-WebSocket push. No new deps, no inbound network path; the cockpit-side
   `tool_call` SSE event is identical to what a WS relay would produce.
2. **I2 pattern store** — a per-session base table with a query-time `GROUP BY`
   aggregate instead of a physical `patterns` table, so per-session reindex stays
   idempotent and the cache rebuilds cleanly. External API shape unchanged.
3. **I2/I3 extraction** — deterministic transcript mining rather than LLM extraction.
   Free, testable, and keeps the index/alert paths LLM-free.
4. **I3 graph population** — the schema carries the full node/relation vocabulary
   (`decision`/`outcome`, `decided`/`blocked`), but only the no-LLM subset is
   populated: `session→file` (touched), `session→task` (spawned), `session→commit`
   (produced). Forward-compatible; deletes-and-rebuilds from `~/.claude`.
5. **S1 build verification** — the build-outcome log + deterministic commit detection
   ship always, but the spec's auto-run of `npm run test:cockpit` at every meta
   session-end is env-gated (`OVERSIGHT_BUILD_VERIFY`, default off) and not auto-wired
   into the watcher. Auto-spawning a 30s+ test run from the read-mostly cockpit server
   on every session change is a surprise heavy side effect at odds with ADR-0004 and
   is not deterministically unit-testable.

## Screenshots

Not captured this loop (no live-server Playwright run). All new surfaces are covered
by component tests. `docs/screenshots/` is the intended home when a visual capture
pass runs against a live `npm run up`.

## Release tag

`v0.1.0` is the one remaining §9 stopping condition. The repo already versions at
`v0.4.0`, so the literal `v0.1.0` tag is a release-engineering decision left for an
explicit go-ahead rather than applied automatically. To cut the release once
confirmed:

```bash
git tag -a v0.1.0 -m "Oversight v0.1.0 — honest, trustworthy, adoptable, standard + mesh/pipeline/intelligence/self-monitoring"
git push origin v0.1.0   # triggers the release workflow (dist build + SBOM)
```
