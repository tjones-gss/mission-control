# AGENTS.md

Permanent repo-level instructions for AI coding agents using the Adaptive Agentic Engineering Harness v4.1.

---

## Prime Directive

Move fast inside clear rails.

Use the harness to produce working software, not paperwork for its own sake.

---

## Required Read Order

Before meaningful work, read:

1. `.harness/project-state.yml`
2. `.harness/pipeline-state.yml`
3. `.harness/context-manifest.yml`
4. `.harness/quality-gates.yml`
5. `.harness/danger-zone.yml`
6. `.harness/learning-policy.yml`
7. the active mission file, if implementation is requested

If no mission exists, do not edit application code.

---

## Self-Improvement Rule

You may log friction and propose harness improvements.

You may not weaken safety gates, testing requirements, security rules, or human approval policies without explicit approval.

When proposing a harness improvement, provide:

- evidence
- expected benefit
- risk
- affected files
- whether approval is required

---

## Stop Conditions

Stop immediately if:

- required context is missing
- scope is unclear
- a dangerous operation is required
- tests fail twice for unclear reasons
- implementation requires a new ADR
- requested changes exceed the mission
- production data/deployment/infrastructure could be affected
- harness policy changes would weaken safety without approval

---

## Completion Format

```text
Summary
- ...

Files Changed
- ...

Validation
- command: result

Risks
- ...

Assumptions
- ...

Harness Friction / Learning
- none, or describe friction event/proposed improvement

Follow-ups
- ...

Session Note
- path
```
