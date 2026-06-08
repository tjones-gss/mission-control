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
| The ONE oversight view | the default Agents/Runs landing surface (live multi-agent view + approve/steer) |
| Security boundary | `apps/cockpit/server/middleware/security.js` |

## EXPERIMENTAL — allowed, exempt from L2/L3, not load-bearing

| Area | Paths / notes |
|---|---|
| Teams | `components/TeamsPanel.jsx`, `parsers/teams.js` |
| Overlapping orchestration UIs | Conductor vs MissionControl vs Runs (`ConductorTab.jsx`, `MissionControlTab/`, `RunsTab/`) — collapse target: one Runs vocabulary |
| Three "executable things" paradigms | Workflows vs Skills vs Commands (`WorkflowsPanel.jsx`, `SkillsPanel.jsx`) — collapse target: the canonical phase model (ADR-0006) |
| Duplicate agent views | `KanbanBoard.jsx` vs `AgentTree.jsx` (same data) |
| Metadata viewers | `MemoryViewer.jsx`, `ConfigViewer.jsx`, `HooksPanel.jsx` |
| Large components flagged for split | `ConversationView.jsx` (~920 LOC), `FleetTab.jsx` (~1049 LOC) — split before adding to them |

## Overlap → owning workstream (collapse targets)

| Overlap | Target | Phase |
|---|---|---|
| Conductor / MissionControl / Runs | one Runs surface | 3 |
| Workflows / Skills / Commands | one phase-model vocabulary (ADR-0006) | 2 |
| Kanban / AgentTree | one agent view | 3 |
