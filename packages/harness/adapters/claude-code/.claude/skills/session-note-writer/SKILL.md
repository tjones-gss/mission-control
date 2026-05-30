---
name: session-note-writer
description: Use at the end of any session that involved meaningful work — implementing a mission, writing an ADR, fixing a bug, or anything that produced files or decisions. Triggers on "write a session note", "wrap up this session", "handoff", or when the Stop hook reminds about a missing note. Produces a session note in the standard format with the evidence/inference/assumption split intact.
---

# Session Note Writer

Produce a durable session note that the next agent (or the next-day version of you) can resume from.

## When to use

- Any session ended with code changes, document changes, or decisions
- The Stop hook (`stop-session-note-reminder.sh`) reminded that no note was written
- The orchestrator is about to hand off to a new context

## When NOT to use

- Pure read-only sessions (exploration with no artifacts produced) — skip the note
- Sessions where the work was reverted (record what was tried in a follow-up section of an existing note instead of creating a new one)

## Required inputs

- The active mission file (if any)
- `git diff --stat` (or equivalent) to see what changed
- The agent's own memory of validation results, decisions, and follow-ups

## Process

### Step 1 — Choose a filename

Pattern: `runs/session-notes/<YYYY-MM-DD>-<mission-id-or-action>.md`

Examples:
- `2026-05-25-MISSION-014-checkout-flow.md`
- `2026-05-25-adr-backfill.md`
- `2026-05-25-bugfix-MISSION-027-null-deref.md`

If a note already exists for this mission today, append a new dated section instead of overwriting.

### Step 2 — Fill the template

Copy `runs/templates/session-note-template.md`. Every section is required:

- **Date** — today's ISO date
- **Mission** — mission id, or `none` if this was orchestrator/planning work
- **Agent** — which agent ran (orchestrator, implementer, reviewer, etc.)
- **Branch** — current git branch
- **Summary** — 3–5 bullets of what happened
- **Files Changed** — exact paths, from `git diff --name-only`
- **Validation** — command + result, exactly as run. Do not paraphrase commands.
- **Evidence** — facts you observed (with file:line if possible)
- **Inferences** — things you concluded but didn't directly verify (with reasoning)
- **Assumptions** — things you assumed without verification (with what would falsify each)
- **Risks** — what could go wrong from here
- **Follow-Ups** — work that was deferred or surfaced
- **Recommended Next Mission** — what the next session should pick up

### Step 3 — Update mission-index

If a mission was completed or advanced, update `.harness/mission-index.yml`:

```yaml
MISSION-<id>:
  status: complete   # or in-progress, blocked, review
  validation: pass   # or fail, skipped, partial
  review: pending    # or pass, request-changes
  session_note: runs/session-notes/<filename>.md
```

### Step 4 — Stop

The note is the handoff. After writing it, stop. Do not continue working in the same session.

## Hard rules

- The Evidence/Inference/Assumption split is non-negotiable. The whole point of session notes is so a future agent (or human) can tell what was verified vs guessed.
- Commands and results are recorded exactly. Do not "clean up" output. Truncate with `…` if long, but never edit.
- File paths are absolute or repo-relative. Never "the file" without naming it.
- Follow-ups go in the note, not in your head. If you noticed something out of scope, write it down.

## Output

One session note at `runs/session-notes/<filename>.md`. If a mission advanced, also one update to `.harness/mission-index.yml`. Return both paths.
