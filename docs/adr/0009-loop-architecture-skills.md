# ADR-0009: Loop-architecture skills — installable loop designs

Status: Proposed
Date: 2026-06-28
Owner: program

## Context

Mission Control is a cockpit for **observing** agents — it sees and steers running
sessions but does not stand them up. Meanwhile the loop-engineering repo (GSS R&D)
contains four proven loop architectures that define how agents should be staffed,
gated, and orchestrated:

- **bossman** — operator-friendly, Node engine, daily/weekly crons.
- **nethum-protocol** — the most rigorous: a hook wall + Decision Charter.
- **steven** — a 5-stage pipeline (Scope → Gather → Plan → Work → Verify).
- **johndavis** — Obsidian-vault integration with a named-teammate roster.

These designs live outside MC today; provisioning them into a project is a manual,
out-of-band step. Making them installable from inside MC turns the product from a
passive observer into an **active provisioner** of agent projects — the missing half
of "see and steer every running session."

## Decision

**Each loop architecture becomes an MC skill.** When invoked, the skill scaffolds the
loop's config into a target project — CLAUDE.md hooks, roster/state files, the skill
catalog, and the cron schedule — and registers the project with MC's Fleet.

Three integration surfaces carry this:

- **Skills (loop-deployment).** The skills library grows from task skills to
  loop-deployment skills: a skill provisions a loop into a target project rather than
  performing a one-off task.
- **Fleet templates (wave orchestration).** Each architecture ships a Fleet template
  that pre-configures wave structure and per-architecture child caps (within the hard
  `MAX_FLEET_CHILDREN` / `HARD_REFUSE_CHILDREN` ceilings in `fleet/fleet-runner.js`).
  Fleet templates become the canonical way to provision a new agent project.
- **Workflow definitions (multi-phase pipelines).** steven's 5-stage pipeline
  (Scope → Gather → Plan → Work → Verify) becomes the first real multi-phase Workflow
  definition — exercising the canonical phase model (ADR-0006) beyond the degenerate
  single-phase case.

## Options Considered

### A. Loop designs as installable MC skills (chosen)
Pros: reuses the existing Skills + Fleet + Workflow surfaces; introduces no new engine
(honors ADR-0006's "no new orchestration engine" rule); MC becomes a provisioner
without the operator leaving the cockpit. Cons: skills now mutate target projects
(write CLAUDE.md / hooks / cron) — a larger blast radius than read-only task skills.

### B. Keep the designs in loop-engineering, document only
Pros: zero MC change. Cons: the designs stay shelf-ware; provisioning stays manual; MC
remains observe-only — the strategic gap this ADR closes is left open.

### C. A standalone provisioner CLI outside MC
Pros: clean separation from the cockpit. Cons: a fourth orchestration surface that
duplicates Fleet/Skills and splits the operator's attention away from the one cockpit.

## Consequences

**Positive:**
- The MC skills library grows from task skills to loop-deployment skills.
- Fleet templates become the canonical way to provision new agent projects.
- Workflows gain a real multi-phase definition (previously degenerate single-phase).
- TriageView surfaces agents spawned by loop-architecture skills natively — no new
  view is required.

**Negative:**
- Loop-deployment skills write into target projects (CLAUDE.md, hooks, cron). This is a
  larger blast radius than read-only task skills and needs guardrails.

**Neutral:**
- No new orchestration engine — this composes the existing Skills, Fleet, and Workflow
  surfaces, consistent with ADR-0006. The Fleet hard caps remain inviolable.

## Implementation phases

- **Phase 1 — bossman skill** (proof of concept). Most operator-friendly: Node engine,
  daily/weekly crons.
- **Phase 2 — steven skill.** 5-stage pipeline → the first multi-phase Workflow definition.
- **Phase 3 — nethum-protocol skill.** Hook wall + Decision Charter — the most rigorous.
- **Phase 4 — johndavis skill.** Obsidian-vault integration, named-teammate roster.

## Links

- [ADR-0006](0006-canonical-orchestration-model.md) — canonical orchestration model
  (pipeline = spine; Fleet = phase strategy; Workflow = degenerate single-phase)
- [ADR-0007](0007-core-vs-experimental-scope.md) — CORE vs EXPERIMENTAL surface split
- `apps/cockpit/server/fleet/fleet-runner.js` — Fleet runner + hard child caps
- `STATE.md` — "Loop Architecture Skills" roadmap entry
- loop-engineering repo (GSS R&D) — bossman, nethum-protocol, steven, johndavis

## Reversibility

**Reversible-by-addition.** Loop-architecture skills are additive surfaces — new skills,
Fleet templates, and Workflow definitions. Removing them is deleting the
skill/template/definition files; no CORE invariant or contract changes. The one-way
consideration is per-target: once a loop is scaffolded into a target project,
un-provisioning that project is the target's concern, not MC's.
