# ADR-0007: Core vs experimental scope + surface freeze

Status: Accepted
Date: 2026-06-07
Owner: program

## Context

The UX surface is ~52 components / 8 tabs (~6600 LOC) with documented overlaps (Conductor vs
MissionControl vs Runs; Workflows vs Skills vs Commands as three paradigms for "executable things";
KanbanBoard vs AgentTree on the same data). The adoption and complexity premortems both flag this: the
breadth drowns time-to-first-value and outruns the maintainer budget (bus-factor-of-one).

We need a line between what hardens to the full DoD ladder and what is allowed to exist but is not
load-bearing — without deleting anything yet.

## Decision

Draw a **CORE vs EXPERIMENTAL** line, recorded in `/SCOPE.md`, and institute a **surface freeze rule**:

> **No new tab without retiring or merging an overlap.**

- **CORE** (hardens to L0–L3): the harness gate loop, the `harness status` contract
  (`packages/contracts`), the three critical `~/.claude` parsers (`sessions.js`, `config.js`/`hooks.js`,
  `lib/session-discovery.js`), the front-door spawn path (`claude-cli.js`, `pty-session.js`), and ONE
  oversight view.
- **EXPERIMENTAL** (allowed; exempt from L2/L3; not load-bearing): Teams, the overlapping orchestration
  UIs, the three "executable things" paradigms, duplicate agent views.

`SCOPE.md` is a classification, not a deletion. It leaves every component in place but labels it, so the
hardening effort and the DoD ladder apply only to CORE.

## Options Considered

### A. Classify + freeze, don't delete (chosen)
Pros: contains sprawl with zero risk; focuses hardening; reversible. Cons: experimental surface still
carries some maintenance cost.

### B. Delete experimental surfaces now
Pros: less to maintain. Cons: premature; destroys optionality; not needed to focus the ladder.

## Consequences

Positive: hardening scope is bounded to CORE; the freeze rule stops new sprawl. Negative: experimental
features get less love. Neutral: overlaps each get a named owning workstream and a target single
vocabulary (Phase 2/3).

## Links

`/SCOPE.md`, `apps/cockpit/client/src/components/`, ADR-0006 (canonical orchestration).

## Reversibility

**Reversible.** The labels can change; the freeze rule can be lifted. Deletions (if ever) are a
separate, later decision.
