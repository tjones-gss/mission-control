# Feature Sweep — Mission Control (UI/UX worth-keeping audit)

Companion to `council-review.md`. Every user-facing surface, graded for whether
it earns its place. Inventory is taken from `apps/cockpit/server/{routes,parsers}`
and `apps/cockpit/client/src/components` as of 2026-05-31.

**Verdicts:** **KEEP** (core, earns its place) · **FIX** (keep, but a real UX or
correctness gap) · **FOLD** (merge into a shared surface) · **RECONSIDER**
(validate real usage before investing further) · **DEAD** (unused / half-wired,
clean up).

> **Phase 2 status (2026-06-04, shipped):** The four high-leverage Phase 2 moves
> from "The smarter, lighter-weight recommendation" below are now **DONE** in
> `main`: (1) Conductor + Mission Control unified into one **Runs** surface
> (`client/src/components/RunsTab/RunsTab.jsx`); (2) the four read-only inspectors
> folded into one **Inspect** panel with a single live-refetch version per section,
> which also fixes the previously half-threaded inspector refetch
> (`client/src/components/InspectPanel/InspectPanel.jsx`); (3) **executable
> workflows** — `POST /api/workflows/:name/run` spawns a Claude session driving the
> steps; (4) **mark-ready** — `POST /api/harness/:projectKey/missions/:missionId/ready`
> graduates a mission draft → ready via the harness CLI. The Core/Advanced split
> (Phase 1) had already landed in `main`. Rows below are annotated **[DONE Phase 2]**
> where the verdict has been carried out.

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
| `ConfigViewer` | `config` | Low | Med | **FOLD** → Inspect — **[DONE Phase 2]** |
| `HooksPanel` | `hooks` | Low | Med | **FOLD** → Inspect — **[DONE Phase 2]** |
| `McpDashboard` | `mcp` | Low | Med | **FOLD** → Inspect — **[DONE Phase 2]** |
| `MemoryViewer` | `memory` | Low | Med | **FOLD** → Inspect — **[DONE Phase 2]** |
| `TimelineView` | session records | Med | Med | **KEEP** (pairs naturally with Conversation) |
| `PlanViewer` | `~/.claude` plans | Low | Med | **RECONSIDER** — now overlaps the harness PRD plans; pick one home for "the plan" |
| `IntelView` | external (paid) API | Low | High | **RECONSIDER** — keep opt-in; **surface cost before enabling**; it's a transcript-egress path |
| `SkillsPanel` | `skills` | Med | Med | **FOLD** — single skills entry point (see C) |

## C. Orchestration surfaces — *two mental models doing one job*

| Feature | What it does | Verdict |
|---|---|---|
| `ConductorTab` (`conductor`) | Drive an ADR/structured run | **RECONSIDER / unify** — Conductor and Mission Control are both "drive a structured run"; present one "Runs" concept with two modes, not two top-level tabs — **[DONE Phase 2]** now the Conductor *mode* of `RunsTab` |
| `MissionControlTab` (`harness`) | Drive the harness mission loop | **KEEP** (as the unified Runs home) — **[DONE Phase 2]** now the Missions *mode* of `RunsTab` |
| `WorkflowsPanel` (`workflows`) | Author/run step sequences | **RECONSIDER** — heavy editor; mental-model overlap with Skills. **[DONE Phase 2]** workflows are now *runnable* from the UI (`POST /api/workflows/:name/run`); still validate real usage before further editor investment |
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

> **Correction (2026-06-04, verified against source).** The original
> `OVERSIGHT_API_KEY` and "watcher events" rows below were inaccurate. Re-checked
> findings are in the table; see `concepts-vs-system.md` §3 for the full audit.

| Item | Issue | Verdict |
|---|---|---|
| `OVERSIGHT_API_KEY` | **NOT dead.** Live optional API-key auth: mounted via `securityMiddleware` (`server/index.js:41`), enforced in `apiKeyAuth` and the CSRF/origin guard (`middleware/security.js:140,252`), documented in `ARCHITECTURE.md`, covered by tests. It is the path to safely exposing programmatic clients / future browser-approval. | **KEEP** — original "DEAD" verdict was wrong |
| Watcher events (`plan_/skills_/workflows_/config_/hooks_update`) | **Handlers exist** in `App.jsx:179–237`. The real gap: the 4 inspector versions (`config/memory/plan/hooksVersion`) are tracked in `App.jsx` but **not threaded** through `AgentTree.jsx` to `ConfigViewer`/`MemoryViewer`/`HooksPanel`, so their refetch is inert. `hooksVersion` has no `App.jsx` state at all. `workflows_/skills_update` work (direct `refetch*()`). | **FIX in Phase 2** — **[DONE Phase 2]** fixed structurally by folding the 4 inspectors into one `InspectPanel` that threads a single live version per section (`configVersion`/`hooksVersion`/`memoryVersion`) from `AgentTree.jsx`, so the refetch is now live |
| Skill cache invalidation | Not wired to the watcher (30s TTL) | **FIX or document the TTL as intentional** |
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
