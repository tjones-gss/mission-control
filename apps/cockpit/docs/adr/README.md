# ADR conventions

ADRs record human decisions. `/architect` may prepare Proposed ADRs; `/conductor` implements Accepted ADRs.

## Layout

- `docs/adr/NNNN-<slug>.md` - accepted or historical ADR records.
- `docs/adr/_proposals/NNNN-<slug>.draft.md` - Proposed ADR drafts awaiting human review.
- `docs/specs/NNNN-<slug>-implementation.md` - implementation companion used by conductor after acceptance.

Proposal ADRs must not be written directly to `docs/adr/NNNN-*.md`. A human moves an ADR out of `_proposals` only after accepting the decision.

## Lifecycle states

Use MADR-compatible status vocabulary:

- `Proposed` - drafted and under review; non-binding.
- `Accepted` - binding decision; eligible for `/conductor`.
- `Rejected` - considered and declined.
- `Deprecated` - no longer recommended, but historically relevant.
- `Superseded` - replaced by another ADR; link the replacement.

## ADR shape

Use MADR sections unless a project has stricter local ADR rules:

- Status
- Context
- Decision
- Consequences
- Considered options
- Links to related ADRs, specs, SOPs, and production-readiness notes

Use DECIDER prompts as a quality checklist: drivers, evidence, constraints, impact, decision, execution, and review. Use Nygard ADR practice for concise accepted records and explicit consequences.

## Structural checks

Architect conflict checking and doc linting are structural, not semantic. They may catch duplicate ADR numbers, invalid status/path combinations, missing linked files, or proposal files outside `_proposals`. They do not prove two decisions are strategically compatible.
