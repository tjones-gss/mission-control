# Scope manifest — CORE vs EXPERIMENTAL

Per [ADR-0007](docs/adr/0007-core-vs-experimental-scope.md). This is a **classification, not a
deletion**. CORE hardens to the full DoD ladder (`DOD-LADDER.md`); EXPERIMENTAL is allowed to exist
but is exempt from L2/L3 and is not load-bearing.

**Default rule:** any component, route, or surface not explicitly listed below is **EXPERIMENTAL until
classified**. This keeps the manifest complete without enumerating all ~52 components.

**Freeze rule:** *no new tab without retiring or merging an overlap.*

## CORE — hardens to L0–L3

| Area | Paths |
|---|---|
| Harness gate loop (the spine) | `packages/harness/sdk/python/harness_orchestrator/loop.py`, `packages/harness/harness_core/gates.py`, `packages/harness/pipelines/*.yml` |
| Contract boundary | `packages/contracts/` (schemas + `index.js`), `harness status --json` |
| The 3 critical `~/.claude` parsers | `apps/cockpit/server/parsers/sessions.js`, `parsers/config.js` + `parsers/hooks.js`, `lib/session-discovery.js` |
| Front-door spawn path | `apps/cockpit/server/claude-cli.js`, `apps/cockpit/server/lib/claude-bin.js`, `apps/cockpit/server/pty-session.js` |
| Fleet runner (autonomy core) | `apps/cockpit/server/fleet/fleet-runner.js`, `routes/fleet.js` |
| The ONE oversight view | the default Agents landing — the **"Needs you" Triage queue** (`apps/cockpit/client/src/components/TriageView/TriageView.jsx`): attention-ranked needs→running→calm + inline approve/steer via the real `QuickActions` (`POST /api/sessions/:id/message`) path |
| Security boundary | `apps/cockpit/server/middleware/security.js` |

## EXPERIMENTAL — allowed, exempt from L2/L3, not load-bearing

| Area | Paths / notes |
|---|---|
| Teams | `components/TeamsPanel.jsx`, `parsers/teams.js` |
| Overlapping orchestration UIs | Conductor vs MissionControl vs Runs (`ConductorTab.jsx`, `MissionControlTab/`, `RunsTab/`) — collapse target: **Runs is the surface, "Pipeline" the mode vocabulary** (see IA ruling below) |
| Three "executable things" paradigms | Workflows vs Skills vs Commands (`WorkflowsPanel.jsx`, `SkillsPanel.jsx`) — collapse target: the canonical phase model (ADR-0006) |
| Agent views (3 modes of Agents) | `TriageView.jsx` (default), `KanbanBoard.jsx` (Board), `AgentTree.jsx` (Detail) — Triage is the hero; Board/Detail retained |
| Dispatch | `DispatchDrawer.jsx` + `DispatchSignal.jsx` — slated to **fold into the Triage multi-select** (SelectionBar); keep the verb, retire the surface |
| Metadata viewers | `MemoryViewer.jsx`, `ConfigViewer.jsx`, `HooksPanel.jsx` |
| Large components flagged for split | `ConversationView.jsx` (~920 LOC), `FleetTab.jsx` (~1049 LOC) — split before adding to them |

## Overlap → owning workstream (collapse targets)

| Overlap | Target | Phase |
|---|---|---|
| Conductor / MissionControl / Runs | Runs surface; "Pipeline" mode vocabulary (IA ruling ↓) | 3 / redesign |
| Workflows / Skills / Commands | one phase-model vocabulary (ADR-0006) | 2 |
| Kanban / AgentTree / Triage | three modes of Agents; Triage is the default | 3 / redesign |
| DispatchDrawer / DispatchSignal | fold into the Triage multi-select (SelectionBar) | redesign |

### DispatchDrawer migration path (redesign phase)

`DispatchDrawer.jsx` carries a `DEPRECATED SURFACE` banner. It is **not** a quick
fold: `TriageView` today tracks only a single `selectedId`, so the dispatch verb
has no multi-select to live in yet. Concrete steps when the redesign lands:

1. Add multi-select to `TriageView/TriageView.jsx` — per-row checkbox + a
   `selectedIds` Set (alongside the existing single-select `selectedId`).
2. Add a **SelectionBar** that appears when `selectedIds.size > 0`, owning the one
   dispatch verb: a composer that POSTs `/api/sessions/:id/message` per selected
   session (the same call the current drawer uses).
3. Reuse the per-child dispatch-state rendering (pending/ok/failed) from
   `DispatchDrawer.jsx`; drop the drawer chrome, the header "Dispatch" button +
   `showDispatch` state (`App.jsx`), and `DispatchDrawerHandle`.
4. Keep `DispatchSignal.jsx` — re-anchor the fly-to animation from the
   SelectionBar's send button.

Invariant held in the meantime: no new **top-level** Dispatch tab (guarded by
`coreTabs.test.js`). The drawer stays as the working surface until step 2 ships.

## IA ruling — the "Pipeline" vocabulary (redesign · 2026-06-09)

One word for *"a guardrailed runnable process."* **Runs is the single orchestration
surface; "Pipeline" is a mode inside Runs — never a sibling tab.** `Missions` and
`Conductor` are legacy mode labels that collapse into the Pipeline vocabulary. This
ratifies [ADR-0006](docs/adr/0006-canonical-orchestration-model.md) (pipeline = the
spine) and the CLAUDE.md surface map (Runs unifies the modes). It is **not** "rename
Runs to Pipelines" — Runs stays the surface; the Missions/Conductor *split* is what's
retired. Enforcement is the freeze rule above: a top-level "Pipelines" tab is a
violation. Recorded here (not a standalone ADR) to keep the decision proportionate to
a solo repo — the redesign council's "write a formal ruling first" was over-ceremony
for this scope.
