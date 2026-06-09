# ADR-0005: Moat thesis & surface strategy

Status: Accepted
Date: 2026-06-07
Owner: program

## Context

An Anthropic-bar council and a platform-absorption premortem both identified the same #1 strategic
risk: the **zero-setup window is the most absorbable surface**. The cockpit's oversight data hub reads
only Claude's own `~/.claude` files (`parsers/sessions.js`, `lib/session-discovery.js`), so when a
vendor ships native cross-session oversight, a single-vendor dashboard becomes a redundant mirror.

The genuinely non-absorbable assets are the ones a single vendor has no incentive to build generically:

1. the **opt-in cross-vendor rails** (gate loop, mission lifecycle, danger-zone approvals), and
2. the **versioned `harness status` contract** (a vendor-neutral integration surface others can build to).

The premortem's chronic failure mode: with no written thesis, effort pours into the absorbable window
(52 components, 8 tabs) while the defensible half stays thin and un-adopted.

## Decision

Adopt the thesis in writing and **enforce it as a review rule**:

> The window is a commodity lead-gen surface. The defensible assets are (a) the opt-in cross-vendor
> rails and (b) the versioned `harness status` contract. **No window-only-polish PR merges unless it
> also advances the rails or the contract.**

Wire the rule into the PR template. Roadmap investment (Phases 3–4) prioritizes rails adoption and the
contract-as-standard over dashboard breadth.

### Amendment 2026-06-08 (Phase 4)

The Consequences "Neutral" deferral below — *the cross-vendor viewing claim must be backed (Phase 4)
or the label dropped* — is resolved: **the cross-vendor VIEWING label is DROPPED.** Oversight is scoped
to **Claude Code only** (the cockpit's data hub reads only Claude's own `~/.claude` files). No
multi-vendor reader ships. This is a scoping refinement, not a reversal: Status stays **Accepted**, and
the moat thesis is unchanged. Cross-vendor reach is a property of the **opt-in cross-vendor rails** and
the **versioned vendor-neutral `harness status` contract** (a) and (b) above — i.e. it lives in the
*rails + the contract*, not in the *viewer*. The honest framing is now: the window views Claude Code;
other vendors integrate through the rails and the contract, not by being mirrored in the dashboard.

### Moat artifact 2026-06-08 (Phase 4)

The versioned vendor-neutral `harness status` contract (asset (b) above) is now a
**published artifact**, not just a thesis: `packages/contracts/SPEC.md` is the
versioned, vendor-neutral specification of every shared schema, **generated from
the schemas** (the single source of truth) by a zero-dependency in-repo generator
(`packages/contracts/tools/generate-spec.mjs`) so it can never silently drift, and
gated for freshness + vendor-neutrality in CI. The schema-version timeline lives in
the dedicated `packages/contracts/CHANGELOG.md` (latest surface = the sidecar
`schemaVersion`). This is the concrete form of the surviving moat: with the window
scoped to Claude Code only (Amendment above), the **versioned vendor-neutral
contract is the integration surface other tools build to**. Status stays
**Accepted** — this records the realized artifact, it is not a decision change.

## Options Considered

### A. Write & enforce the moat thesis (chosen)
Pros: reframes every roadmap decision; cheap; highest leverage. Cons: enforcement depends on review
discipline, not code.

### B. Keep optimizing the window
Pros: visible polish. Cons: spends runway on the surface the vendor takes for free — the premortem's
terminal path.

## Consequences

Positive: effort concentrates on the non-absorbable half; the litmus test (a native cross-session view
does not make us redundant) becomes achievable. Negative: some desirable window polish is gated.
Neutral: the cross-vendor *viewing* claim is resolved by the **Amendment 2026-06-08 (Phase 4)** above —
the label is **dropped**, oversight is scoped to Claude Code only, and cross-vendor reach lives in the
rails + the contract, not the viewer (see ADR-0006 and that amendment).

## Links

`apps/cockpit/server/parsers/sessions.js`, `apps/cockpit/server/lib/session-discovery.js`,
`packages/contracts/`, `packages/harness/docs/adrs/ADR-001-agentic-control-plane.md`.

## Reversibility

**Reversible** (it's a prioritization rule), but the *cost of having ignored it* is one-way: runway
spent on an absorbed surface is not recoverable.
