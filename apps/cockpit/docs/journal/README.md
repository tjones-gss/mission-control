# Journal

This directory holds shift journals written by the conductor's `journalist` role at the end of every run (Phase 4 — Ship).

## File naming

`{{date}}-{{nn}}-{{slug}}.md` where:
- `date` is `YYYY-MM-DD`
- `nn` is a 2-digit sequence within that day (01, 02, ...)
- `slug` is a kebab-case summary of what the slice shipped

Example: `2026-05-09-01-conductor-integration.md`.

## Frontmatter

```yaml
---
date: 2026-05-09
adrs: ['0001', '0002']
slice: 1
type: feature | fix | refactor | docs
status: shipped | partial | reverted
---
```

## Section structure

Each entry has these sections, in order:

- **Context** — what the slice was for, what state the codebase was in before
- **Changes** — what shipped (high-level; the diff and PR carry the details)
- **Decisions** — non-obvious calls made during the run, especially ones not captured in an ADR
- **Tests** — what coverage was added; any acceptance commands that ran
- **Next** — what's queued or implied as a follow-up
- **Notes for future me** — gotchas, surprises, things that would have been helpful to know going in

Be **descriptive**, not prescriptive. The journal is a record of what happened, not a backlog.
