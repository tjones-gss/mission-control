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
