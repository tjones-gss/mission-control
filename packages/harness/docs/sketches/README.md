# MVP Sketch Artifacts

Use `docs/sketches/<slug>/` for `mvp-sketch` mode artifacts. A sketch is a timeboxed prototype lane that answers whether an idea deserves a real `idea-to-mvp` build.

Sketches must be declared up front as either:

- `disposable` — throw away after learning.
- `promotable` — eligible to hand off into `idea-to-mvp`, not eligible to ship directly.

## Required Artifacts

- `sketch-brief.md` — problem or opportunity, primary demo flow, timebox, and disposition.
- `assumptions.md` — assumptions being tested by the prototype.
- `prototype-scope.md` — the single core workflow selected for the demo.
- `non-goals.md` — explicit exclusions and mocked/sandboxed boundaries.
- `prototype-plan.md` — stack, data strategy, blocked unsafe capabilities, and promotion risks.

Validation and review outputs live outside `docs/`:

- `runs/test-reports/<slug>-sketch-validation.md`
- `runs/reviews/<slug>-sketch-review.md`
- `runs/session-notes/<date>-mvp-sketch-<slug>.md`

## Guardrails

Do not use real customer data, irreversible migrations, production deploys, or production integrations in a sketch. Auth, billing, permissions, and sensitive operations must be mocked, sandboxed, or blocked unless a human explicitly approves a safer test-only boundary.
