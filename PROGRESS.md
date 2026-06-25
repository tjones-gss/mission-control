# Build Progress

_See STATE.md for the per-loop self-assessment evidence._

## DoD Status
- [x] L0-a: parser_degraded emitted (honest parsers)
- [x] L0-b: hooks/config distinguish failed vs empty
- [x] L1-a: no Windows shell injection
- [x] L1-b: PTY no skip-permissions without trust
- [x] L1-c: no LLM in deterministic trust path
- [x] L1-d: SCHEMA_VERSION single-sourced + CI parity
- [x] L1-e: fleet survives mid-run restart (no wedge)
- [x] L1-f: known-bad diff actually rejected
- [x] L1-g: gates HALT dependent phases + check evidence
- [x] L2-a: empty ~/.claude shows Welcome + first-agent CTA
- [x] L2-b: one-click rails adoption (pure-Node fallback)  — routes/rails.js + lib/rails-installer.js (verified)
- [x] L2-c: CI coverage + e2e gates block merge  — ci.yml: server+client --coverage gates, e2e job, parity, lint (verified)
- [x] L3-a: cross-vendor oversight label dropped  — no multi-vendor reader text found in client
- [x] L3-b: harness status as versioned vendor-neutral spec
- [x] L3-c: observability: OpenAPI + OTel + audit log  — mountOpenApi (/api/docs), lib/otel.js, audit-log wired (sessions/trust/fleet)
- [~] L3-d: release engineering: semver, CHANGELOG, SBOM  — CI has SBOM smoke + OpenAPI export; v0.1.0 tag not yet applied

## Visual + Orchestration Phases
- [x] V1: MeshView topology tab (complete — commit 8e4795c)
- [x] V2: Pipeline canvas (drag-drop agent pipelines in Runs/Pipeline mode)
- [x] V3: Hook instrumentation (real tool calls → live MeshView packets, opt-in)

## Intelligence Phases
- [x] I1: Session anomaly detection + alert system (stall/budget/loop/approval → SSE + toast + jsonl)
- [x] I2: Cross-session pattern intelligence (pattern index + /api/patterns + ⌘K group + IntelView section)
- [x] I3: Knowledge graph (nodes + edges in SQLite; /api/graph; GraphPanel in InspectPanel)

## Self-Improvement Phase
- [ ] S1: Oversight monitors its own build sessions  ← after I1

## Next phase for the following loop
**S1 — Oversight Watches Its Own Build.** Per §8, S1 is the last phase (I1 complete,
prerequisite met). New files per §6: `intelligence/meta-session-detector.js` +
test (tag `meta:true` when a session's CWD is the Oversight repo root),
`client/components/TriageView/MetaBuildBanner.jsx` + test ("⚙ Building Oversight"
banner in Triage). Also: tighter anomaly thresholds for meta sessions (stall 3min,
loop 5 calls), a "Steer build" quick action in session detail, and a build-outcome
log (`server/data/build-log.jsonl`) when a meta session commits. After S1, all
phases complete — see §9 stopping conditions (tag v0.1.0, write FULL_BUILD_SUMMARY.md).

## Loop log
- 2026-06-24: self-assessment; baseline server 1256/1 (env timeout), client 642/0; started V2.
- 2026-06-24: V2 complete. New: routes/pipelines.js (+11 tests), PipelineCanvas/ (NodeTypes+component, +15 tests), RunsTab Pipeline mode (+1 test), runs.pipeline brief. Server 1267/1 (same env timeout), client 658/0. Lint clean. Commit 3c23283.
- 2026-06-24: V3 complete. New: lib/hook-receiver.js (receive+consume+watch, +9 tests), packages/hook-server/ (hook-emitter+index+README, +6 tests), MeshView real tool_call packets (+4 tests), useSSE tool_call event, App wiring, index.js boot watcher. DEVIATION: file-drop transport + hook script instead of MCP/WebSocket (no new deps, no inbound path, ADR-0004-consistent). Server 1282/1 (same env timeout), client 662/0. Lint clean.
- 2026-06-24: I1 complete. New: intelligence/anomaly-detector.js (pure detectAnomalies + buildSnapshot + approval tracking + scanSession/sweep, +23 tests), client/components/AnomalyToast.jsx (+6 tests). Wiring: `anomaly` SSE event (useSSE + sync test), watcher per-change scan (loop/budget), index.js boot (startApprovalTracking + startAnomalySweep), App anomaly state + toast render (onOpen→session detail). Append-only server/data/anomalies.jsonl. Deterministic, no-LLM (constraint #4). Server 1305/1 (same env timeout), client 668/0. Lint clean. Commit cfae113.
- 2026-06-25: I3 complete. New: lib/db/knowledge-graph.js (extractGraph + reindexSessionGraph + getNeighbourhood, +9 tests), routes/graph.js (GET /api/graph?node=, 2-hop neighbourhood, +5 tests), client InspectPanel/GraphPanel.jsx + .css (radial SVG mini-graph, +7 tests) wired as a new "graph" section in InspectPanel (+1 test). SQLite schema v5→v6 (nodes + edges base tables; 2-hop neighbourhood derived at query time). Wiring: reindexSessionGraph rides the existing upsertSession transaction (no LLM, no watcher change), removeSession edge cleanup, index.js mount, AgentTree threads graphVersion=sessionUpdateVersion for live refetch. DEVIATION: deterministic transcript extraction (session→file touched, session→task spawned, session→commit produced) rather than git-watcher/LLM decision+outcome extraction — schema carries the full kind/relation vocabulary (decision/outcome, decided/blocked) so it stays forward-compatible, but only the no-LLM subset is populated (constraint #4, free, testable, rebuildable). Server 1334/1 (same env CLI timeout), client 680/0. Lint clean.
- 2026-06-24: I2 complete. New: lib/db/pattern-index.js (extractPatterns + reindexSessionPatterns + searchPatterns, +11 tests), routes/patterns.js (GET /api/patterns?q=&session=, +4 tests). SQLite schema v4→v5 (session_patterns base table; aggregate `patterns` shape derived at query time). Wiring: reindex rides the existing upsertSession transaction (no LLM, no watcher change), removeSession cleanup, index.js mount. Client: CommandPalette "Patterns" group (+2 tests) + IntelView "Patterns in this session" section (+2 tests, free/ungated). DEVIATION: per-session base table + query-time GROUP BY instead of a physical aggregate `patterns` table — keeps per-session reindex idempotent + cache rebuildable; external API shape unchanged. DEVIATION: deterministic extraction (no LLM) rather than analyzer.js LLM extraction (constraint #4, free, testable). Server 1320/1 (same env timeout), client 672/0. Lint clean.
