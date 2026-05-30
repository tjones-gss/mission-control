# Mission: Title

Status: draft  
Priority: medium  
Related ADR:  
Related Spec:  
Branch: agent/short-title  

---

## Goal

One clear outcome.

---

## Context To Read

- AGENTS.md
- .harness/project-state.yml
- related ADR
- related spec
- relevant architecture docs
- nearby tests

---

## Allowed Files

- 

---

## Forbidden Files

- 
- infrastructure unless explicitly allowed
- production config unless explicitly allowed
- unrelated modules

---

## Required Plan

Before editing, state:
1. intended change
2. files likely to change
3. tests to add/update
4. validation commands
5. risks

---

## Implementation Notes

- Keep change minimal.
- Do not broaden scope.
- Stop if a new ADR is needed.

---

## Required Tests

- [ ] 

---

## Validation Commands

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

---

## Acceptance Criteria

- [ ] 
- [ ] tests pass or exception documented
- [ ] no unrelated changes
- [ ] review checklist complete
- [ ] session note written

---

## Stop Conditions

- scope exceeds mission
- dangerous operation required
- tests fail twice
- missing context
- human approval needed
