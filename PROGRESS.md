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
- [ ] L2-c: CI coverage + e2e gates block merge  — parity gated; coverage/e2e unconfirmed
- [ ] L3-a: cross-vendor oversight label dropped  — docs check pending
- [x] L3-b: harness status as versioned vendor-neutral spec
- [ ] L3-c: observability: OpenAPI + OTel + audit log  — OTel+audit present; /api/docs NOT mounted
- [ ] L3-d: release engineering: semver, CHANGELOG, SBOM  — unconfirmed

## Visual + Orchestration Phases
- [x] V1: MeshView topology tab (complete — commit 8e4795c)
- [x] V2: Pipeline canvas (drag-drop agent pipelines in Runs/Pipeline mode)
- [ ] V3: Hook instrumentation (real tool calls → live animation)  ← NEXT

## Intelligence Phases
- [ ] I1: Session anomaly detection + alert system
- [ ] I2: Cross-session pattern intelligence
- [ ] I3: Knowledge graph (decisions + outcomes)

## Self-Improvement Phase
- [ ] S1: Oversight monitors its own build sessions

## Loop log
- 2026-06-24: self-assessment; baseline server 1256/1 (env timeout), client 642/0; started V2.
- 2026-06-24: V2 complete. New: routes/pipelines.js (+11 tests), PipelineCanvas/ (NodeTypes+component, +15 tests), RunsTab Pipeline mode (+1 test), runs.pipeline brief. Server 1267/1 (same env timeout), client 658/0. Lint clean.
