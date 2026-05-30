---
name: mission-writer
description: Use when creating a new mission file under runs/missions/. Triggers on "write a mission", "create a mission for X", "slice this spec into missions", or whenever a spec exists but no mission file does. Produces a well-formed mission with allowed/forbidden files, required tests, validation commands, acceptance criteria, and stop conditions — using the mission template at agents/templates/mission-template.md.
---

# Mission Writer

Produce a single mission file that an implementer can execute in one session without scope creep.

## When to use

- A spec exists and needs to be sliced into one or more missions
- The user says "write a mission for X"
- The pre-edit hook (require-mission.sh) is blocking work because no mission exists

## Required inputs

- The source spec (`docs/specs/SPEC-<n>-<slug>.md`) — if missing, stop and request it
- The related ADR if architecture is touched
- The project's `package_manager` and `test_runner` from `.harness/project-state.yml`

## Process

### Step 1 — Determine slicing

Ask one question (or infer): does this spec fit in one mission, or multiple?

A mission must be **completable in a single session** and **reviewable as one PR**. Signals it needs to be split:

- More than ~10 files to touch
- More than one architectural concern
- Requires both a schema migration *and* application logic
- Includes both backend and frontend changes
- Mixes new tests with refactor of existing tests

If splitting, name each mission `MISSION-<id>-<slug>.md` with a unique id.

### Step 2 — Fill the template

Use `agents/templates/mission-template.md` as the source of truth. Each section must be filled, not left as placeholders:

- **Goal** — one outcome, not a list
- **Context To Read** — only files this mission actually needs (point at `.harness/context-manifest.yml` for default)
- **Allowed Files** — explicit list or globs. Tighter is better. No `**/*`.
- **Forbidden Files** — at minimum: infrastructure, production config, lockfiles unless dependency changes are in scope, unrelated modules. Add project-specific forbidden paths.
- **Required Plan** — the standard 5-point plan structure
- **Required Tests** — concrete test names or behaviors, not "add tests"
- **Validation Commands** — the project's actual commands from `project-state.yml`. Do not default to npm if the project is Python, Go, COBOL, etc.
- **Acceptance Criteria** — checkable, not vague. Every criterion is a checkbox.
- **Stop Conditions** — standard set plus any mission-specific ones

### Step 3 — Register the mission

Add an entry to `.harness/mission-index.yml`:

```yaml
MISSION-<id>-<slug>:
  status: ready          # draft until acceptance criteria are testable
  priority: <high|med|low>
  adr: docs/adrs/...    # or null
  spec: docs/specs/...
  file: runs/missions/MISSION-<id>-<slug>.md
  validation: pending
  review: pending
  session_note: null
```

### Step 4 — Stop

Do not start implementing. Hand back to the orchestrator or the user.

## Hard rules

- Validation commands match the actual stack. If the project is COBOL, do not write `npm test`.
- Allowed files are explicit. A mission that allows `**/*` is not bounded.
- Acceptance criteria are checkable. "Improve performance" is not. "p95 latency < 200ms on `/checkout`" is.
- Stop conditions exist. Every mission must list when to stop.

## Output

One mission file at `runs/missions/MISSION-<id>-<slug>.md` plus one new entry in `.harness/mission-index.yml`. Return both paths to the user.
