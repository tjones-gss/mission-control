# Oversight — Full Build Goal Spec

> The comprehensive, self-selecting goal for Claude Code loops.
> **Read this entire document before writing a single line of code.**
> Read CLAUDE.md, SCOPE.md, DOD-LADDER.md, and all referenced ADRs.
> Then read the SELF-ASSESSMENT protocol in §1 to determine where to start.

---

## The Vision

Oversight becomes the definitive orchestration cockpit for autonomous AI agents:
a tool that **sees** every session in real time, **understands** what each agent is doing
and why it might be going wrong, **acts** by spawning pipelines and steering agents
mid-flight, and **learns** by building a knowledge graph of every decision and outcome
across all runs. It is self-referential: it can watch — and improve — its own construction.

No cloud. No telemetry leaving the machine. No external dependencies beyond the
local Claude Code install. Everything persists in `~/.claude` and `server/data/`.
The user controls every byte.

This spec drives a sequence of Claude Code loops to completion. Each loop reads
the self-assessment, executes the highest-priority uncompleted work, commits,
and updates the progress log. There is no manual intervention between loops.

---

## §1 — SELF-ASSESSMENT PROTOCOL

**Run this at the start of every loop. Do not skip it.**

```bash
# 1. Check test baseline
npm run test:cockpit 2>&1 | tail -5

# 2. Check DoD L0 criteria (honest parsers)
npm --prefix apps/cockpit test:server -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL).*parser"

# 3. Check DoD L1 criteria (security + fleet)
npm --prefix apps/cockpit test:server -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL).*(cli|pty|fleet|schema)"

# 4. Check DoD L2 criteria (adoptable)
npm --prefix apps/cockpit test:client -- --reporter=verbose 2>&1 | grep -E "(PASS|FAIL).*(welcome|WelcomeHero|rails)"

# 5. Check progress log
cat PROGRESS.md 2>/dev/null || echo "NO PROGRESS.md — start at Phase 0"

# 6. Check BLOCKER.md
cat BLOCKER.md 2>/dev/null && echo "BLOCKER EXISTS — read it before proceeding"
```

Write `STATE.md` with:
- Which DoD criteria are green vs red (per §3)
- Which phases are complete per PROGRESS.md
- Which phase to execute this run

Then execute exactly one phase. Update PROGRESS.md when the phase is done.

---

## §2 — PROGRESS LOG PROTOCOL

Maintain `PROGRESS.md` at the repo root. Format:

```markdown
# Build Progress

## DoD Status
- [ ] L0-a: parser_degraded emitted (honest parsers)
- [ ] L0-b: hooks/config distinguish failed vs empty
- [ ] L1-a: no Windows shell injection
- [ ] L1-b: PTY no skip-permissions without trust
- [ ] L1-c: no LLM in deterministic trust path
- [ ] L1-d: SCHEMA_VERSION single-sourced + CI parity
- [ ] L1-e: fleet survives mid-run restart (no wedge)
- [ ] L1-f: known-bad diff actually rejected
- [ ] L1-g: gates HALT dependent phases + check evidence
- [ ] L2-a: empty ~/.claude shows Welcome + first-agent CTA
- [ ] L2-b: one-click rails adoption (pure-Node fallback)
- [ ] L2-c: CI coverage + e2e gates block merge
- [ ] L3-a: cross-vendor oversight label dropped
- [ ] L3-b: harness status as versioned vendor-neutral spec
- [ ] L3-c: observability: OpenAPI + OTel + audit log
- [ ] L3-d: release engineering: semver, CHANGELOG, SBOM

## Visual + Orchestration Phases
- [ ] V1: MeshView topology tab (complete — commit 8e4795c)
- [ ] V2: Pipeline canvas (drag-drop agent pipelines in Runs tab)
- [ ] V3: Hook instrumentation (real tool calls → live animation)

## Intelligence Phases
- [ ] I1: Session anomaly detection + alert system
- [ ] I2: Cross-session pattern intelligence
- [ ] I3: Knowledge graph (decisions + outcomes)

## Self-Improvement Phase
- [ ] S1: Oversight monitors its own build sessions
```

Check each criterion against CI output. Mark `[x]` when the corresponding test passes and the criterion is verifiable on the current machine.

---

## §3 — DOD LADDER PHASES (L0 → L3)

These are the reliability and trust foundations. Complete all of these before any Visual or Intelligence phase. The DoD criteria are specified in DOD-LADDER.md — read that file. This section adds only execution guidance.

### Phase L0 — HONEST (parser integrity)

**Goal:** No silent failures. Every parse error surfaces a `parser_degraded` event. No blank UI hiding a broken parser.

**Work to do:**
- All three critical parsers (`sessions.js`, `config.js`, `hooks.js`) emit `parser_degraded` SSE when they throw, never swallow silently.
- `hooks.js` and `config.js` return a typed error marker (`{ _degraded: true, reason: string }`) when parse fails, never a bare `{}`.
- Parser tests assert: (a) parse failure emits degraded event, (b) empty config ≠ failed config.
- `ParserDegradedBanner.jsx` client test asserts the banner renders when `parser_degraded` fires.

**Verification:** `npm --prefix apps/cockpit test:server -- tests/parsers/` → green.

**Commit:** `fix(L0): honest parser_degraded — sessions, config, hooks`

---

### Phase L1 — TRUSTWORTHY (security + fleet reliability)

Execute each criterion as a separate commit. Order matters: security first, fleet second.

**L1-a — No Windows shell injection:**
- `claude-cli.js` `buildSpawn()` resolves `.cmd`/`.ps1` to explicit interpreter. Never `shell: true`.
- Test: metacharacter roundtrip (`; rm -rf /tmp/test`) arrives as literal argv, not executed.
- Commit: `fix(L1-a): no shell:true on Windows — explicit interpreter for .cmd/.ps1`

**L1-b — PTY no skip-permissions without trust:**
- `pty-session.js` never passes `--dangerously-skip-permissions` unless the CWD has a persisted trust grant.
- Trust grant stored in `server/data/trust/` (keyed by cwd hash). UI to grant trust in the session detail view.
- Test: spawn without trust grant → flag absent; grant trust → flag present.
- Commit: `fix(L1-b): PTY skip-permissions gated by per-cwd trust grant`

**L1-c — No LLM in trust path:**
- Fleet escalation calls `harness status --json` directly via child_process. Never spawns a Claude session to make approval decisions.
- Test: mock harness CLI returns APPROVED/REJECTED; assert no `claude` binary was spawned.
- Commit: `fix(L1-c): fleet escalation is deterministic — no claude session in trust path`

**L1-d — SCHEMA_VERSION single-sourced:**
- `packages/contracts/schema-version.json` is the single source of truth. Both `index.js` and `harness_orchestrator/contracts.py` read from it.
- CI parity step: `node scripts/check-schema-parity.js` fails (non-zero exit) if JS and Python disagree on version.
- Commit: `fix(L1-d): SCHEMA_VERSION single-sourced — CI parity gate`

**L1-e — Fleet survives mid-run restart:**
- Boot reconciler (`reconcileFleetRuns()`) marks any run still `running` at startup as `orphaned`.
- Kill-and-restart e2e: start a fleet run, kill the server process, restart, assert run is `orphaned` not stuck `running`.
- Commit: `fix(L1-e): fleet boot reconciler — no wedged running runs after restart`

**L1-f — Verification is not theater:**
- A known-bad diff (deliberate regression injected into a test fixture) must be REJECTED by the verification gate, not approved.
- Real child e2e test: fleet run on a fixture repo → harness rejects bad diff → fleet records `rejected` → run retries.
- Commit: `test(L1-f): real-child e2e — bad diff is actually rejected, not approved`

**L1-g — Gates HALT dependent phases:**
- `loop.py` control flow: a failing gate stops execution of all downstream phases, not just the current one.
- Evidence gates require an actual file artifact to check, not just a return code.
- Commit: `fix(L1-g): loop gates halt downstream phases — evidence-based checks`

---

### Phase L2 — ADOPTABLE (first-run experience)

**L2-a — Empty front door:**
- `WelcomeHero.jsx` renders when `sessions.length === 0` and no prior sessions exist.
- It shows: one sentence explaining Oversight, a "Start your first agent" button that opens the Dispatch drawer, and a link to the README.
- Test: mount with empty sessions → WelcomeHero renders; mount with 1 session → WelcomeHero absent.
- Commit: `feat(L2-a): WelcomeHero — empty ~/.claude shows first-agent CTA`

**L2-b — One-click rails adoption:**
- A "Enable Oversight Rails" button in Settings/Onboarding that writes the harness hook to the user's `~/.claude/settings.json` without requiring any Python setup.
- Pure-Node fallback: if Python is unavailable, installs a JS shim hook that logs tool calls to `server/data/hook-log/`.
- Test: mock settings.json write → assert hook entry present; assert no Python dependency in Node path.
- Commit: `feat(L2-b): one-click rails adoption — pure-Node hook fallback`

**L2-c — CI gates:**
- `.github/workflows/ci.yml` blocks merge if: coverage drops below thresholds, e2e suite fails, or parity check fails.
- Coverage thresholds ratcheted: never lower than the current passing floor.
- Commit: `ci(L2-c): coverage + e2e + parity gates block merge`

---

### Phase L3 — STANDARD (vendor-resistant)

**L3-a — Cross-vendor label dropped:**
- Remove any UI text or comments claiming multi-vendor support. Oversight watches Claude Code only.
- The harness contract (`harness status --json`) is the vendor bridge — not the viewer.
- ADR-0005 amendment: add a note that cross-vendor reach lives in the rails contract, not this app.
- Commit: `docs(L3-a): scope to Claude Code only — cross-vendor lives in the contract`

**L3-b — Harness status as versioned spec:**
- `packages/contracts/SPEC.md` documents the complete `harness status --json` schema as a vendor-neutral spec.
- Any third-party can implement the harness contract and Oversight will consume it.
- CI: `scripts/validate-harness-output.js` validates a known fixture against the contract.
- Commit: `docs(L3-b): harness status — versioned vendor-neutral spec + CI validation`

**L3-c — Observability: all three proofs:**
- (1) `/api/docs` serves OpenAPI 3.0 spec generated from route definitions.
- (2) `OTEL_ENABLED=true` enables in-process OTel tracing; test uses InMemorySpanExporter (no external collector).
- (3) `lib/audit-log.js` is wired to every spawn/approval/merge. The append-only invariant test asserts no record is ever mutated.
- Commit: `feat(L3-c): observability — OpenAPI + OTel + append-only audit log`

**L3-d — Release engineering:**
- Tag `v0.1.0`. `CHANGELOG.md` updated with all L0–L3 work. `RUNBOOK.md` covers install, upgrade, rollback.
- Release GitHub Action: on tag push, build dist, generate SBOM (`cyclonedx-node`), attach to release.
- Commit: `chore(L3-d): v0.1.0 release — semver, CHANGELOG, SBOM, release workflow`

---

## §4 — VISUAL + ORCHESTRATION PHASES

Complete L0–L1 before starting these. L2–L3 can run in parallel with V2/V3.

### Phase V1 — MeshView ✅ COMPLETE

Commit `8e4795c`. 642 client tests passing. Mark done in PROGRESS.md.

---

### Phase V2 — Pipeline Canvas

**Location:** `RunsTab/` → new `PipelineCanvas` mode. Respects the SCOPE.md IA ruling: "Runs is the single orchestration surface; Pipeline is a mode inside Runs — never a sibling tab." Do not add a new top-level tab.

**Outcome:**
1. Runs tab has a "Pipeline" mode button alongside the existing modes.
2. A drag-drop SVG canvas lets the user place and connect node types:
   - **Trigger** (clock/webhook/manual) — entry point
   - **Agent** (runs a Claude Code session with a goal) — core work node
   - **Skill** (invokes a specific skill inline) — fast sub-task
   - **Condition** (if/else branch on agent output) — control flow
   - **Fan-out** (parallel branches, all start simultaneously) — parallelism
   - **Merge** (waits for all Fan-out branches before continuing) — sync point
   - **Human** (pause and wait for human approval) — oversight gate
3. Clicking "Run Pipeline" serialises the canvas to a Fleet batch spec and submits it via the existing `POST /api/fleet` route. No new API routes.
4. Running pipelines visualise their state on the canvas in real time: nodes pulse when active, turn green when done, red when failed.
5. Canvas state is saved to `server/data/pipelines/` as JSON. Pipelines persist across restarts.

**New files:**
```
apps/cockpit/client/src/components/PipelineCanvas/
  PipelineCanvas.jsx   — the canvas component
  PipelineCanvas.css   — styles (--mc-* only)
  NodeTypes.js         — node type definitions and default configs
  index.js             — re-export
apps/cockpit/client/src/tests/components/PipelineCanvas.test.jsx
apps/cockpit/server/routes/pipelines.js    — GET/POST /api/pipelines (persist canvas state)
apps/cockpit/server/tests/routes/pipelines.test.js
```

**Key constraints:**
- `FleetTab.jsx` (~1049 LOC) must NOT be modified. Pipeline canvas is inside `RunsTab/` only.
- The canvas must work with 0 nodes (empty state shows an instruction prompt).
- Fleet execution uses the existing `fleet-runner.js` — no new runner.
- All `--mc-*` CSS variables. No hardcoded hex.

**Verification:**
```bash
npm run test:cockpit   # all suites pass
# Manual: drag 3 nodes onto canvas, connect them, hit Run — Fleet run appears in Runs tab
```

**Commit:** `feat(V2): Pipeline canvas — drag-drop agent pipelines in Runs/Pipeline mode`

---

### Phase V3 — Hook Instrumentation

**What this does:** Turns real Claude Code tool calls into live animated packets in the Mesh view. Right now the packets are simulated (random). After V3, each packet represents an actual tool invocation.

**Architecture:**
```
Claude Code session
  → tool call fires
  → Oversight MCP hook server intercepts
  → emits WebSocket event: { type: 'tool_call', sessionId, tool, timestamp }
  → cockpit SSE stream relays it
  → MeshView renders it as a real packet
```

**New files:**
```
packages/hook-server/
  index.js         — tiny MCP server (Node.js, no new deps beyond existing @modelcontextprotocol/sdk)
  hook-emitter.js  — emits structured events via the cockpit's existing SSE infrastructure
  README.md        — how to register this MCP in ~/.claude/settings.json
apps/cockpit/server/lib/hook-receiver.js   — receives hook events, adds to SSE stream
apps/cockpit/server/tests/lib/hook-receiver.test.js
```

**Changes to existing files:**
- `apps/cockpit/server/watcher.js` — add `tool_call` to the SSE event types it relays.
- `apps/cockpit/client/src/components/MeshView/MeshView.jsx` — update packet spawning to use real `tool_call` events instead of random timer when they're available; fall back to simulated when hook server isn't connected.

**Key constraint:** The hook server is **opt-in**. If not installed, Mesh view works exactly as it does today (simulated packets). Never break the non-hook path.

**Verification:**
```bash
# Start hook server alongside cockpit:
node packages/hook-server/index.js &
npm run up

# In another Claude Code session (any project), run a task with tool calls.
# Verify: the session's node in MeshView shows real packets during tool invocations.
npm run test:cockpit
```

**Commit:** `feat(V3): hook instrumentation — real tool calls as live packets in MeshView`

---

## §5 — INTELLIGENCE PHASES

Complete V1 before starting these. V2/V3 can run in parallel.

### Phase I1 — Session Anomaly Detection

The intelligence layer already exists (`server/intelligence/analyzer.js`, `server/intelligence/triggers.js`). This phase wires it to actionable UI alerts.

**Anomalies to detect:**
1. **Stall** — session has been `running` with no new messages for > 5 minutes.
2. **Budget overrun** — session cost exceeds `OVERSIGHT_BUDGET_MAX` (if set) or 10× the session's own 10-session rolling average.
3. **Infinite tool loop** — same tool called > 8 times in the last 10 tool calls with no human messages.
4. **Approval timeout** — a `tool_approval_request` has been pending for > 2 minutes without resolution.

**For each anomaly:**
- Server emits a new SSE event: `{ type: 'anomaly', sessionId, kind, detail, ts }`.
- Client shows a non-blocking notification toast (top-right, auto-dismiss after 8s, click to open session detail).
- Anomaly is logged to `server/data/anomalies.jsonl` (append-only).

**New files:**
```
apps/cockpit/server/intelligence/anomaly-detector.js
apps/cockpit/server/tests/intelligence/anomaly-detector.test.js
apps/cockpit/client/src/components/AnomalyToast.jsx
apps/cockpit/client/src/tests/components/AnomalyToast.test.jsx
```

**Verification:**
```bash
npm run test:cockpit
# Test: inject a stall fixture (last message > 5min ago) → anomaly event fires → toast renders
```

**Commit:** `feat(I1): anomaly detection — stall, budget, loop, approval-timeout alerts`

---

### Phase I2 — Cross-Session Pattern Intelligence

**What this does:** Builds a queryable index of patterns across all past sessions. "You always run tests after editing auth code — want me to add that to your pipeline?" "This error appeared in 4 sessions last week — here's what fixed it."

**Architecture:**
- `lib/db/pattern-index.js` — new SQLite table `patterns`: `(id, kind, trigger, response, count, last_seen, example_session_ids)`.
- After each session completes, `intelligence/analyzer.js` extracts patterns and upserts them.
- New route `GET /api/patterns?q=` — full-text search over the pattern index.
- `CommandPalette.jsx` — add "Patterns" result type. `⌘K → "auth test"` shows matching patterns.
- New `IntelView.jsx` section: "Patterns in this session" — patterns triggered by the current session's tool calls.

**Verification:**
```bash
npm run test:cockpit
# Manual: run 2+ sessions that do similar things. Open CommandPalette. Search for something both sessions did.
# Assert a pattern card appears.
```

**Commit:** `feat(I2): cross-session pattern intelligence — pattern index + ⌘K integration`

---

### Phase I3 — Knowledge Graph

**What this does:** Connects sessions, files, decisions, and outcomes into a graph. "Show me everything that touched auth.js." "Which sessions led to this commit?" "What decisions were made in the sessions that fixed this bug?"

**Architecture:**
- `lib/db/knowledge-graph.js` — new SQLite tables: `nodes (id, kind, label, meta)` and `edges (from_id, to_id, rel, ts)`.
  - Node kinds: `session`, `file`, `decision`, `outcome`, `commit`, `task`.
  - Edge relations: `touched`, `decided`, `produced`, `blocked`, `spawned`.
- The graph is populated by the existing watcher (file touches from bash tool calls), commit detection (git watcher on session CWDs), and the intelligence analyzer.
- New route `GET /api/graph?node=` — returns the 2-hop neighbourhood of a node as `{ nodes, edges }`.
- New `GraphPanel` component inside `InspectPanel/` — renders the neighbourhood as a force-layout mini-graph. Opens via "Show graph" button in session detail.

**Key constraint:** The graph is a derived cache. Deleting `cockpit.db` must rebuild it. Never treat the graph as authoritative state — always derive from `~/.claude` + git.

**Verification:**
```bash
npm run test:cockpit
# Manual: open a session that edited files → click "Show graph" → see session→file edges.
```

**Commit:** `feat(I3): knowledge graph — sessions, files, decisions connected in SQLite`

---

## §6 — SELF-IMPROVEMENT PHASE

Complete I1 before starting this phase.

### Phase S1 — Oversight Watches Its Own Build

**The recursive payoff:** When a Claude Code session is building Oversight, Oversight can observe that session, detect when it's going wrong, and offer to steer it.

**What this does:**
1. Any session whose CWD is the Oversight repo root is tagged `meta: true` in the session index.
2. The Triage view shows a special "⚙ Building Oversight" banner for `meta` sessions.
3. Anomaly detection (I1) applies with tighter thresholds for `meta` sessions (stall = 3 min, loop = 5 calls).
4. A new **"Steer build"** quick action in the session detail sends a pre-composed message: "Review your last 3 commits, run `npm run test:cockpit`, and report what's failing." This helps the build agent self-correct without human intervention.
5. At session end, if the session committed any changes to the Oversight repo, `intelligence/analyzer.js` runs the full test suite (`npm run test:cockpit`) and logs the result to `server/data/build-log.jsonl`. This closes the loop: every build session has a verified outcome.

**New files:**
```
apps/cockpit/server/intelligence/meta-session-detector.js
apps/cockpit/server/tests/intelligence/meta-session-detector.test.js
apps/cockpit/client/src/components/TriageView/MetaBuildBanner.jsx
apps/cockpit/client/src/tests/components/MetaBuildBanner.test.jsx
```

**Verification:**
```bash
npm run test:cockpit
# Manual: start a Claude Code session in the Oversight repo dir.
# Assert: session appears with "Building Oversight" banner in Triage.
# Assert: "Steer build" quick action is present.
```

**Commit:** `feat(S1): Oversight watches its own build — meta-session detection + steer action`

---

## §7 — UNIVERSAL CONSTRAINTS

These apply to every phase. Violating any of these is a stopping condition.

1. **Never touch `packages/contracts/`** without updating both the JS consumer and Python consumer in the same commit.
2. **The Triage view is the hero.** Never demote it, never change its default role. MeshView is the spatial overview. Triage is the attention queue.
3. **No new top-level tabs** without retiring an existing one (SCOPE.md freeze rule).
4. **No LLM in the trust path.** `fleet-runner.js` and `harness` approval flows are deterministic. No claude session called to make security decisions.
5. **Every colour is a `--mc-*` variable.** No hardcoded hex in any component.
6. **All new routes have server tests.** All new React components have client tests. Coverage floors cannot drop.
7. **`ConversationView.jsx` (~920 LOC) and `FleetTab.jsx` (~1049 LOC) must not grow.** Split them before adding; do not add to them directly.
8. **The simulator is a single HTML file.** If changes are needed to the HTML, the full file must be tested with `node simulator/test/harness.mjs` before committing.
9. **Commit only on green.** `npm run test:cockpit` exit 0 before any commit.
10. **Write BLOCKER.md and stop** if any phase fails 3 consecutive attempts.

---

## §8 — EXECUTION ORDER

```
Phase L0  →  Phase L1 (a through g)  →  Phase V2
    ↓                                       ↓
Phase L2  ←─────────────────────────  Phase V3
    ↓
Phase L3  →  Phase I1  →  Phase I2  →  Phase I3
                ↓
            Phase S1
```

L0 and L1 are blocking — do not start V2 until L1 is complete.
L2 and V2 can run in parallel.
L3 and V3 can run in parallel.
I1 must complete before I2, I3, and S1.

**If tests are already green for a criterion when you run the self-assessment, mark it done and move on.** Do not re-implement passing work.

---

## §9 — STOPPING CONDITIONS

**Done when:**
- PROGRESS.md shows all criteria marked `[x]`
- `npm run test:cockpit` exits 0
- `git tag v0.1.0` is applied
- `MESH_V1_SUMMARY.md` and `FULL_BUILD_SUMMARY.md` exist

**Write `FULL_BUILD_SUMMARY.md` containing:**
- Final git hash and tag
- Test counts: server / client / python
- DoD criteria: which passed, which were already green at start
- Any deviations from spec and the ADR rationale for each
- Screenshot paths (Playwright, committed to `docs/screenshots/`)
- Time spent per phase (from git log timestamps)

**Stop and write `BLOCKER.md` if:**
- Any phase fails 3 consecutive attempts
- A constraint in §7 would be violated to make a test pass
- The harness contract schema changes in a way that breaks the parity gate

---

## §10 — THE FINISHED PRODUCT

When all phases are complete, Oversight is:

- A **production-grade** orchestration cockpit (L0–L3: honest, trustworthy, adoptable, standard)
- A **spatial intelligence layer** — live topology view, animated real-traffic packets, anomaly alerts
- A **pipeline composer** — drag nodes onto a canvas, wire them up, hit Run, watch it execute
- A **pattern learner** — notices what you always do, surfaces it, suggests automation
- A **knowledge graph** — every file touched, decision made, outcome reached, searchable
- **Self-aware** — monitors its own build sessions and can steer them mid-flight

The tool that builds agents is itself built and monitored by agents.
That's the recursive payoff.
