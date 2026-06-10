# Architecture Decision Records — monorepo log

This is the **canonical, monorepo-level** ADR log for Mission Control. It records cross-cutting,
program-level decisions that span both halves (the cockpit and the harness). It also **indexes** the
older per-package ADRs so there is one place to look.

## Why this directory exists (the reconciliation)

ADRs were previously written per package, with two conventions and colliding numbers:

- `packages/harness/docs/adrs/ADR-001..003-*.md` — harness-scoped decisions (`ADR-003` is the Fleet
  meta-orchestrator, cited from the root `CLAUDE.md`).
- `apps/cockpit/docs/adr/NNNN-*.md` — cockpit-scoped decisions (e.g. `0003-code-quality-polish.md`).

"ADR-003" therefore meant two different things. Going forward:

- **New cross-cutting / program-level decisions live HERE** (`/docs/adr/`), continuing a single
  4-digit sequence that starts past the highest pre-existing number to avoid collision.
- **Existing per-package ADRs are grandfathered** in place and linked below; they are not renumbered
  (that would break the `CLAUDE.md` citation and git history).
- Component-local decisions may still be drafted in a package, but the accepted record is indexed here.

## Convention (MADR-compatible, matches `apps/cockpit/docs/adr`)

Sections: **Status · Context · Decision · Consequences · Options Considered · Links**. Status
vocabulary: `Proposed · Accepted · Rejected · Deprecated · Superseded`. Every ADR ends with a
**Reversibility** line (one-way door vs reversible-by-addition). Use `0000-template.md`.

## Program-level ADRs (this directory)

| ADR | Title | Status |
|---|---|---|
| [0004](0004-deployment-topology.md) | Deployment topology — localhost-first, architect-for-team | Accepted |
| [0005](0005-moat-and-surface-strategy.md) | Moat thesis & surface strategy | Accepted |
| [0006](0006-canonical-orchestration-model.md) | Canonical orchestration model (pipeline = spine) | Accepted |
| [0007](0007-core-vs-experimental-scope.md) | Core vs experimental scope + surface freeze | Accepted |
| [0008](0008-sqlite-derived-read-cache.md) | SQLite derived read-cache for session index and Fleet state | Accepted |

## Grandfathered per-package ADRs (indexed, not moved)

| ADR | Location | Scope |
|---|---|---|
| ADR-001 Agentic control plane | `packages/harness/docs/adrs/ADR-001-agentic-control-plane.md` | harness |
| ADR-002 Harness-core package | `packages/harness/docs/adrs/ADR-002-harness-core-package.md` | harness |
| ADR-003 Fleet meta-orchestrator | `packages/harness/docs/adrs/ADR-003-fleet-meta-orchestrator.md` | harness/cockpit (cited in root `CLAUDE.md`) |
| 0003 Code-quality polish | `apps/cockpit/docs/adr/0003-code-quality-polish.md` | cockpit |

## Provenance

The program ADRs 0004–0007 were produced from two independent expert councils (Anthropic-bar review)
and a six-lens premortem + four-architect design pass. The full plan lives at
`~/.claude/plans/do-what-you-need-ticklish-flamingo.md`; the council/premortem artifacts are retained
locally alongside the repo.
