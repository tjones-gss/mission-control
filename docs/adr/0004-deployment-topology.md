# ADR-0004: Deployment topology — localhost-first, architect-for-team

Status: Accepted
Date: 2026-06-07
Owner: program

## Context

The "industry-standard 2027 / THE agentic engineering solution" ambition implies teams/hosted use.
But the system today is a hard single-operator singleton, verified in code:

- The cockpit binds loopback-only and has **no auth middleware** — only helmet + rate-limit + a
  DNS-rebinding host guard (`apps/cockpit/server/middleware/security.js`).
- Fleet lifecycle state is **in-memory** (`fleet/fleet-runner.js` module registries) plus one JSON
  per run on local disk; the file even comments "the server is the single spawner/writer."
- All oversight reads are local `~/.claude` files.

Choosing the topology is a **one-way door**: the durability work in Phase 1 is built against it. If we
silently assume hosted, we over-build auth/RBAC/sharding now; if we silently assume localhost, a later
team pivot is a retrofit.

## Decision

**Target single-operator-localhost for the 2027 bar, but make architectural choices that do not block a
later team/hosted flip** ("architect-for-team"). Concretely:

- Durability (Phase 1g) hardens the **existing** on-disk one-JSON-per-run store with a boot reconciler
  — **not** a shared-store/leader-election rewrite.
- We do **not** build auth/RBAC/secrets/ingress speculatively. They are explicitly out of scope until
  this ADR is superseded.
- New state is written through the existing atomic-persist discipline so a future shared store is a
  swap behind one seam, not a rewrite.

## Options Considered

### A. Localhost-first, architect-for-team (chosen)
Pros: matches reality; smallest safe step; no wasted runway on multi-user plumbing against the
absorption clock. Cons: doesn't itself unlock teams.

### B. Hosted/multi-user now
Pros: bigger TAM. Cons: requires replacing the singleton + in-memory + local-disk model with shared
state, leader election, auth/RBAC/secrets/ingress — a separate program; premature against current
adoption.

## Consequences

Positive: durability work is bounded; security scope is clear; reversible-by-addition.
Negative: not team-ready until superseded. Neutral: the runbook (Phase 4) documents the singleton
constraints for operators.

## Links

`apps/cockpit/server/middleware/security.js`, `apps/cockpit/server/fleet/fleet-runner.js`,
plan `~/.claude/plans/do-what-you-need-ticklish-flamingo.md` (Phase 1g).

## Reversibility

**Reversible-by-addition.** Flipping to hosted means superseding this ADR and adding shared state +
auth; nothing here forecloses that, provided new state stays behind the atomic-persist seam.

## Amendment 2026-06-08 (Phase 4 / D-audit-otel) — audit log + OTel under the localhost seam

Status stays **Accepted** — this is an application of the localhost-first / atomic-persist decision
above, not a reversal.

The Phase 4 observability work lands two cross-cutting concerns *behind the existing seams* this ADR
established, so neither blocks a later team/hosted flip:

- **Append-only audit log — the COCKPIT is the SOLE WRITER.** A single append-only JSONL file
  (`apps/cockpit/server/data/audit/audit.jsonl`) records the consequential actions the dashboard
  orchestrates: agent **spawns**, human **approval** decisions, and run **merge**/synthesis events.
  It is written through the same atomic-rename discipline as the one-JSON-per-run Fleet store
  (`lib/atomic-write.js`) — one local-JSON store, no DB — so a future shared store is a swap behind
  one seam, exactly as this ADR requires. The cockpit records both the events it performs directly
  (`source: "cockpit"`) and the rails-mediated ones it **drives** via the `harness approve` shell-out
  (`source: "harness"`). Records validate against the versioned `packages/contracts`
  `audit-event` schema (sidecar v8) before they are written, so the on-disk log cannot drift from the
  published contract.
  - **KNOWN LIMITATION (honest gap):** actions taken against the harness CLI **directly** — a developer
    running `harness approve` in a terminal outside the dashboard — are **not** captured. There is no
    second, Python-side audit writer this phase. The single-writer-cockpit choice keeps the log
    consistent with the singleton-localhost model; closing the harness-direct gap (a rails-side writer
    or a reconciling import) is deferred and is the correct shape only once the topology is revisited.
- **OpenTelemetry tracing is ENV-GATED and OFF by default** (`OTEL_ENABLED`). The localhost-first
  default path pays nothing: with the flag unset, init is a no-op and the per-request span middleware
  is a bare pass-through. Provability is **in-process** — a test installs an `InMemorySpanExporter` and
  asserts spans land in its array; **no external collector** is stood up in CI or on Win11. An OTLP /
  network exporter is a deliberate later opt-in, not this phase.
- **`buildApp()` app factory.** `apps/cockpit/server/index.js` now assembles the middleware stack and
  routers in one exported `buildApp()`/`createApp` builder (listen stays in `start()`, guarded so an
  import never binds a socket), so cross-cutting concerns (OTel here, the served OpenAPI doc next) share
  one builder rather than each editing the module top.
