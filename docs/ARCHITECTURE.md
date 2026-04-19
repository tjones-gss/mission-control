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

### Routes

| Module | Key Endpoints |
|--------|--------------|
| `routes/sessions.js` | `GET /`, `GET /:id`, `GET /:id/messages`, `POST /:id/message`, `POST /:id/skill`, `POST /:id/fork`, `POST /:id/name`, `POST /new`, `POST /:id/tool-approval`, `POST /:id/cancel`, `GET /:id/query-status`. Uses `router.param('sessionId')` middleware for input validation. **POST /new** races `awaitNewSession(cwd)` (watcher signal) against `runClaudeCancellable(...)` (full CLI run). Whichever wins picks the response: 202 `{ pendingSessionId }` on watcher ack (~500 ms, common case), 201 `{ ok, result, stderr }` on CLI-wins (rare error paths), 504 on 15-s deadline, 503 on CLI failure before ack. CLI failure after ack is logged warn-level and never re-hits the client. |
| `routes/tasks.js` | `GET /:sessionId`, task CRUD (async `fs/promises`) |
| `routes/skills.js` | `GET /`, skill listing |
| `routes/teams.js` | `GET /`, `POST /:name/inbox`, `PATCH /:name/inbox/:messageId` |
| `routes/workflows.js` | `GET /`, workflow listing |
| `routes/history.js` | `GET /`, `GET /stats` |
| `routes/stream.js` | `GET /stream` — SSE endpoint |
| `routes/fs.js` | `GET /api/fs/home`, `GET /api/fs/list?path=…` — host filesystem enumeration used by the sidebar folder picker. Returns `sep` so the client stays platform-agnostic. Absolute-only, NUL-reject, UNC-reject on Windows. Unrestricted directory listing is intentional for a local-only dashboard; documented inline. |
| `routes/managers.js` | `GET /api/managers` — manager/team/standalone session groupings surfaced by the Dispatch Manager. |

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

**SSE Event Types:** `session_update`, `new_session`, `task_update`, `team_update`, `intelligence_update`, `history_update`, `sdk_message`, `sdk_result`, `sdk_error`, `tool_approval_request`, `tool_approval_resolved`

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

---

## localStorage Schema

| Key | Shape | Purpose |
|-----|-------|---------|
| `oversight.notifications` | `{ enabled: bool, sound: bool }` | Desktop notification + global mute toggle |
| `oversight.sound` | `{ masterVolume, events: {…}, ttsVoice, customSounds: {…} }` | Full sound engine config (2MB aggregate cap on customSounds) |
| `oversight.shortcuts` | `{ action: keyString, … }` | 14 rebindable keyboard shortcuts |

---

## Testing

**1,108 total tests** — 670 server (44 files) + 438 client (39 files). All must pass before pushing.

| Suite | Runner | Count | Location |
|-------|--------|-------|----------|
| Server parsers | Vitest | ~170 | `server/tests/parsers/` |
| Server routes | Vitest | ~200 | `server/tests/routes/` (incl. sessions, fs, stream, health, tasks, teams, workflows, skills, managers, plans, history) |
| Server intelligence | Vitest | ~37 | `server/tests/intelligence/` (cache, analyzer, triggers) |
| Server infrastructure | Vitest | ~22 | `server/tests/` (sse, watcher) |
| Server PTY | Vitest | 59 | `server/tests/pty-session.test.js` |
| Server middleware | Vitest | ~27 | `server/tests/middleware/` (security, requestLogger, performance, errorHandler) |
| Server lib | Vitest | ~36 | `server/tests/lib/` (config, apiError, lifecycle, logger, claude-bin) |
| Server utils | Vitest | ~60 | `server/tests/utils/` (cost, costEnhanced, export, commandClassifier, secretScanner) |
| Client hooks | Vitest + RTL | ~100 | `client/src/tests/hooks/` |
| Client audio | Vitest | 25 | `client/src/tests/audio/` |
| Client components | Vitest + RTL | ~300 | `client/src/tests/components/` (incl. NewSessionForm, FolderPicker, DispatchSignal) |
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
│   ├── parsers/                  # 13+ parser modules (sessions, messages, tasks, teams, skills, workflows, history, managers, plans, mcp, hooks, config, memory)
│   ├── routes/                   # 11+ route modules (sessions, fs, tasks, skills, teams, workflows, history, managers, plans, stream, health)
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
