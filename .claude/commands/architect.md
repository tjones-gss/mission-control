---
description: Prepare ADRs/specs/SOPs before conductor implementation. Usage: /architect audit | generate --decision "<one line>" [--mode brownfield|greenfield] | polish <NNNN> | roadmap | status | abort
argument-hint: "audit | generate --decision \"<one line>\" [--mode brownfield|greenfield] | polish <NNNN> | roadmap | status | abort"
---

Invoke the architect skill with the user's argument(s).

Argument forms:
- `/architect audit` - run structural portfolio/doc graph audit without drafting a new decision
- `/architect generate --decision "<one line>" [--mode brownfield|greenfield]` - draft a Proposed ADR from the user's kernel-of-truth decision under `docs/adr/_proposals/*.draft.md`; infer mode from existing docs only when `--mode` is omitted and report that inference
- `/architect polish <NNNN>` - polish a weak/stub ADR into a proposal without editing Accepted ADRs in place
- `/architect roadmap` - produce dependency lanes and parallelization notes for ADR/spec/SOP work
- `/architect status` - print current phase, mode, proposal paths, last 5 events, and coverage status
- `/architect abort` - write `phase: "aborted"` to `.architect/<run>/status.json`; no destructive cleanup

Read the architect skill's SKILL.md and follow it strictly. `/architect` prepares decision artifacts; `/conductor` implements accepted ADRs only.

User's argument(s): $ARGUMENTS
