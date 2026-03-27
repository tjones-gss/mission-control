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
| `server/index.js` | Express app setup, mounts all route modules, starts watcher |
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
| `routes/sessions.js` | `GET /`, `GET /:id`, `GET /:id/messages`, `POST /:id/message`, `POST /:id/skill`, `POST /:id/fork`, `POST /:id/name`, `POST /new`, `POST /:id/tool-approval`, `POST /:id/cancel`, `GET /:id/query-status`. Uses `router.param('sessionId')` middleware for input validation. |
| `routes/tasks.js` | `GET /:sessionId`, task CRUD (async `fs/promises`) |
| `routes/skills.js` | `GET /`, skill listing |
| `routes/teams.js` | `GET /`, `POST /:name/inbox`, `PATCH /:name/inbox/:messageId` |
| `routes/workflows.js` | `GET /`, workflow listing |
| `routes/history.js` | `GET /`, `GET /stats` |
| `routes/stream.js` | `GET /stream` — SSE endpoint |

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
| `claude-cli.js` | Spawns `claude` CLI as subprocess for message replies, skill invocation, new sessions, and intel analysis. Concurrent writes to the same session are blocked (409 Conflict). |

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
| `TeamsPanel.jsx` | Team configs and inboxes |
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

**~489 total tests** (255 server + 234 client) — all must pass before pushing.

| Suite | Runner | Count | Location |
|-------|--------|-------|----------|
| Server parsers | Vitest | ~99 | `server/tests/parsers/` (7 files) |
| Server routes | Vitest | ~84 | `server/tests/routes/` (6 files) |
| Server intelligence | Vitest | 8 | `server/tests/intelligence/` |
| Server PTY | Vitest | 59 | `server/tests/` |
| Client hooks | Vitest + RTL | ~100 | `client/src/tests/hooks/` |
| Client audio | Vitest | 25 | `client/src/tests/audio/` |
| Client components | Vitest + RTL | ~109 | `client/src/tests/components/` |
| E2E | Playwright | — | `e2e/` (not yet populated) |

**Test infrastructure:**
- MSW (Mock Service Worker) for API mocking in client tests
- `MockEventSource` in `client/src/tests/setup.js` for SSE testing
- `MockAudioContext` in useSound tests (with `close()` method)

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
│   │   │   ├── Markdown.jsx
│   │   │   ├── ToolApprovalBanner.jsx
│   │   │   ├── IntelView.jsx
│   │   │   ├── KanbanBoard.jsx
│   │   │   ├── LegendModal.jsx
│   │   │   ├── LiveFeed.jsx
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
│   │   │   ├── components/      # 5 component test files
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
│   ├── parsers/                  # 7 parser modules
│   ├── routes/                   # 7 route modules
│   ├── utils/
│   │   └── validate.js           # Shared input validation helpers
│   ├── tests/
│   │   ├── parsers/              # 7 parser test files
│   │   ├── routes/               # 6 route test files
│   │   └── intelligence/         # Cache tests
│   ├── claude-cli.js
│   ├── pty-session.js
│   ├── index.js
│   ├── sse.js
│   ├── watcher.js
│   └── package.json
├── docs/
│   ├── ARCHITECTURE.md           # ← this file
│   ├── screenshots/              # 5 PNG screenshots
│   └── superpowers/
│       ├── plans/                # Implementation plans
│       └── specs/                # Design specifications
├── README.md
└── package.json                  # Root scripts (dev, test, test:e2e)
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
