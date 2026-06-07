# Oversight — Architecture Guide

> Complete reference for the codebase structure, data flow, and module responsibilities.

---

## Table of Contents

- [System Overview](#system-overview)
- [Data Flow](#data-flow)
- [Server](#server)
  - [Entry & Middleware](#entry--middleware)
  - [Parsers](#parsers)
  - [Routes](#routes)
  - [Intelligence](#intelligence)
  - [File Watching & SSE](#file-watching--sse)
  - [CLI Bridge](#cli-bridge)
  - [PTY Session Control](#pty-session-control)
- [Client](#client)
  - [App Shell](#app-shell)
  - [Hooks](#hooks)
  - [Audio System](#audio-system)
  - [Components](#components)
  - [Settings](#settings)
- [Data Sources](#data-sources)
- [localStorage Schema](#localstorage-schema)
- [Testing](#testing)
- [Directory Tree](#directory-tree)
- [Scripts](#scripts)

---

## System Overview

Oversight is a local web dashboard that monitors Claude Code agent activity in real-time. It reads `~/.claude/` files (sessions, tasks, teams, history), pushes updates via Server-Sent Events, and renders them in a React UI with sound notifications and keyboard shortcuts.

```
~/.claude/  ──►  chokidar watcher  ──►  SSE broadcast  ──►  React UI
                                    ╲
                                     ╲──►  claude CLI (Intel analysis, message replies)
```

**Stack:** Express 4 + React 18 + Vite 5 + Tailwind CSS. No TypeScript, no external database.

### Tab & surface inventory

The UI uses progressive disclosure (`client/src/App.jsx`): a **Core** view is always
visible; **Advanced** tabs sit behind a persisted toggle (`mc.showAdvanced` in
localStorage). Navigating to an advanced-only tab auto-reveals Advanced.

| Group | Tab | Surface |
|-------|-----|---------|
| Core | **Agents** | The core loop — `SessionsList` / `KanbanBoard`, `AgentTree` detail, `ConversationView`, `ToolApprovalBanner` / `QuickActions` |
| Core | **Tasks** | `TaskBoard` |
| Core | **Runs** | `RunsTab` — unified orchestration surface with two modes: **Missions** (`MissionControlTab`, the harness mission loop) and **Conductor** (`ConductorTab`, ADR-driven runs). Replaces the former two top-level Conductor + Mission Control tabs. |
| Core | **Fleet** | `FleetTab/FleetTab.jsx` — the meta-orchestrator surface: start a goal→N-children run, watch per-child status + escalations, read the synthesis. Backed by `GET/POST /api/fleet`; refreshed by the `fleet_update` SSE event. |
| Core | **History** | `HistoryTab/` |
| Advanced | **Workflows** | `WorkflowsPanel` — author, export-to-skill, *and run* step sequences |
| Advanced | **Skills** | `SkillsPanel` — the skill library |
| Advanced | **Teams** | `TeamsPanel/` |

**Inspect (session detail, not a top-level tab):** `InspectPanel/InspectPanel.jsx`
folds the four read-only `~/.claude` viewers — `ConfigViewer`, `HooksPanel`,
`McpDashboard`, `MemoryViewer` — into one panel mounted from `AgentTree.jsx`. It
threads a single live-refetch version per section (`configVersion` / `hooksVersion` /
`memoryVersion`), which also fixes the previously half-threaded inspector refetch.
`TimelineView` stays paired with `ConversationView` (the one inspector reached for
live) rather than being folded in.

---

## Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                          ~/.claude/                                  │
│  projects/*/*.jsonl   tasks/*/   teams/*/   history.jsonl           │
└──────────┬──────────────────────────────────────────────────────────┘
           │ chokidar watches
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Server (Express :3001)                           │
│                                                                     │
│  watcher.js ──► sse.js ──► SSE broadcast to all clients             │
│                                                                     │
│  parsers/          routes/              intelligence/                │
│  ├─ sessions.js    ├─ sessions.js       ├─ analyzer.js              │
│  ├─ messages.js    ├─ tasks.js          ├─ cache.js                 │
│  ├─ tasks.js       ├─ skills.js         └─ triggers.js              │
│  ├─ teams.js       ├─ teams.js                                      │
│  ├─ skills.js      ├─ workflows.js      claude-cli.js               │
│  ├─ workflows.js   ├─ history.js        (spawns claude subprocess)  │
│  └─ history.js     └─ stream.js                                     │
└──────────┬──────────────────────────────────────────────────────────┘
           │ SSE + REST API
           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Client (React :5173)                             │
│                                                                     │
│  App.jsx ─── useSSE ──► state updates ──► component re-renders      │
│         ├── useSound ──► Web Audio presets / TTS                     │
│         ├── useNotifications ──► desktop alerts + sound              │
│         ├── useKeyboardShortcuts ──► global key bindings             │
│         └── useApi ──► REST fetch wrapper                            │
│                                                                     │
│  Components:                                                        │
│  ├─ SessionsList, KanbanBoard    (session views)                    │
│  ├─ AgentTree, ConversationView  (session detail)                   │
│  ├─ TaskBoard                    (task management)                  │
│  ├─ WorkflowsPanel, SkillsPanel (workflows & skills)               │
│  ├─ SettingsModal + tabs         (sound/TTS/shortcuts config)       │
│  └─ ShortcutHelpOverlay          (floating ? shortcut reference)    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Server

### Entry & Middleware

| File | Purpose |
|------|---------|
| `server/index.js` | Express app setup, mounts middleware stack + route modules, starts watcher, registers graceful shutdown |
| `server/lib/config.js` | Centralized env var config with defaults (PORT, HOST, LOG_LEVEL, etc.) |
| `server/lib/logger.js` | Pino structured logger, configurable via LOG_LEVEL env var |
| `server/lib/lifecycle.js` | Graceful shutdown (SIGTERM/SIGINT), readiness state, process error handlers |
| `server/lib/apiError.js` | Standardized `ApiError` class + factory helpers (badRequest, notFound, conflict, unauthorized) |
| `server/lib/claude-bin.js` | Locates the `claude` CLI on PATH (`claude.exe` → `claude.cmd` → `claude.ps1` on Windows, `claude` elsewhere). Exposes a lazy, memoized `getClaudeBin()` so the server boots even if the CLI is missing — routes fail with a clean 503 at call time instead of crashing at import. |
| `server/lib/atomic-write.js` | Atomic JSON writer (write-temp + rename) used by any state file that must never be half-written |
| `server/lib/pending-session.js` | `awaitNewSession(cwd, { timeoutMs })` returns a Promise that resolves with the new sessionId as soon as the chokidar watcher emits `new_session` for a matching encoded cwd. Snapshots existing JSONL IDs before subscribing so a pre-existing file doesn't short-circuit the current spawn. Case-insensitive cwd match on win32. Powers the POST /new early-ack path (job 013). |
| `server/middleware/security.js` | Helmet security headers, express-rate-limit, optional API key auth |
| `server/middleware/requestLogger.js` | pino-http request logging with correlation IDs (X-Request-Id) |
| `server/middleware/performance.js` | Response compression, cache headers, connection timeouts |
| `server/middleware/errorHandler.js` | Global error handler with structured logging and standardized JSON responses |
| `server/utils/validate.js` | Shared input validation helpers (`validateSessionId`, `validateSkillName`, `validateWorkflowName`) used by route modules |

### Parsers

Each parser reads a specific file format from `~/.claude/` and returns structured data.

| File | Input | Output |
|------|-------|--------|
| `parsers/sessions.js` | `projects/*/*.jsonl` | Session list with metadata, agent trees, `needsInput` detection. `getSessionById()` does a targeted file lookup instead of parsing all sessions. |
| `parsers/messages.js` | `projects/*/*.jsonl` | Parsed message blocks (text, thinking, tool calls) for a session |
| `parsers/tasks.js` | `tasks/{sessionId}/*.json` | Task board items per session |
| `parsers/teams.js` | `teams/*/config.json` + `inboxes/` | Team configs and inbox messages |
| `parsers/skills.js` | Various skill directories | User and plugin skills with metadata |
| `parsers/workflows.js` | Git data + session context | Workflow/branch information |
| `parsers/history.js` | `history.jsonl` | Command history entries |
| `parsers/conductor.js` | `<cwd>/.conductor/<NNNN>/status.json` | Discovers conductor roots by scanning session JSONL prefixes for `cwd` (first 8 KB each). Parses run status defensively: `task_iters` map with legacy `iter_count` scalar fallback. Whitelists `projectPath` against known session cwds before any FS read to prevent path-traversal. Exports `getConductorRuns()`, `getConductorRunById()`, `readRunFile()`. |

### Routes

| Module | Key Endpoints |
|--------|--------------|
| `routes/sessions.js` | `GET /`, `GET /:id`, `GET /:id/messages`, `POST /:id/message`, `POST /:id/skill`, `POST /:id/fork`, `POST /:id/name`, `POST /new`, `POST /:id/tool-approval`, `POST /:id/cancel`, `GET /:id/query-status`. Uses `router.param('sessionId')` middleware for input validation. **POST /new** races `awaitNewSession(cwd)` (watcher signal) against `runClaudeCancellable(...)` (full CLI run). Whichever wins picks the response: 202 `{ pendingSessionId }` on watcher ack (~500 ms, common case), 201 `{ ok, result, stderr }` on CLI-wins (rare error paths), 504 on 15-s deadline, 503 on CLI failure before ack. CLI failure after ack is logged warn-level and never re-hits the client. |
| `routes/tasks.js` | `GET /:sessionId`, task CRUD (async `fs/promises`) |
| `routes/skills.js` | `GET /`, skill listing |
| `routes/teams.js` | `GET /`, `POST /:name/inbox`, `PATCH /:name/inbox/:messageId` |
| `routes/workflows.js` | `GET /`, `POST /` (create), `PUT /:name`, `DELETE /:name`, `POST /:name/export` (write a `~/.claude/skills/:name.md` skill), **`POST /:name/run`** (spawn a Claude session driving the workflow's ordered steps — same spawn pattern as missions execute: 202 `{ ok, status:'started', sessionId }` on file-watcher ack, 404 if the workflow file is missing, 409 `{ error:'in_progress' }` on a concurrent run of the same workflow). Path-traversal guarded; concurrency-keyed on the workflow name. |
| `routes/harness.js` | `GET /api/harness` (list harness projects), `GET /:projectKey` (single project detail), `POST /:projectKey/roadmap/compile` (write a spec, spawn `mission-writer` to slice it into `status: draft` missions), `POST /:projectKey/missions/:missionId/execute` (spawn an on-rails implementer session for one mission), **`POST /:projectKey/missions/:missionId/ready`** (graduate a mission draft → ready by shelling `harness mission ready <id>` — the cockpit never edits `mission-index.yml`; the harness CLI owns that write). `projectKey` is an `encodeURIComponent`-encoded absolute path, decoded and whitelisted against known harness roots before any write or spawn. |
| `routes/history.js` | `GET /`, `GET /stats` |
| `routes/stream.js` | `GET /stream` — SSE endpoint |
| `routes/fs.js` | `GET /api/fs/home`, `GET /api/fs/list?path=…` — host filesystem enumeration used by the sidebar folder picker. Returns `sep` so the client stays platform-agnostic. Absolute-only, NUL-reject, UNC-reject on Windows. Unrestricted directory listing is intentional for a local-only dashboard; documented inline. |
| `routes/managers.js` | `GET /api/managers` — manager/team/standalone session groupings surfaced by the Dispatch Manager. |
| `routes/conductor.js` | `GET /api/conductor` (list all runs), `GET /api/conductor/:projectKey/:adr` (single run), `GET /api/conductor/:projectKey/:adr/:kind` (file content, kind ∈ `journal`, `ratification`, `skill-diff`, `plan`, `status`). `projectKey` is `encodeURIComponent`-encoded absolute path; server decodes and whitelists it against known roots. File content returned as `text/plain` to avoid JSON parsing on malformed content. |
| `routes/fleet.js` | **`POST /api/fleet`** (start a run — early-ack `202 { ok, id, status, children }`; children spawn in the background. Accepts either an inline `{ goal, children, policy }` body OR `{ template: name }` to instantiate a saved template; inline fields override template defaults), `GET /api/fleet` (list run summaries), `GET /api/fleet/:id` (full persisted run state, 404 if unknown), **`POST /api/fleet/templates`** (save a repeatable fleet config — `{ name, goal, children, policy }`; the name is validated like a workflow name at the route AND re-validated with the body in the runner before any write), **`GET /api/fleet/templates`** (list saved templates), `GET /api/fleet/:id/escalations` (merged escalation list — live SDK tool-approval requests tagged `source:'tool'` + harness `.harness/approvals/pending/*.json` tagged `source:'harness'`; reconciles the per-child `running↔escalated` status as a side effect so the badge survives a reload), **`POST /api/fleet/:id/decide`** (route ONE human Allow/Deny — body `{ childIdx, source:'tool'\|'harness', decision:'allow'\|'deny', approvalId?, requestId?, message? }`), **`POST /api/fleet/:id/cancel`** (cancel in-flight children, `202`). A thin Express layer over `server/fleet/fleet-runner.js`, which owns all lifecycle/spawn/persistence/safety. **Route-ordering note:** the `/templates` routes are registered *before* the `/:id` param routes so Express does not match `templates` as an `:id`. **`/decide` is a dispatch-only endpoint, not a new approval store** — it routes the decision through the EXISTING write paths: the in-memory SDK `resolveApproval` (the same one `POST /api/sessions/:id/tool-approval` uses) for `source:'tool'`, and the harness CLI (`harness approve <requestId> --allow\|--deny`, shelled in the whitelisted child cwd) for `source:'harness'`. The cockpit NEVER writes a `.harness/approvals/decided/` file itself — the harness CLI is the single writer, and it copies the pending request's `commandHash` onto the decision (replay-proofing). Fleet has no auto-approve branch. |

### Intelligence

AI-powered session analysis using the `claude` CLI.

| File | Purpose |
|------|---------|
| `intelligence/analyzer.js` | Builds prompts, calls `claude` CLI for structured analysis |
| `intelligence/cache.js` | 5-minute TTL cache for analysis results |
| `intelligence/triggers.js` | Decides when to (re)run analysis based on session changes |

### File Watching & SSE

| File | Purpose |
|------|---------|
| `watcher.js` | chokidar file watcher on `~/.claude/`, detects changes, triggers parser re-reads |
| `sse.js` | SSE connection manager, broadcasts typed events to all connected clients |

**SSE Event Types:** `session_update`, `new_session`, `task_update`, `team_update`, `intelligence_update`, `history_update`, `sdk_message`, `sdk_result`, `sdk_error`, `tool_approval_request`, `tool_approval_resolved`, `conductor_update`, `fleet_update`

**`fleet_update`:** emitted by `server/fleet/fleet-runner.js` after every persisted-state write (write THEN emit, mirroring `conductor_update`). The payload is a *summary*, not the full state — `{ id, goal, status, createdAt, updatedAt, childCount, settledCount, verifyingCount, rejectedCount, spentUsd, budgetUsd, budgetRemaining, synthesis }` (`childCount` stays the *worker* count so the left-rail "N children" matches what the user launched — verifier children are an internal review detail) — and the client uses it only as a refresh signal (`App.jsx` bumps a `fleetVersion`, `FleetTab` refetches `GET /api/fleet[/:id]`). The allowed-event list in `client/src/hooks/useSSE.js` includes `fleet_update`.

**Conductor watching:** On startup and on every `new_session` event, `watcher.js` calls `getKnownConductorRoots()` and dynamically `chokidar.add()`s any `.conductor/` directories it finds. `chokidar.add()` is idempotent so no dedup logic is needed. Changes to files under those directories emit `conductor_update` with `{ projectPath, adr, filePath, ts }` and skip the normal `~/.claude/` path handling.

### CLI Bridge

| File | Purpose |
|------|---------|
| `claude-cli.js` | Spawns `claude` CLI as subprocess for new sessions, fork, worktree creation, and intel analysis. Resolves the binary via `lib/claude-bin.js` (lazy + memoized). On non-zero exit the rejected error carries both `stderrOutput` and `stdoutOutput` so callers can surface structured failures (e.g. the 429 quota JSON the CLI writes to stdout). Exposes both `runClaude(...)` (returns a bare Promise, legacy shape) and `runClaudeCancellable(...)` (returns `{ promise, cancel }` so callers can kill the child when a timeout fires). Concurrent writes to the same session are blocked at the route layer (409 Conflict). |

### PTY Session Control

| File | Purpose |
|------|---------|
| `pty-session.js` | Spawns `claude --resume` in a pseudo-terminal for interactive messaging. Uses subscription auth (not API credits). Detects tool approval prompts via pattern matching on PTY output, emits SSE events for real-time UI updates. |

**Why PTY instead of SDK?** The Agent SDK's `query()` function creates synthetic API calls billed against API credits. The PTY approach types into an interactive CLI session, which uses the user's existing subscription — same as typing in a terminal.

**Key behaviors:**
- PTY kept alive for session reuse (not respawned per message)
- Tool approval prompts detected via regex patterns on ANSI-stripped output
- Auto-deny after 120s timeout (timer stored on approval object, cleared on early resolve)
- 10-minute safety timeout marks query as no longer busy
- `waitForReady()` detects CLI initialization via 1.5s silence after first output

### Fleet Meta-Orchestrator

| File | Purpose |
|------|---------|
| `fleet/fleet-runner.js` | The Fleet lifecycle owner (no Express). Turns a goal into N autonomous child sessions, each spawned via `runClaudeCancellable` **with `--worktree`** (own git worktree/branch) — the same spawn-with-early-ack pattern as the mission-execute handler in `routes/harness.js`, copied once per child. Children run under the harness rails and *escalate* on danger rather than auto-approving. When the last child settles it releases the per-run concurrency key and spawns ONE synthesis child (a normal `runClaudeCancellable` in the first NON-quarantined worker's cwd) fed each child's branch + result. Per-child cost is populated by `populateChildCost(child)` — on the watcher ack and again on settle it reads `parsers/sessions.js getSessionById(child.sessionId).estimatedCost` (the cockpit's canonical `{ totalCost, breakdown, family }` shape) onto `child.cost`, so Fleet never invents a parallel cost model; it stays `null` until the session id is known and Claude has written usage. State is persisted one JSON per run via `atomicWriteJson` to `server/data/fleet/<id>.json`, and a summary is emitted on `fleet_update` after each write. **Phase 4** layers the dynamic-workflow PATTERNS natively onto this same seam (no embedded Workflow engine — see ADR-003 §Phase 4): token **budgets**, adversarial **verification**, **quarantine**, and saved **templates**. |

**Spawn safety:** Fleet spawns several autonomous agents, so an absurd N is refused server-side *before* any spawn. `MAX_FLEET_CHILDREN` (4) is the default cap; `policy.maxConcurrency` may only *lower* it, never raise it. `HARD_REFUSE_CHILDREN` (8) is an absolute refusal line. `validateFleetRequest()` fails closed (all-or-nothing): it requires a non-empty `goal`, a non-empty `children` array within the caps, a `prompt` or `workflow` per child, and — for **every** child cwd — both a known-harness-root whitelist hit (else 404) and a `.git` precondition (else 404, since `--worktree` against a non-git tree is unsafe). A `workflow` value is passed as a `/workflow <name>` slash command, never used to build a filesystem path, so a tampered name cannot traverse.

**In-memory registries** (the server is the single spawner/writer): `inFlight` keys each run so a double-submit gets a clean 409; `cancels` maps `fleetId → [cancel,…]` so `cancelFleet` can kill in-flight children; `pendingCounts` tracks not-yet-settled children so the run key is released and synthesis runs exactly once. `__resetFleet()` clears them in tests.

**Escalation surfacing is read-only; deciding is dispatch-only.** `listEscalations(id)` merges, per child, the live SDK tool-approval requests for that child's session (`source:'tool'`) and the harness rails' `.harness/approvals/pending/*.json` (`source:'harness'`). `reconcileEscalationStatus(id)` (called from `GET /:id/escalations`) flips a `running` child to `escalated` while it has a live escalation and back to `running` once it clears, persisting only when the status actually changes. `decideFleetEscalation(id, body)` (called from `POST /:id/decide`) routes ONE human Allow/Deny through the EXISTING write paths and adds NO approval logic of its own: `source:'tool'` calls the in-memory SDK `resolveApproval` (same function `POST /api/sessions/:id/tool-approval` uses); `source:'harness'` shells `harness approve <requestId> --allow\|--deny` in the child's whitelisted cwd via `runClaude` (like the mission-ready route). The harness CLI is the SINGLE WRITER of `.harness/approvals/decided/<requestId>.json` and copies the pending request's `commandHash` onto the decision so a stale/replayed decision cannot unblock a different command. Fleet never writes a decided file directly and never auto-approves.

#### Phase 4 — dynamic-workflow patterns, native (policy surface)

Phase 4 implements the dynamic-workflow PATTERNS (token budgets, adversarial
verification, loop-until-done, quarantine, saved templates) **natively in
`fleet-runner.js`** rather than by embedding the Claude Code Workflow engine —
which is part of the agent runtime, not an importable library for the Express
server (the decision and its rationale live in **ADR-003 §Phase 4**). Everything
below rides the same `spawnChild` (one governed `runClaudeCancellable --worktree`
per child) + `persistFleet` (atomic write + `fleet_update`) seam Phase 3
established; it adds new *kinds* of children and new run-level policy/state, no new
spawn/approval/persistence stack.

**Budget enforcement** (`policy.budgetUsd`, optional `policy.perChildUsd`). When a
positive `budgetUsd` is set, enforcement turns on (omitted = today's count-cap-only
behaviour). `spentUsd(state)` is the single running-total definition — it sums
`child.cost.totalCost` across workers + verifiers + the synthesis child (missing/null
→ 0), recomputed in `persistFleet` so `run.spentUsd` / `run.budgetRemaining` track
every cost movement. Because `child.cost` *lags* (it is `null` until the session
writes usage), enforcement uses a **pre-spawn projection** (`projectionWouldExceed`),
not the laggy actual: it reserves one `perChildUsd` estimate (or a conservative
`DEFAULT_CHILD_ESTIMATE_USD = 0.5` fallback) for each already-committed-but-not-yet-costed
child plus the one about to spawn, and refuses pessimistically so an initial
synchronous fan-out honours the budget. There are three gates: a **start-time guard**
in `validateFleetRequest` (refuse the whole run `422` if `children.length × perChildUsd`
already exceeds the budget), a **per-spawn projection** in the fan-out loop (a child
that would push the projection over budget is never spawned — marked
`budget_skipped`), and a **budget latch** read before each verifier/re-dispatch
(`budgetExceeded`: once the running total crosses the cap, stop spawning anything
further). In-flight children are *allowed to finish* (their cost is sunk; killing a
child mid-write can corrupt a worktree); the run then settles to `budget_exceeded`
and synthesis is skipped.

**Verifier-child flow** (`policy.verify`: `true`, sugar for `{ minApprovals:1,
maxRounds:1 }`, or an explicit `{ minApprovals, maxRounds }`). After a worker settles
`succeeded` — when verify is on and the budget latch is clear — it does NOT count as a
final settle: `maybeStartVerification` flips it to `verifying` and `spawnVerifier`
launches an **adversarial VERIFIER child** in the SAME cwd as the worker (so it can
`git diff` the worker's branch). The verifier runs in fresh context, is **blind to
authorship** (its prompt never says who produced the work), is itself quarantined
(read-only), and must return only a JSON verdict `{ verdict:'approve'|'reject',
reasons, rubricScores }`. `parseVerdict` **fails closed to `reject`** on anything
unparseable — a malformed or failed verifier can never silently pass work. The
verifier is appended to `state.children` (so synthesis still waits for it via
`pendingCounts`) but is excluded from the run-level outcome (`deriveStatus` filters
verifiers out; only worker outcomes define the run). `routeVerdict` then: **approve +
enough approvals** → worker final `succeeded`; **approve but `minApprovals` not yet
met** → spawn another independent verifier (budget permitting); **reject** →
re-dispatch the worker up to `maxRounds` (bounded loop-until-done, prior rejection
reasons are prepended to the re-dispatch prompt), else the worker is terminal
`rejected`. Verifiers count toward the same budget and emit `fleet_update`; each
round's verdict is recorded on `child.verdicts[]`.

**Quarantine** (`child.quarantine: true`). A quarantined child is given a best-effort
read-only / no-privileged-action stance via (a) an explicit `QUARANTINE_DIRECTIVE`
prepended to its prompt and (b) the existing danger-zone hooks where the child's
project has harness rails. **This is accident-prevention, not a sandbox** (the same
framing the README uses for the rails generally) — a determined or confused model can
ignore the directive, which is exactly why it is not called a boundary; the genuine
control for an untrusted child is OS-level sandboxing. A quarantined child is barred
from being the synthesis/acting child; if ALL workers are quarantined, synthesis runs
read-only in the first worker's cwd and is flagged so the UI can say so. Verifier
children are always quarantined (a reviewer must not modify code).

**Templates** (saved, repeatable fleet configs — the dynamic-workflows "save working
workflows" pattern). `saveFleetTemplate` writes one JSON per template to
`server/data/fleet-templates/<name>.json` via `atomicWriteJson` (the same primitive
as runs); `listFleetTemplates` / `getFleetTemplate` read them. A template stores
`{ name, goal, children, policy }` and is validated with the SAME body checks as a
start request PLUS a filesystem-safe name rule — but it does NOT require the child
cwds to be whitelisted at save time (a template may target a project not yet
registered); the whitelist + git-repo preconditions are enforced at launch. A
template is a request-construction convenience: `POST /api/fleet { template: name }`
instantiates it (inline fields override template defaults) — it starts no lifecycle
of its own. The name is traversal-guarded before any path is built.

#### Fleet-run state shape (`server/data/fleet/<id>.json`)

```jsonc
{
  "id": "<slug(goal)>-<iso-timestamp>",   // path-safe; '/','\\','..' rejected on read
  "goal": "the original goal (the supervisor holds it)",
  "createdAt": "ISO",
  "updatedAt": "ISO",
  "status": "running",   // running | succeeded | failed | partial | cancelled | budget_exceeded (derived)
  "policy": {                              // resolved/persisted policy (what was enforced)
    "maxConcurrency": 4,                   // effective cap (clamped to MAX_FLEET_CHILDREN)
    "budgetUsd": 5,                        // optional — hard dollar cap; omitted = no budget enforcement
    "perChildUsd": 0.5,                    // optional — per-child estimate for the pre-spawn projection
    "verify": { "minApprovals": 1, "maxRounds": 1 }  // optional — adversarial verification (or true)
  },
  "spentUsd": 0,                           // running total across workers + verifiers + synthesis
  "budgetRemaining": 5,                    // max(0, budgetUsd - spentUsd) when budgeted, else null
  "children": [
    {
      "idx": 0,
      "cwd": "/abs/known/harness/root",
      "prompt": "literal prompt or null",
      "workflow": "workflow name or null",  // exactly one of prompt/workflow is set
      "childKind": "worker",                 // worker | verifier (verifiers appended at runtime)
      "quarantine": false,                   // best-effort read-only stance (NOT a sandbox)
      "sessionId": null,                     // filled on watcher ack
      "worktree": true,                      // children ALWAYS run with --worktree
      "branch": "fleet/<id>/c0",
      "status": "starting",                  // starting | running | escalated | succeeded | failed |
                                             //   cancelled | verifying | rejected | budget_skipped
      "cost": null,                          // null until the session id is known/settles, then the
                                             //   cockpit's canonical session-cost shape:
                                             //   { totalCost, breakdown:{ input, output, cacheWrite, cacheRead }, family }
                                             //   pulled from parsers/sessions.js getSessionById(...).estimatedCost
      "rounds": 0,                           // re-dispatch count, bounded by policy.verify.maxRounds
      "verdicts": [],                        // one entry per verification round: { round, verdict, reasons, ... }
      "verifiedBy": null,                    // sessionId of the verifier that produced the latest approve
      "escalation": null,
      "error": null
    }
  ],
  "synthesis": {
    "status": "pending",   // pending | running | done | skipped
    "sessionId": null,
    "summary": null,       // merged report text (extracted from the synth child's stream-json result)
    "completedAt": null
  }
}
```

The run `status` is *derived* from the **worker** children only (verifiers are tracked for `pendingCounts`/cost but never define the run outcome): all-cancelled → `cancelled`; any worker still unsettled OR a verifier still in flight → `running`; otherwise `succeeded` (all ok), `failed` (all failed/rejected/budget_skipped), or `partial` (mixed). `budget_exceeded` supersedes the derived status when the running cost total crossed `policy.budgetUsd`. Synthesis is `skipped` when the run was cancelled, the budget was exceeded, or no primary (non-quarantined) cwd exists.

---

## Client

### App Shell

| File | Purpose |
|------|---------|
| `main.jsx` | React entry point |
| `App.jsx` | Root component — SSE subscription, session state, tab routing, sound/shortcut wiring |

`App.jsx` is the orchestrator. It:
- Subscribes to SSE via `useSSE`
- Manages session selection, tab state, view mode
- Creates `useSound()` engine and passes it to `useNotifications` and `SettingsModal`
- Creates `useKeyboardShortcuts()` with ref-based handlers for stable listener identity
- Maps SSE events to sounds (with 5s throttle for `session_update`)

### Hooks

| Hook | Purpose |
|------|---------|
| `useApi.js` | Generic fetch wrapper with loading/error/data state. Accepts null URL (skips fetch). |
| `useSSE.js` | EventSource subscriber with auto-reconnect. Calls a callback on each event. |
| `useNotifications.js` | Watches sessions for `needsInput` transitions. Fires desktop notifications + delegates sound to `useSound`. Supports per-session muting. |
| `useSound.js` | Core audio engine. Lazy AudioContext init, plays synthesized presets or custom uploaded sounds, TTS via speechSynthesis, localStorage persistence. Returns memoized API object. |
| `useKeyboardShortcuts.js` | Global `keydown` listener with 14 default bindings. Ignores input fields (except Escape). Supports modifier combos (`Ctrl+k`). Conflict auto-resolution on rebind. |
| `useStreamingSession.js` | Manages streaming query state, pending tool approvals, and SDK errors for the selected session. Resyncs on mount via `/query-status`. |

### Audio System

| File | Purpose |
|------|---------|
| `audio/presets.js` | 8 synthesized Web Audio sounds: `chime`, `ping`, `alert`, `gentle`, `urgent`, `success`, `fail`, `none` |
| `audio/tts.js` | `speak()` with cancel-before-speak, `getAvailableVoices()` with cache-reset-on-empty, per-event TTS templates |

**Sound resolution order in `play()`:**
1. `"none"` → no-op
2. `"custom:name"` → decode base64 from localStorage, play via `decodeAudioData`
3. Preset match → call synthesized function from `presets.js`
4. If `voice: true` + session context → TTS announcement

**Safeguards:** Custom sound names restricted to `[a-zA-Z0-9_-]`, 500KB per file, 2MB aggregate, AudioContext closed on unmount.

### Components

| Component | Purpose |
|-----------|---------|
| `SessionsList.jsx` | Left sidebar — sessions grouped by Active/Recent/Older |
| `NewSessionForm.jsx` | Inline new-session form at the top of the sidebar — name, cwd + folder picker trigger, prompt, model, mode, worktree. Surfaces CLI `stderr` / `stdout` in scrollable monospace blocks on failure. |
| `FolderPicker.jsx` | Modal folder picker used by `NewSessionForm` — breadcrumb + Home/Up/Show-hidden, recent-cwd chips, driven by `/api/fs/*`. Uses the server-reported path separator so it works identically on POSIX and Windows. |
| `DispatchDrawer.jsx` + `DispatchSignal.jsx` | Dispatch Manager — select many sessions grouped by project / team and send one message (or skill) to all of them through the existing PTY path. `DispatchSignal` is the bottom-docked launcher badge. |
| `KanbanBoard.jsx` | Board view — sessions as cards in status columns |
| `AgentTree.jsx` | Detail view shell — sub-tab bar (Conversation/Timeline/Summary/Intel), session control bar |
| `ConversationView.jsx` | Message thread with send input, slash-command autocomplete, option pills |
| `ToolApprovalBanner.jsx` | Inline banner for pending tool approvals — shows tool name with color coding, Allow/Deny buttons, expandable input preview |
| `Markdown.jsx` | Memoized ReactMarkdown wrapper with GFM and syntax highlighting |
| `TimelineView.jsx` | Chronological event list with time deltas |
| `IntelView.jsx` | AI analysis display with auto-refresh |
| `SessionControlBar.jsx` | Per-session model/mode/effort selector |
| `TaskBoard.jsx` | Task management for selected session |
| `WorkflowsPanel.jsx` | Workflow/branch listing |
| `SkillsPanel.jsx` | Installed skills viewer |
| `TeamsPanel/` | Team configs, inbox feed, compose input |
| `HistoryTab/` | Command history stats, feed, search, filters |
| `ConductorTab/ConductorTab.jsx` | Master list of all discovered Conductor runs across projects — phase pill, validator iter count, split count, escalation badge |
| `ConductorTab/RunDetail.jsx` | Detail view for a single run — acceptance-command checklist, sub-tabs for journal/ratification/skill-diff rendered via `Markdown.jsx` |
| `ConductorTab/StartConductorDialog.jsx` | Launch dialog — validates 4-digit ADR, POSTs `/conductor NNNN` to `POST /api/sessions/new` |
| `ErrorBoundary.jsx` | React error boundary with retry |
| `LiveFeed.jsx` | Right sidebar — real-time SSE event stream |
| `LegendModal.jsx` | Help overlay with layout, color, shortcut reference |
| `QuickActions.jsx` | One-click reply buttons (yes/continue/approve) |
| `ShortcutHelpOverlay.jsx` | Floating `?` badge with expandable shortcut table |

### Settings

| Component | Tab | Purpose |
|-----------|-----|---------|
| `SettingsModal.jsx` | — | Modal shell, passes props to tabs |
| `settings/SettingsTabs.jsx` | — | Tab container (Notifications / Sounds & Voice / Shortcuts) |
| `settings/NotificationsTab.jsx` | Notifications | Desktop notification toggle, global mute, volume slider, test button |
| `settings/SoundsVoiceTab.jsx` | Sounds & Voice | Event-to-sound mapping table, TTS voice picker, custom sound upload |
| `settings/ShortcutsTab.jsx` | Shortcuts | Click-to-rebind key binding editor, reset to defaults |

---

## Data Sources

All data is read from the local filesystem. The server never modifies `~/.claude/` files directly — interaction goes through the `claude` CLI subprocess.

| Path | Format | Content |
|------|--------|---------|
| `~/.claude/projects/*/*.jsonl` | JSONL | Session threads (messages, tool calls, thinking blocks) |
| `~/.claude/tasks/{sessionId}/*.json` | JSON | Task board items |
| `~/.claude/teams/*/config.json` | JSON | Team configuration |
| `~/.claude/teams/*/inboxes/*.json` | JSON | Team inbox messages |
| `~/.claude/history.jsonl` | JSONL | Command history |
| `server/data/session-names.json` | JSON | User-assigned session display names (cached in memory) |
| `<projectCwd>/.conductor/<NNNN>/status.json` | JSON | Conductor run state: `phase`, `task_iters` map, `splits`, `acceptance_commands_required/run`, `escalation_reason`, `started_at` |
| `<projectCwd>/.conductor/<NNNN>/journal-draft.md` | Markdown | Conductor journal draft (present only when run has reached journal phase) |
| `<projectCwd>/.conductor/<NNNN>/ratification-proposal.md` | Markdown | Ratification proposal |
| `<projectCwd>/.conductor/<NNNN>/skill-diff-proposal.md` | Markdown | Skill-diff proposal |

---

## localStorage Schema

| Key | Shape | Purpose |
|-----|-------|---------|
| `oversight.notifications` | `{ enabled: bool, sound: bool }` | Desktop notification + global mute toggle |
| `oversight.sound` | `{ masterVolume, events: {…}, ttsVoice, customSounds: {…} }` | Full sound engine config (2MB aggregate cap on customSounds) |
| `oversight.shortcuts` | `{ action: keyString, … }` | 14 rebindable keyboard shortcuts |

---

## Testing

**1,136 total tests** — 691 server (46 files) + 445 client (40 files). All must pass before pushing.

| Suite | Runner | Count | Location |
|-------|--------|-------|----------|
| Server parsers | Vitest | ~191 | `server/tests/parsers/` (incl. conductor: parser shape, malformed handling, ADR filtering, path-traversal rejection) |
| Server routes | Vitest | ~200 | `server/tests/routes/` (incl. sessions, fs, stream, health, tasks, teams, workflows, skills, managers, plans, history, conductor) |
| Server intelligence | Vitest | ~37 | `server/tests/intelligence/` (cache, analyzer, triggers) |
| Server infrastructure | Vitest | ~22 | `server/tests/` (sse, watcher) |
| Server PTY | Vitest | 59 | `server/tests/pty-session.test.js` |
| Server middleware | Vitest | ~27 | `server/tests/middleware/` (security, requestLogger, performance, errorHandler) |
| Server lib | Vitest | ~36 | `server/tests/lib/` (config, apiError, lifecycle, logger, claude-bin) |
| Server utils | Vitest | ~60 | `server/tests/utils/` (cost, costEnhanced, export, commandClassifier, secretScanner) |
| Client hooks | Vitest + RTL | ~100 | `client/src/tests/hooks/` |
| Client audio | Vitest | 25 | `client/src/tests/audio/` |
| Client components | Vitest + RTL | ~307 | `client/src/tests/components/` (incl. NewSessionForm, FolderPicker, DispatchSignal, ConductorTab: paused/running rendering, Start dialog ADR validation) |
| E2E | Playwright | — | `e2e/` (incl. `api-dispatch.spec.js`, split out so shape/validation tests don't contend with UI tests for worker slots) |

**Test infrastructure:**
- MSW (Mock Service Worker) for API mocking in client tests
- `MockEventSource` in `client/src/tests/setup.js` for SSE testing
- `MockAudioContext` in useSound tests (with `close()` method)

**CI/CD:**
- GitHub Actions workflow: lint → test (Node 20+22 matrix) → e2e
- Pre-commit hooks via husky + lint-staged (Prettier auto-format)
- Branch protection requires all CI jobs to pass before merge

---

## Directory Tree

```
oversight/
├── client/
│   ├── public/
│   │   └── sounds/              # Reserved for bundled mp3s
│   ├── src/
│   │   ├── audio/
│   │   │   ├── presets.js       # 8 synthesized Web Audio sounds
│   │   │   └── tts.js           # speechSynthesis wrapper + TTS templates
│   │   ├── components/
│   │   │   ├── settings/
│   │   │   │   ├── SettingsTabs.jsx
│   │   │   │   ├── NotificationsTab.jsx
│   │   │   │   ├── SoundsVoiceTab.jsx
│   │   │   │   └── ShortcutsTab.jsx
│   │   │   ├── ConductorTab/
│   │   │   │   ├── ConductorTab.jsx       # Run list — phase pill, iter/split counts
│   │   │   │   ├── RunDetail.jsx          # Single run detail + sub-tabs
│   │   │   │   └── StartConductorDialog.jsx # ADR input → POST /api/sessions/new
│   │   │   ├── AgentTree.jsx
│   │   │   ├── ConversationView.jsx
│   │   │   ├── DispatchDrawer.jsx        # Dispatch Manager modal
│   │   │   ├── DispatchSignal.jsx        # Bottom-docked dispatch launcher
│   │   │   ├── FolderPicker.jsx          # /api/fs-backed folder picker
│   │   │   ├── Markdown.jsx
│   │   │   ├── ToolApprovalBanner.jsx
│   │   │   ├── IntelView.jsx
│   │   │   ├── KanbanBoard.jsx
│   │   │   ├── LegendModal.jsx
│   │   │   ├── LiveFeed.jsx
│   │   │   ├── NewSessionForm.jsx        # Inline sidebar new-session form
│   │   │   ├── QuickActions.jsx
│   │   │   ├── SessionControlBar.jsx
│   │   │   ├── SessionsList.jsx
│   │   │   ├── SettingsModal.jsx
│   │   │   ├── ShortcutHelpOverlay.jsx
│   │   │   ├── SkillsPanel.jsx
│   │   │   ├── TaskBoard.jsx
│   │   │   ├── TeamsPanel.jsx
│   │   │   ├── TimelineView.jsx
│   │   │   └── WorkflowsPanel.jsx
│   │   ├── hooks/
│   │   │   ├── useApi.js
│   │   │   ├── useKeyboardShortcuts.js
│   │   │   ├── useNotifications.js
│   │   │   ├── useSSE.js
│   │   │   ├── useSound.js
│   │   │   └── useStreamingSession.js
│   │   ├── tests/
│   │   │   ├── audio/           # presets.test.js, tts.test.js
│   │   │   ├── components/      # 17 component test files
│   │   │   ├── hooks/           # 4 hook test files
│   │   │   ├── mocks/           # MSW handlers + server
│   │   │   └── setup.js         # Test globals, MockEventSource
│   │   ├── utils/
│   │   │   └── session.js       # projectLabel() helper
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── server/
│   ├── data/
│   │   └── session-names.json   # Cached in memory at runtime
│   ├── intelligence/
│   │   ├── analyzer.js
│   │   ├── cache.js
│   │   └── triggers.js
│   ├── parsers/                  # 14+ parser modules (sessions, messages, tasks, teams, skills, workflows, history, managers, plans, mcp, hooks, config, memory, conductor)
│   ├── routes/                   # 12+ route modules (sessions, fs, tasks, skills, teams, workflows, history, managers, plans, stream, health, conductor)
│   ├── lib/
│   │   ├── config.js             # Centralized env var config
│   │   ├── logger.js             # Pino structured logger
│   │   ├── lifecycle.js          # Graceful shutdown + readiness
│   │   ├── apiError.js           # Standardized error class
│   │   ├── claude-bin.js         # Lazy, memoized `claude` CLI resolver (Windows .exe/.cmd/.ps1 aware)
│   │   └── atomic-write.js       # write-temp + rename JSON writer
│   ├── middleware/
│   │   ├── security.js           # Helmet, rate limiting, API key auth
│   │   ├── requestLogger.js      # pino-http + correlation IDs
│   │   ├── performance.js        # Compression, cache, timeout
│   │   └── errorHandler.js       # Global error handler
│   ├── utils/
│   │   └── validate.js           # Shared input validation helpers
│   ├── tests/
│   │   ├── parsers/              # Parser test files (sessions, messages, tasks, teams, skills, workflows, history, managers, plans, mcp, hooks, config, memory)
│   │   ├── routes/               # Route test files (sessions, fs, stream, health, tasks, teams, workflows, skills, managers, plans, history)
│   │   ├── intelligence/         # Cache, analyzer, triggers tests
│   │   ├── middleware/           # Security, logging, perf, error tests
│   │   ├── lib/                  # Config, apiError, lifecycle, logger tests
│   │   ├── sse.test.js           # SSE registry tests
│   │   └── watcher.test.js       # File watcher tests
│   ├── claude-cli.js
│   ├── pty-session.js
│   ├── index.js
│   ├── sse.js
│   ├── watcher.js
│   └── package.json
├── .github/
│   └── workflows/ci.yml          # CI pipeline (lint, test, e2e)
├── .husky/
│   └── pre-commit                # Runs lint-staged on commit
├── docs/
│   ├── ARCHITECTURE.md           # ← this file
│   ├── screenshots/              # 15 PNG screenshots (overview, dispatch, new-session, board, conversation, timeline, tasks, etc.)
│   └── superpowers/
│       ├── plans/                # Implementation plans
│       └── specs/                # Design specifications
├── .env.example                  # Documented env var template
├── .prettierrc                   # Code formatting config
├── Dockerfile                    # Multi-stage production build
├── docker-compose.yml            # Container deployment
├── README.md
└── package.json                  # Root scripts (dev, test, lint)
```

---

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Starts both server (:3001) + client (:5173) via concurrently |
| `npm test` | Runs all server + client tests sequentially |
| `npm run test:server` | Server tests only (Vitest) |
| `npm run test:client` | Client tests only (Vitest + RTL) |
| `npm run test:e2e` | End-to-end tests (Playwright) |
| `npm run test:coverage` | Both suites with V8 coverage |
| `npm run lint` | Prettier format check |
| `npm run lint:fix` | Auto-fix formatting issues |
| `npm run format` | Format all files with Prettier |

## Configuration

All enterprise features are opt-in via environment variables (see `.env.example`):

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |
| `HOST` | `0.0.0.0` | Server bind address |
| `LOG_LEVEL` | `info` | Pino log level (debug, info, warn, error) |
| `OVERSIGHT_API_KEY` | *(empty)* | Set to require API key auth on all endpoints |
| `OVERSIGHT_CORS_ORIGIN` | *(localhost)* | Comma-separated allowed CORS origins |
| `OVERSIGHT_RATE_LIMIT` | `100` | Max requests per 15min per IP (0 = disabled) |
| `OVERSIGHT_CSP` | `true` | Content Security Policy headers |

## Deployment

**Docker:**
```bash
docker build -t oversight .
docker run -p 3001:3001 -v ~/.claude:/root/.claude:ro oversight
```

**Docker Compose:**
```bash
docker compose up
```

**Health checks:**
- `GET /api/health` — basic health (backwards compatible)
- `GET /api/health/live` — liveness probe (uptime)
- `GET /api/health/ready` — readiness probe (memory stats, 503 until ready)
