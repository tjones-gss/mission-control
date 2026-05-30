---
name: adr-writer
description: Use when writing or backfilling an Architecture Decision Record. Triggers on "write an ADR for X", "this needs an ADR", "backfill ADRs for this repo", or when a spec proposes an architecture change with no ADR linked. Produces an ADR in the standard template with evidence discipline — every claim is either evidence-backed, marked an inference, or marked an assumption.
---

# ADR Writer

Record one architecture decision per file, in the standard format, with evidence discipline.

## When to use

- A new architecture decision needs to be captured before code is written
- An existing repo's architecture needs to be documented (backfill mode)
- A spec or mission has flagged "requires ADR" and one is missing

## Two modes

### Mode A — New decision

The decision hasn't been made yet, or has just been made. The ADR captures the reasoning forward.

### Mode B — Backfill

The decision was made historically. You're documenting what already exists, with evidence from the codebase. Every claim must cite `file:line` or be labeled `(inference)` or `(assumption)`.

Backfilled ADRs go in `docs/adrs/backfilled/` not `docs/adrs/`.

## Required inputs

For Mode A:
- The decision and its alternatives
- The trade-offs the team accepts

For Mode B:
- The repo
- Permission to read but not edit anything outside `docs/adrs/backfilled/`

## Process

### Step 1 — Number the ADR

Find the next free number under `docs/adrs/` (or `docs/adrs/backfilled/` for Mode B). ADRs are sequential and never renumbered.

### Step 2 — Fill the template

Copy `docs/adrs/ADR-000-template.md` to `docs/adrs/ADR-<n>-<slug>.md`. Fill every section:

- **Status** — `Proposed`, `Accepted`, `Deprecated`, or `Superseded by ADR-<n>`. Backfilled ADRs are `Accepted` (since they describe reality).
- **Date** — today's ISO date
- **Owner** — the decision owner
- **Context** — why this decision exists. One paragraph, no jargon.
- **Decision** — what was decided. Specific, testable.
- **Consequences** — both positive and negative. Honest about what gets worse.
- **Related Specs** — link to the spec(s) implementing this decision
- **Related ADRs** — supersedes/superseded-by/related-to

### Step 3 — Evidence discipline (Mode B)

For backfilled ADRs, every non-trivial claim must be one of:

- **Fact** — `(see src/auth/jwt.ts:42)`
- **Inference** — `(inference: the API uses bearer tokens because src/middleware/auth.ts:18 checks Authorization headers, but the token format is not documented)`
- **Assumption** — `(assumption: tokens expire after 1 hour; would be falsified by finding a different value in config or seeing tokens accepted after 1h)`

If you cannot find evidence and cannot reasonably infer, label the section `unknown` and stop. Do not guess.

### Step 4 — Link from spec/mission

If this ADR was triggered by a spec or mission, add the ADR path to that spec/mission's `Related ADR` field.

### Step 5 — Stop

Do not implement the decision. Stop and hand back.

## Hard rules

- One decision per ADR. If you find yourself writing "and also...", split it.
- Backfilled ADRs cite evidence or label inferences. No invented history.
- ADRs are not deleted. Use `Status: Superseded by ADR-<n>` instead.
- Date format is ISO (YYYY-MM-DD).

## Output

One ADR file at `docs/adrs/ADR-<n>-<slug>.md` (or `docs/adrs/backfilled/ADR-<n>-<slug>.md` for Mode B). Return the path.
