# ADR-0006: Canonical orchestration model (pipeline = spine)

Status: Accepted
Date: 2026-06-07
Owner: program

## Context

Three real, overlapping orchestration engines exist today with no shared state, persistence, or
completion seam (verified):

- **Harness pipeline loop** (Python) — `harness_orchestrator/loop.py` + `harness_core/gates.py` +
  `pipelines/*.yml`. The only engine with explicit phases, a registered gate registry, and durable
  `.harness/*.yml` state.
- **Fleet runner** (Node) — `fleet/fleet-runner.js`. Parallel fan-out + adversarial verify + synthesis;
  see grandfathered `packages/harness/docs/adrs/ADR-003-fleet-meta-orchestrator.md`.
- **Cockpit Workflows** (Node) — `routes/workflows.js`. Linear, single-agent, no loop/gate awareness.

The complexity-collapse premortem's fatal mode: three engines never unify, so every cross-cutting
feature (cost, resume, audit, live-push) is built three times until velocity hits zero.

## Decision

**One canonical model, three composable shapes:**

- **Spine = the harness pipeline+gate loop** (it alone has phases + gates + durable state). A pipeline
  is ordered phases, each carrying `{id, agent, model tier, required-gate set, fan-out strategy
  (single|fleet), original goal}` — captured in a shared `pipeline-phase` contract schema.
- **Fleet = a phase strategy** (`strategy: fleet`) invoked *inside* a phase. It writes outcomes back
  to `mission-index.yml` **only via the harness CLI single-writer** — never editing YAML directly,
  preserving the `harness status --json` contract boundary. This extends, and is consistent with,
  grandfathered ADR-003 (Fleet reuses existing primitives rather than a new stack).
- **Workflow = a degenerate single-phase pipeline** compiled to the same phase schema, so it inherits
  gates, live-push, and the cost ledger.

Shared discipline across all three: gates HALT and check evidence; one atomic-persist + boot
reconciler (restart-survivable); SSE on every transition (cockpit stops polling); one cost ledger; the
LLM removed from the deterministic trust path. **Rule: no new orchestration engine.**

The *build* of this unification is Phase 2 (post Phase-1 reassessment). This ADR is the decision the
build implements; the `pipeline-phase` JSON schema is specified here and wired into
`packages/contracts` during Phase 1d (single-source `SCHEMA_VERSION`).

## Options Considered

### A. Pipeline as spine (chosen)
Pros: only engine with all three properties; Fleet/Workflow fold in as shapes; no rewrite. Cons:
Python spine drives Node Fleet across a process boundary (already the existing seam).

### B. Fleet as primary engine
Pros: Node-native, already async. Cons: lacks a gate registry and durable phase state; would reinvent
the rails. Rejected.

## Consequences

Positive: cross-cutting features built once; one vocabulary; the bus-factor-of-one risk drops.
Negative: requires touching `loop.py` control flow (Phase 2) — behavior change for existing pipelines.
Neutral: Workflows/Skills/Commands UI overlap collapses to one model (see ADR-0007).

## Links

`packages/harness/sdk/python/harness_orchestrator/loop.py`, `harness_core/gates.py`,
`apps/cockpit/server/fleet/fleet-runner.js`, `apps/cockpit/server/routes/workflows.js`,
grandfathered `packages/harness/docs/adrs/ADR-003-fleet-meta-orchestrator.md`,
future `packages/contracts/schemas/pipeline-phase.schema.json`.

## Reversibility

**One-way door once code accretes** against the phase contract — which is exactly why it is decided
now, before Phase 2 builds on it.
