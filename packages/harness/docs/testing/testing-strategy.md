# Testing Strategy

## Required Commands

Update for your stack.

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

## Rules

- Behavior changes require tests.
- Bug fixes should include regression tests.
- Do not delete or weaken tests to pass.
- Report exact commands and results.

## Test Types

Unit:
- domain logic
- validation
- utilities

Integration:
- API
- database
- services
- auth

E2E:
- login
- primary workflow
- permissions
- billing if applicable
