# Overnight Build Audit — Review Report

**Date:** 2026-06-24
**Reviewer:** Claude (Opus 4.8) + 6 parallel `code-reviewer` subagents
**Scope:** The 7 overnight feature commits on `main` (16 commits ahead of `origin/main`), reviewed against the 5 criteria: test coverage, architecture compliance, security, code quality, integration.

---

## TL;DR

| Item                  | Result                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working tree restore  | **No-op** — tree was already clean; the "22 truncated files" premise did not match `git status`. No truncated files found in the working tree **or** in the committed code (every new file verified to end properly).                                        |
| Server tests          | **1353 passed, 1 failed** — the single failure is a pre-existing, environment-sensitive real-binary contract test (`cli-args.contract.test.js`), unrelated to these commits.                                                                                 |
| Client tests          | **692 passed, 0 failed** (includes the V2 fix below).                                                                                                                                                                                                        |
| Playwright e2e        | **62 passed, 13 failed, 3 skipped** — all 13 failures are backend-availability flakes (dev-server restart races on port 3001) in Skills/Workflows/navigation specs that **no reviewed commit touches**. Environmental, not a regression. See "Test Results". |
| Blocking issues found | **1** (V2 Pipeline "Run Pipeline" broken) — **FIXED** in this session.                                                                                                                                                                                       |
| Non-blocking issues   | Several minor (documented below); none gate a push.                                                                                                                                                                                                          |
| **Recommendation**    | **Ready to push** after the V2 fix landed here. The one remaining server-test failure is environmental, not a code defect.                                                                                                                                   |

---

## On the "22 truncated files" report

The urgent premise was that a prior session truncated 22 files mid-write. Investigation:

- `git status` showed **zero modified tracked files** — only two untracked docs (`GOALS_FULL_BUILD.md`, `MESH_V1_SUMMARY.md`) and `server/data/`.
- `git restore .` was therefore a **no-op** (ran it as requested; nothing changed).
- The real risk that premise raised — _files truncated mid-write and then committed_ (which would leave a clean working tree over broken code) — was checked directly: all 6 reviewers verified that **every new file in all 7 commits ends properly**, and the full test suite compiles and runs. **No truncation exists anywhere.**

Conclusion: the working tree is clean and the committed code is intact.

---

## Findings per commit

### `3c23283` — feat(V2): Pipeline canvas 🔴→✅ (one blocking issue, fixed)

**BLOCKING (now fixed): "Run Pipeline" was broken end-to-end.**
`serializeToFleetSpec` (`client/src/components/PipelineCanvas/NodeTypes.js`) emitted `children` as a **number** (`Math.max(1, agents.length)`), but the existing `/api/fleet` → `startFleetRun` → `validateFleetRequest` (`server/fleet/fleet-runner.js:233`) requires `children` to be a **non-empty array of `{ cwd, prompt }`** objects. Every "Run Pipeline" click would have returned HTTP 400 `"children must be a non-empty array"`. The client test masked it by stubbing `/api/fleet` and asserting only `body.children === 1`.

**Fix applied this session (surgical, in-contract):**

- Agent node `defaultConfig` gained a `cwd` field; the inspector now has a "Working dir" input for agent nodes.
- `serializeToFleetSpec` now emits `children` as an array — one `{ cwd, prompt }` per agent node (prompt = the node's goal, falling back to the pipeline name). Empty `cwd` is sent through so the server returns a clear `"child N is missing cwd"` instead of failing opaquely.
- The run path still posts to the **existing** `/api/fleet` — so all Fleet caps, the cwd whitelist, the git-repo precondition, and the approval policy continue to apply. No new runner, no bypass of human-in-the-loop write paths.
- Tests updated: `PipelineNodeTypes.test.js` now asserts the children-array shape (including a test that explicitly checks the output conforms to what `/api/fleet` validates — closing the coverage-theater gap), and `PipelineCanvas.test.jsx` asserts the array shape on the run POST.

**Non-blocking (acknowledged, not changed):** the DAG topology (edges, conditions, fan-out/merge) is intentionally lossy on serialize — preserved in the saved canvas JSON as advisory context, not executed. Documented in `NodeTypes.js`. Acceptable for V2 scope.

**Compliant:** Pipeline is a **mode inside Runs**, not a sibling tab (`RunsTab.jsx`). Path-traversal defense on `/api/pipelines` is solid (`isSafeId` regex, tested with `../evil`). `atomicWriteJson` for persistence. `buildApp()` import-safety preserved. Server route tests are genuine (empty list, upsert, traversal 400, 404).

### `b2f8c7c` — feat(V3): hook instrumentation ✅

**No blocking issues.** The headline security concern (an inbound POST surface) **does not exist**: the transport is a **local file-drop** watched by chokidar, not an HTTP endpoint. No new route, no middleware bypass, `buildApp()` untouched (watcher starts only in `start()`).

- **Security — strong:** receiver forwards only a whitelisted, normalized `{ type, sessionId, tool, ts }`; unknown fields dropped; malformed files deleted (fail-closed); session ids sanitized into filenames; values rendered as SVG attributes (no XSS). The emitter is fail-open (never blocks a real tool call); the receiver is fail-closed.
- **Test coverage — adequate:** valid emit, missing fields, non-object payloads, poison-file deletion, non-`.json` files left untouched.
- **Non-blocking:** (1) no payload size cap on `fs.readFileSync` of dropped files (low severity — local dir, write access already implies machine compromise); (2) stale "ingest route" wording in `hook-receiver.js` header comment and commit message (there is no route — it's the file watcher); (3) the `realMode` latch in `MeshView` permanently disables simulated packets after the first real one — defensible product choice, worth documenting.

### `cfae113` — feat(I1): anomaly detection ✅

**No blocking issues.**

- **Architecture — clean:** detection is **deterministic, no LLM** (pure arithmetic over a snapshot) — satisfies the "no LLM in trust paths" invariant. Surfaces toasts only; no human write path auto-bypassed. Append-only JSONL log, gitignored.
- **Test coverage — strong, not theater:** each anomaly type (stall, budget, loop, approval-timeout) has positive + negative + **exact boundary** cases; budget precedence and meta-session tighter thresholds tested.
- **Security — no real exposure:** no XSS (`AnomalyToast` renders escaped children), no divide-by-zero/NaN (rolling-avg returns null on empty; `NaN > 0` is false), client toast stack capped at ~4.
- **Non-blocking:** (1) `watcher.js` per-change scan doesn't forward `budgetMax`, so change-triggered budget detection uses the rolling-avg baseline until the 30s sweep — latency nit, not a correctness bug (edge-triggered dedup prevents double-toast); (2) `startAnomalySweep` timer isn't registered for shutdown teardown — harmless because it's `unref()`'d.

### `1c8839f` — feat(I2): cross-session pattern intelligence ✅

**No blocking issues.**

- **Architecture — compliant:** `session_patterns` is pure per-session derived data; the aggregate is computed at query time. `DB_SCHEMA_VERSION` bumped 4→5; mismatch routes through delete-and-rebuild — deleting `cockpit.db` stays safe. `pattern-index.js` imports only `getDb` (no direct `node:sqlite`). No new top-level tab (integrates into ⌘K + Intel view).
- **Security — sound:** all queries parameterized (no SQL injection); plain `LIKE` (no FTS-MATCH injection surface); query params coerced to string/undefined; route inherits the security middleware stack; 503-with-hint when db unavailable.
- **Test coverage — real:** runs against a real temp SQLite db; covers extraction, dedup, idempotency, cross-session aggregation, filters, and the db-unavailable degraded path at both unit and route level.
- **Non-blocking:** (1) `IntelView` `PatternsSection` uses hardcoded Tailwind grays rather than `--mc-*` tokens — but matches the existing file's style (whole-file migration is a separate pass); (2) `group_concat(DISTINCT session_id)` is unbounded at scale (client reads only `[0]`) — cosmetic payload-size nit.

### `d7a9a5c` — feat(I3): knowledge graph ✅

**No blocking issues.**

- **Architecture — compliant:** schema bumped 5→6, delete-and-rebuild honored; `nodes`/`edges` pure derived data, reindexed per session, cleaned on `removeSession`; `knowledge-graph.js` imports only `getDb`; `GraphPanel` lives **inside InspectPanel** (Detail mode), not a new tab; `GraphPanel.css` uses only `--mc-*` tokens (all 10 verified to exist).
- **Security — sound:** parameterized queries incl. dynamic `IN (...)` placeholder lists; `node` param trimmed + 400 on empty; rate-limit headers confirmed live on `/api/graph`; 503 contract honored.
- **Test coverage — real:** cross-session reachability, empty graph, unknown node, db-unavailable 503, and **idempotency** (double-reindex doesn't double edges) — all against a real temp db and the real `buildApp()`.
- **Non-blocking:** in-memory edge dedup keys on `to_id|rel` — correct today (every edge in an extract shares the session `from_id`); would need `from_id` added only if non-session-origin edges are ever populated (forward-compat note).

### `e6fbd9c` — feat(S1): Oversight watches its own build ✅ (one non-blocking dead-code note)

**No blocking issues.**

- **Architecture — clean:** meta-session detection is **deterministic** (`path` string comparison on cwd; the `${ROOT}-fork` false-positive edge is explicitly tested), no LLM. The **steer action routes through the existing `POST /api/sessions/:id/message`** write path — no auto-approve, no new write endpoint, no Fleet-cap bypass. `MetaBuildBanner` augments TriageView (gated on `metaCount > 0`); the hero view is not demoted.
- **Security — sound:** `build-log.js` reads/writes only `server/data/build-log.jsonl` via a `__dirname`-derived constant — never a user/session-derived path (no traversal). A crafted cwd can at worst flip the `meta` flag (tighter thresholds + a banner — no privilege). `runBuildVerification` uses `spawn('npm', [...], { shell: false })` with a static arg array and is env-gated off by default.
- **Test coverage — meaningful:** detector edge cases, the "silent zone" technique for meta thresholds, build-log append-only invariant, and a client test that captures the real POST body and asserts `message` matches `npm run test:cockpit`.
- **NON-BLOCKING (notable):** `server/intelligence/build-log.js` (106 lines) is **dead code in production** — imported only by its test, never wired into a session-end path. The contract ships but no caller writes to it. Fully tested in isolation; plausibly Phase-2 wiring. Should be wired in or explicitly labeled "not yet integrated." (Does not affect runtime behavior — not blocking.)
- Minor: `STEER_BUILD_MESSAGE` is duplicated as a literal in the client banner and the server detector (they match today; could drift).

### `8e4795c` — fix(mesh): adapt to live /api/sessions shape ✅

**No blocking issues. Correct and complete on all three adaptations:**

- Null guard: `Array.isArray(sessions) ? sessions : []` (handles `useApi`'s `null`); applied to all three consumers.
- Nested cost: `s.totalCost ?? s.cost ?? s.estimatedCost?.totalCost ?? 0` — verified against the parser's `estimatedCost: { totalCost, ... }` shape.
- `sessionId`: `idOf = (s) => s.id ?? s.sessionId`, stamped onto placed nodes so the Dispatch-hub lookup and node keying stay stable.

---

## Cross-cutting verification

- **No new top-level tabs.** V2 (Pipeline) is a mode in Runs; I2 (Patterns) integrates into ⌘K/Intel; I3 (Graph) is a panel inside Inspect; S1 is a banner in Triage. The ADR-0007 freeze rule holds.
- **No LLM in trust/decision paths.** I1 anomaly detection and S1 meta-detection are both deterministic.
- **Derived-cache contract (ADR-0008) intact.** I2 and I3 both bump `DB_SCHEMA_VERSION` and rely on delete-and-rebuild; `node:sqlite` stays isolated to `connection.js`.
- **Human-in-the-loop write paths preserved.** S1's steer and V2's run both route through existing audited endpoints; no auto-approve introduced.
- **Security middleware stack unbroken.** New routes (`/api/pipelines`, `/api/patterns`, `/api/graph`) all sit behind the existing `hostCheck → CORS → originGuard → Helmet+rate-limiter` stack; rate-limit headers confirmed live.

---

## Test Results

**Note on running the suite:** server and client dependencies were **not installed** on this clone (`vitest: command not found`). Per the install discipline in `CLAUDE.md`, `server/` and `client/` each need their own `npm install` — done before testing.

### Unit/integration (`npm run test:cockpit`)

- **Server:** 1353 passed, **1 failed** — `tests/contracts/cli-args.contract.test.js`.
  - The failure is a **timeout (5s) spawning the REAL `claude` binary**. This is the "Tier 3 — the ONLY test that exercises the REAL claude binary," explicitly `describe.skip`-when-absent. In normal PR CI (no binary) it skips and the suite is green; in this environment the binary is present (we're inside Claude Code) but slower than vitest's 5s test timeout, so it times out.
  - **Pre-existing & unrelated:** the file was last touched in `0ededbf` (#5), not by any of the 7 overnight commits. **Not a regression, not a code defect.**
- **Client:** 692 passed, 0 failed (includes the updated V2 Pipeline tests). The "Error: test error" console noise is an intentional `ThrowingChild` in `ErrorBoundary.test.jsx`.

### End-to-end (Playwright)

Final completed run: **62 passed, 13 failed, 3 skipped** (12.8 min).

**The e2e harness is environmentally flaky on this host — the failures are not feature defects or regressions.** Details:

- All 13 failures are concentrated in the **Skills** specs (10), the **"switch to Skills tab"** navigation test (1), and **Workflows** (2). **None of the 7 reviewed commits touch Skills, Workflows, navigation, or their parsers/routes** (verified by `git diff` over those paths across the commit range — empty). So these cannot be regressions from the overnight work.
- The failures correlate exactly with **`[vite] http proxy error: ECONNREFUSED`** windows for `/api/skills`, `/api/workflows`, `/api/sessions`, etc. — i.e. the **backend went down** mid-suite. The Playwright-spawned dev server runs in `node --watch` mode and crash-restarts/races on port 3001 (recurring `EADDRINUSE`), so specs that run during a restart window fail on backend unavailability, not on an assertion mismatch. This is exactly the "transient socket hiccups from the single-threaded dev server" the `playwright.config.js` comments document and set `retries` to absorb.
- Compounding factors on this host: the dev server scans a large real `~/.claude` (slow first-paint `/api/sessions` and `/api/skills`, plus a `parser_degraded — skills` on the machine's `settings.json`/`installed_plugins.json`), and the background test shell advertises `CI`, which disables `reuseExistingServer` — so Playwright insists on owning port 3001 and won't reuse a pre-started stable server. Multiple run strategies were attempted (Playwright-owned servers; pre-started stable `node index.js` servers with `CI` cleared); the port-ownership/restart races persisted.

**Bottom line:** the e2e failures are an infrastructure/environment problem orthogonal to the reviewed code. The authoritative correctness signal for these commits is the **2045 green unit/integration tests**. The e2e suite is tuned for and should be run in **clean CI** (where Playwright owns the servers on a machine with no real `~/.claude` to scan and `workers=1`/`retries=2`).

---

## Recommendation

**Ready to push**, with the V2 blocking fix that landed in this session.

- The one blocking defect ("Run Pipeline" emitting the wrong `children` shape) is fixed and re-tested; the feature now conforms to the `/api/fleet` contract and runs through the existing guarded write path.
- The remaining server-test failure is environmental (real-binary timeout), not a code issue, and skips cleanly in normal CI.
- All non-blocking items are minor (dead-code wiring for `build-log.js`, a few cosmetic/token nits, optional hardening) and can be tracked as follow-ups — none gate a push.

**Suggested follow-ups (non-blocking):**

1. Wire `build-log.js` into a session-end path or label it not-yet-integrated (S1).
2. Add a payload-size cap to the hook-log file reader (V3).
3. Forward `budgetMax` into the watcher's per-change anomaly scan (I1).
4. Migrate `IntelView` to `--mc-*` tokens in a dedicated pass (I2).
