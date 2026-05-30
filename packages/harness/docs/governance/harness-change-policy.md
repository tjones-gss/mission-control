# Harness Change Policy

This project allows controlled harness improvement.

The harness may propose improvements based on usage evidence, but it must not silently weaken safety.

---

## Safe Auto-Apply Changes

These may be applied automatically when learning mode allows it:

- typo fixes in docs
- broken internal links
- clearer examples
- missing references
- non-policy wording clarifications

---

## Human Approval Required

Human approval is required for changes to:

- quality gates
- danger-zone rules
- human approval policy
- security baseline
- testing policy
- deployment/release policy
- mission requirement for code edits
- review requirements
- anything that reduces validation

---

## Never Auto-Apply

The harness must never automatically:

- disable tests
- remove security checks
- bypass human approval
- allow production deploys without release gate
- remove danger-zone items
- remove review requirements for high-risk changes

---

## Improvement Proposal Format

Every proposed harness improvement should include:

```text
Title
Evidence
Problem
Proposed Change
Expected Benefit
Risk
Affected Files
Approval Required?
Success Metric
Rollback Plan
```

---

## Review Cadence

Run a harness retrospective:

- after 10 missions
- after repeated failures
- after a milestone
- whenever the harness feels too heavy or too weak
