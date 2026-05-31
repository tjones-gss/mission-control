# Feature Sweep — Mission Control (UI/UX worth-keeping audit)

Companion to `council-review.md`. Every user-facing surface, graded for whether
it earns its place. Inventory is taken from `apps/cockpit/server/{routes,parsers}`
and `apps/cockpit/client/src/components` as of 2026-05-31.

**Verdicts:** **KEEP** (core, earns its place) · **FIX** (keep, but a real UX or
correctness gap) · **FOLD** (merge into a shared surface) · **RECONSIDER**
(validate real usage before investing further) · **DEAD** (unused / half-wired,
clean up).

> Discoverability and complexity are qualitative (Low/Med/High). They reflect a
> walkthrough, not instrumentation — treat as **[I]** inference.

---

## A. The core loop — *list → read → reply/approve → watch status*

This is the durable product. All KEEP.

| Feature | What it does | Disc. | Cmplx | Verdict |
|---|---|---|---|---|
| `SessionsList` | Lists the agent sessions you're running | High | Med | **KEEP** |
| `ConversationView` (~920 LOC) | Renders a session transcript | High | High | **KEEP / split** — biggest single file; split presentational vs data |
| `ToolApprovalBanner` + `QuickActions` | Approve/steer a waiting agent | High | Med | **KEEP** |
| `SessionControlBar` | Per-session controls | High | Low | **KEEP** |
| `KanbanBoard` / `TaskBoard` | Board view of sessions/tasks | High | Med | **KEEP** |
| `NewSessionForm` + `FolderPicker` | Start a new session | High | Low | **KEEP** |
| `LiveFeed` | Live activity stream | Med | Low | **KEEP** |
| `MissionControlTab` / `HarnessDetail` | The `harness status --json` overlay | Med | Med | **KEEP** — this is the rails↔window contract surface |
| `AgentTree` | Subagent hierarchy of a session | Med | Med | **KEEP** |
| `Markdown` / `FilePath` / `CostSparkline` / `TokenBreakdown` | Presentational helpers | n/a | Low | **KEEP** (`TokenBreakdown`: collapse compact+full into one) |

## B. Detail inspectors — *read-only introspection panels*

Each reads an **undocumented `~/.claude` on-disk format** (or shells a tool), and
each is a separate fragility surface. Most duplicate what the Claude Code CLI/IDE
already shows. **Folding them into one "Inspect" panel cuts UI weight *and*
coupling at once** — the highest-leverage change in this sweep.

| Feature | Reads | Disc. | Cmplx | Verdict |
|---|---|---|---|---|
| `ConfigViewer` | `config` | Low | Med | **FOLD** → Inspect |
| `HooksPanel` | `hooks` | Low | Med | **FOLD** → Inspect |
| `McpDashboard` | `mcp` | Low | Med | **FOLD** → Inspect |
| `MemoryViewer` | `memory` | Low | Med | **FOLD** → Inspect |
| `TimelineView` | session records | Med | Med | **KEEP** (pairs naturally with Conversation) |
| `PlanViewer` | `~/.claude` plans | Low | Med | **RECONSIDER** — now overlaps the harness PRD plans; pick one home for "the plan" |
| `IntelView` | external (paid) API | Low | High | **RECONSIDER** — keep opt-in; **surface cost before enabling**; it's a transcript-egress path |
| `SkillsPanel` | `skills` | Med | Med | **FOLD** — single skills entry point (see C) |

## C. Orchestration surfaces — *two mental models doing one job*

| Feature | What it does | Verdict |
|---|---|---|
| `ConductorTab` (`conductor`) | Drive an ADR/structured run | **RECONSIDER / unify** — Conductor and Mission Control are both "drive a structured run"; present one "Runs" concept with two modes, not two top-level tabs |
| `MissionControlTab` (`harness`) | Drive the harness mission loop | **KEEP** (as the unified Runs home) |
| `WorkflowsPanel` (`workflows`) | Author/run step sequences | **RECONSIDER** — heavy editor; mental-model overlap with Skills. Validate real usage before further investment |
| `SkillsPanel` (`skills`) | Pick/run a skill | **FOLD** with the detail-view skill picker into one entry |
| `DispatchDrawer` / `DispatchSignal` | Dispatch manager | **KEEP / simplify** — powerful but heavy |
| `TeamsPanel` (`teams`) | Team/multi-agent grouping | **KEEP** |

## D. Settings, notifications, scaffolding — *keep, low cost*

| Feature | Verdict |
|---|---|
| `SettingsModal` + `settings/` | **KEEP** |
| `BudgetAlertBanner` | **KEEP** (ties to Intel/token cost) |
| `ShortcutHelpOverlay` / `LegendModal` | **KEEP** |
| `ErrorBoundary` | **KEEP** |

## E. Dead / half-wired — *clean up*

| Item | Issue | Verdict |
|---|---|---|
| `OVERSIGHT_API_KEY` | Declared, unused — dead auth surface | **DEAD** — wire it or delete it |
| Watcher events (`plan_update`, `skills_update`, `workflows_update`, `config_update`, `hooks_update`, `conductor_update`) | Emitted server-side; client refetch wiring is incomplete in places, so the live view can go stale | **FIX** — either complete the refetch or stop emitting |
| Skill cache invalidation | Not wired to the watcher | **FIX** |
| Detail-view sub-tabs | Navigation is under-labeled (discoverability gap) | **FIX** — label them |

---

## The smarter, lighter-weight recommendation

**Thesis.** The durable product is the **core loop (section A) + the harness
status overlay**. Everything else is an opt-in module. The repo's own philosophy
is *progressive disclosure — the window works with zero setup, the rails are
opt-in* — but the **UI doesn't yet practice it**: all 8 tabs and ~8 inspectors are
always-on. The lightest, smartest version of Mission Control is the one that
**makes the UI match the philosophy the docs already preach.**

Three moves, in priority order:

1. **Fold the four read-only inspectors (Config, Hooks, MCP, Memory) into one
   "Inspect" panel.** This is a two-for-one: it removes four always-on surfaces
   *and* shrinks the number of independent couplings to undocumented `~/.claude`
   formats — the single biggest fragility driver in the cockpit. Pair Timeline
   with Conversation; that's the only inspector a user reaches for *live*.

2. **Unify the two orchestration mental models.** Conductor and Mission Control
   are both "drive a structured run." Present one **Runs** surface with modes
   rather than two top-level tabs. Likewise, give Skills a single entry point
   (the tab *or* the detail picker, not both) and validate whether the heavy
   Workflows editor earns its keep before investing further.

3. **Default to a core view; gate the rest behind "Advanced."** A solo dev's
   first screen should be the core loop. Power surfaces (Dispatch, Workflows,
   Intel, Inspect) live one disclosure-click away. This is a recommendation, not
   built here — but it is the natural endpoint of moves 1 and 2.

**Coupling as the lightness metric.** Don't measure "lighter" only in components
removed; measure it in **`~/.claude`-format couplings removed**. Each inspector
folded is one fewer thing that breaks silently when Claude changes its on-disk
shape. The format-drift hardening shipped alongside this review (loud warnings in
the session parser and the Claude driver) is the *defensive* half; folding
inspectors is the *structural* half. Do both and the cockpit gets lighter and more
durable at the same time.

**What this sweep is not.** It is advisory. No features are removed in this PR.
The only code changes here are the three quick wins (hermetic tests, CI,
format-drift hardening) plus two stale-test fixes — see `council-review.md` §6.
