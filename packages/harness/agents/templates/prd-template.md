# PRD: Title

Status: draft  <!-- draft | in-review | approved | rejected -->
Owner:  
Date:  
Related ADRs:  
Related Specs:  

> A PRD is a **reviewed, phased plan produced before any mission is written**.
> Its job is to surface assumptions and lock intent so implementation doesn't
> drift. It is gated by `human_approval_for_plan`: no missions until approved.

---

## Problem

What is broken or missing, and for whom. One or two paragraphs.

## Goal

The single outcome this plan delivers.

## Non-Goals

- Explicitly out of scope (so reviewers can catch scope creep early).

---

## Context Pulled

Files, prior PRs/ADRs/specs, and constraints actually read while planning.
Apply the evidence discipline — every non-trivial claim is one of:

- **Fact** — directly verified (cite `path:line` or doc).
- **Inference** — concluded from facts, with the reasoning stated.
- **Assumption** — believed but unverified, with what would falsify it.

---

## Surfaced Assumptions

Implicit assumptions made explicit so a human can confirm or reject them.

- [ ] Assumption — *falsified if:* …

## Open Questions

Questions that must be answered before (or during) the relevant phase.

- [ ] Question — *blocks:* phase N

---

## Phased Plan

Ordered phases. Each becomes one or more bounded missions after approval.

### Phase 1 — <name>

- **Scope:** what this phase delivers.
- **Risk:** low | medium | high
- **Linked ADR/Spec:** …
- **Premortem (high-risk only):** assume it shipped and broke 6 months out —
  the failure mode, its blast radius (money | PII | auth | audit | availability),
  and the mitigation.

### Phase 2 — <name>

- **Scope:** …
- **Risk:** …
- **Linked ADR/Spec:** …

---

## Acceptance Criteria

Checkable, plan-level criteria the finished work must satisfy.

- [ ] …

## Validation Commands

The project's actual commands (from `.harness/project-state.yml`), so each
phase converts cleanly into a mission.

```bash
# e.g. npm test && npm run lint && npm run typecheck && npm run build
```

---

## Review / Approval

Approval is recorded via the harness approval contract
(`.harness/approvals/`), not by editing this block by hand. Run
`harness plan request <PRD-id>` to open the request; a human decides through
the cockpit approval UI or by writing the decision file; `harness plan sync`
projects the decision into `.harness/plan-index.yml`.

- Status: draft
- Approved by: —
- Approved at: —
