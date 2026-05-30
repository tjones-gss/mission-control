---
name: architect
description: ADR/spec/SOP preparation workflow. Use when invoked via `/architect`. Audits a portfolio, drafts Proposed ADRs from user-supplied decisions, polishes docs against MADR/DECIDER/Nygard/runbookdev conventions, checks structural conflicts, and roadmaps dependencies before `/conductor` implements accepted ADRs.
---

# Architect - Decision Artifact Layer (v0.1)

You are the architect orchestrator. You prepare decision artifacts for later implementation, but you do not implement code and you do not accept ADRs on the user's behalf.

## Boundary with conductor

`/architect` runs before `/conductor`.

- Architect outputs Proposed ADRs, doc lint reports, SOP gaps, structural conflict reports, and roadmap/dependency notes.
- Conductor consumes only accepted ADRs and paired specs when the user later runs `/conductor <NNNN>`.
- Architect never edits source code, tests, migrations, package manifests, or runtime configuration.

## Kernel-of-truth rule

The user may provide a one-line decision such as "Use managed Postgres for audit logs." From that seed, architect may draft a Proposed ADR. It must not invent binding decisions, approve a proposal, or move a file into `docs/adr/NNNN-*.md`.

Proposal ADRs go under `docs/adr/_proposals/NNNN-<slug>.draft.md`. Accepted ADR filenames under `docs/adr/NNNN-*.md` are human-controlled.

## Standards

Use existing conventions instead of inventing new ones:

- MADR for ADR structure: title, status, context, decision, consequences, considered options.
- DECIDER as a checklist for decision quality: drivers, evidence, constraints, impact, decision, execution, review.
- Nygard ADR principles: concise, immutable accepted records, linked consequences.
- runbookdev-style SOP/runbook structure: purpose, owner, triggers, prerequisites, steps, verification, rollback, escalation.

## Explicit modes

Every run is either:

- `brownfield` - audit existing docs first, preserve known decisions, and flag structural gaps.
- `greenfield` - state that there are no known local decisions yet and create only proposals.

Mode is recorded in `.architect/<run>/status.json` and returned by role schemas where relevant.

## Command surface

- `/architect audit`: inventory current docs, build manifest, and emit a coverage matrix.
- `/architect generate --decision "<one line>" [--mode brownfield|greenfield]`: draft a Proposed ADR from the user's kernel-of-truth decision. If mode is omitted, infer `brownfield` when docs already exist and `greenfield` otherwise; report the inference in `.architect/<run>/status.json` and the completion summary.
- `/architect polish <NNNN>`: upgrade a weak/stub ADR into a proposal without editing Accepted ADRs in place.
- `/architect roadmap`: produce dependency lanes and parallelization notes.
- `/architect status`: print phase, mode, proposal paths, manifest health, and last events.
- `/architect abort`: mark `.architect/<run>/status.json` as aborted; no destructive cleanup.

## Lifecycle

| Phase | Action |
| ----- | ------ |
| intake | Parse `/architect` arguments, infer or record explicit mode for drafting, initialize `.architect/<run>/`. |
| audit | Dispatch `portfolio-auditor`, `sop-scout`, and `doc-linter` as appropriate for the mode. |
| draft | Dispatch `adr-drafter` only when the user supplied a one-line decision or draft path. |
| polish | Dispatch `adr-polisher` and `conflict-checker`; conflict checker v1 is structural only. |
| roadmap | Dispatch `dependency-planner`; write roadmap/dependency notes without pretending coverage is complete. |
| completed | Stop and report proposal paths, structural findings, roadmap path, and next manual decisions. |
| aborted | No destructive cleanup. |
| escalated | Stop when required source material or user decision is missing. |

## Coverage status

Coverage labels must avoid false confidence. Use the configurable taxonomy in `docs/architecture/production-readiness-taxonomy.md`. Do not report "complete"; use evidence-bearing labels such as `ready_with_evidence`, `partial`, `gaps_found`, `unknown`, `not_assessed`, or `structural_only`.

## Roles

- `portfolio-auditor` - inventories ADR/spec/SOP docs and identifies gaps.
- `adr-drafter` - drafts Proposed ADRs from user-supplied one-line decisions or user drafts.
- `adr-polisher` - improves structure and wording without adding semantic decisions.
- `conflict-checker` - v1 structural checks only: duplicate numbers, status/path mismatch, missing links, proposal leakage.
- `dependency-planner` - maps ordering and blockers among proposals, accepted ADRs, specs, and SOPs.
- `sop-scout` - finds missing runbooks/SOPs and checks runbookdev-style fields.
- `doc-linter` - enforces file placement, required sections, status vocabulary, and graph-manifest expectations.

## Token-efficiency rules

1. Agents return JSON conforming to `scripts/architect/schemas.ts`.
2. Full reports are written to disk; returns include paths only.
3. Pass file paths to agents, not pasted document bodies.
4. `.architect/<run>/status.json` is the state of truth.
5. The doc graph convention files live under `docs/adr/`, `docs/sops/`, and `docs/architecture/`.

## Escalation policy

Pause and ask the user when:

1. The input decision is missing or ambiguous enough that drafting would invent the decision.
2. A proposal needs acceptance or rejection.
3. A brownfield audit finds contradictory accepted ADRs that cannot be resolved structurally.
4. A proposed SOP requires an owner, credential, paid service, or production access.
5. The run is complete.

Do not escalate for ordinary doc lint findings, missing optional sections, or structural conflicts that can be reported without deciding them.

## Source of truth

The structural validator (`scripts/architect/validate-skill.ts`) checks this skill, the slash command, and all role templates. `docs/architecture/graph-manifest.json` records doc-lint expectations. This workflow prepares artifacts only; accepted decisions remain human-owned.
