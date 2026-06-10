# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mission Control is a live cockpit for Claude Code agents — see and steer every running session in one place. It has two independent halves — know which one you're touching:

- **`apps/cockpit`** — "the window." Node.js + React app (Express + Vite). Reads Claude Code's `~/.claude` directly. No harness required to run.
- **`packages/harness`** — "the rails." Python. Opt-in, per-project guardrail layer. The cockpit shells out to it; it does not import it.
- **`packages/contracts`** — shared JSON schemas. **Update these first** before changing any `harness status --json` field — both the harness emitter and cockpit consumer validate against this contract.

The cockpit server is at port `3001`, the Vite client at `5173`.

## Commands

### Setup and launch
```bash
npm run setup          # one-command installer (safe to re-run)
npm run up             # start server + client together (canonical dev command)
npm run up:docker      # docker-compose alternative
```

### Testing
```bash
npm run test:cockpit                    # all tests (server + client)
npm --prefix apps/cockpit test:server   # server unit tests (Vitest, node env)
npm --prefix apps/cockpit test:client   # client unit tests (Vitest, jsdom env)
npm --prefix apps/cockpit test:e2e      # Playwright e2e (requires both servers running)
npm --prefix apps/cockpit test:coverage # coverage report (must meet thresholds or CI fails)

# Run a single server test file
cd apps/cockpit/server && npx vitest run tests/routes/sessions.test.js

# Run a single client test file
cd apps/cockpit/client && npx vitest run src/tests/components/TriageView.test.jsx

# Watch mode
npm --prefix apps/cockpit test:server:watch
npm --prefix apps/cockpit test:client:watch
```

### Linting
```bash
npm run lint            # Prettier check (the only linter — no ESLint)
npm run lint:fix        # auto-fix formatting
```

### Install discipline
Root `npm install` covers only npm workspaces (`apps/cockpit`, `packages/contracts`). Server and client each have their own `package.json` and must be installed separately:
```bash
cd apps/cockpit/server && npm install
cd apps/cockpit/client && npm install
```
`npm run setup` does all three in the correct order. If tests break after a fresh clone, this is why.

## Architecture

### Server (`apps/cockpit/server/`)

**Entry point:** `index.js` exports `buildApp()` (factory — never binds a socket) and `start()` (the real entry). Tests import `buildApp()` to get a configured Express app without opening a port.

**Data flow:** The server never writes to `~/.claude`. It is read-only with two exceptions: spawning new Claude sessions via `claude-cli.js` and writing to `server/data/` (Fleet state, session names, audit log).

**Key modules:**
- `watcher.js` — chokidar watch on `~/.claude`. Emits typed SSE events (`session_update`, `task_update`, `fleet_update`, etc.) to connected clients. Also watches per-project `.conductor/` and `.harness/` dirs discovered from session CWDs.
- `sse.js` — shared SSE client registry. Imported by both `watcher.js` and `intelligence/triggers.js`. Includes an `onEvent()` internal pub/sub used by `pty-session.js`.
- `parsers/` — one file per `~/.claude` data type (sessions, config, hooks, tasks, teams, history, workflows, skills, plans, memory, MCP, managers, conductor, harness). Each parser is stateless and synchronous; the SSE watcher calls routes which call parsers on demand.
- `claude-cli.js` — all Claude CLI spawning flows through here. `withStreamJsonVerbose()` enforces `--verbose` when `--output-format stream-json` is used (the CLI requires it). `buildSpawn()` resolves `.cmd`/`.ps1` → explicit interpreter on Windows to prevent shell injection.
- `pty-session.js` — PTY-based interactive sessions with live streaming. Used by the new-session form and the Dispatch drawer.
- `fleet/fleet-runner.js` — Fleet meta-orchestrator. Persists run state to `server/data/fleet/`. Hard ceiling: `MAX_FLEET_CHILDREN=4`, `HARD_REFUSE_CHILDREN=8`. Uses `atomicWriteJson` for all writes. `reconcileFleetRuns()` is called at server boot to reap wedged runs.
- `intelligence/` — async AI analysis of sessions (`analyzeSession` in `analyzer.js`, debounced trigger in `triggers.js`). `cache.js` is a thin facade over `lib/db/intelligence-store.js` — analyses + staleness snapshots persist across restarts.
- `lib/db/` — the ADR-0008 SQLite derived read-cache (`server/data/cockpit.db`, `node:sqlite` — imported ONLY in `connection.js`). PURE derived cache: deleting the file is always safe (schema-version mismatch or corruption → delete-and-rebuild; `dbUnavailable` falls back to direct parser reads). Modules: `session-index.js` (serves `GET /api/sessions`, event-driven watcher invalidation — no TTL), `message-index.js` (FTS5 corpus + search), `usage-index.js` (daily token rollups), `memory-index.js` (memory files into the corpus), `intelligence-store.js`. Requires Node **22.13+** (`engines` field). Fleet runs deliberately stay JSON-per-run (cockpit-authoritative state, not derived).
- `routes/search.js` + `routes/stats.js` — `GET /api/search` (FTS, snippets, type filter) and `GET /api/stats/usage` (rollups priced via `utils/cost.js`); both 503-with-hint when the db is unavailable.
- `lib/notify.js` — AFK gate notifier, env-gated (`OVERSIGHT_WEBHOOK_URL`, unset = no-op). Outbound-only POST on approval-pending events; **no inbound path**.
- `lib/audit-log.js` — append-only JSONL log. Validates against the contracts schema before writing. The cockpit is the **sole writer**. (The audit log stays JSONL — it is an evidence artifact, never a cache candidate.)
- `lib/otel.js` — OTel tracing, env-gated (`OTEL_ENABLED`). No-op by default.
- `lib/config.js` — all server config from env vars (`PORT`, `OVERSIGHT_HOST`, `OVERSIGHT_API_KEY`, `OTEL_ENABLED`, etc.).

**Security middleware stack** (order is load-bearing in `index.js`):
1. `hostCheck` — DNS-rebinding guard, runs first, no exemptions
2. CORS
3. `originGuard` — CSRF protection for state-changing methods
4. `securityMiddleware` (Helmet + rate limiter)
5. Routes

### Client (`apps/cockpit/client/src/`)

**Entry:** `App.jsx` owns all top-level state and the tab router. No React Router — tab state is `useState`.

**Tab structure (CORE, always visible):** Agents, Tasks, Runs, Fleet, History.  
**ADVANCED tabs (behind persisted toggle):** Workflows, Skills, Teams.

**History has three modes:** the activity feed, "Everything" (full-text search over `GET /api/search` with deep links to session detail), and usage/cost stats (`GET /api/stats/usage`). Per ADR-0007's freeze rule these are modes, never new tabs.

**`CommandPalette.jsx`** — ⌘/Ctrl+K from anywhere (via `useKeyboardShortcuts.js`); debounced `/api/search`, grouped sessions → message hits → knowledge docs with type-filter pills; Enter navigates to the session detail. `--mc-*` tokens only.

**Agents tab has three modes** — `agentView` state: `triage` (default), `board`, `detail`.
- `TriageView/` — the CORE hero view. Attention-ranked: needs-input → running → calm. Inline approve/steer via `QuickActions` (`POST /api/sessions/:id/message`). Do not demote this to a secondary view.
- `KanbanBoard.jsx` — Board mode.
- `AgentTree.jsx` — Detail mode with `InspectPanel` for `~/.claude` viewers.

**Theme system:** `index.css` defines `--mc-*` CSS variables (the token layer). `useTheme.js` applies a `data-theme` attribute on `<html>`. Themes: `classic` (default), `calm`, `tron`, `warm`. New components should use `--mc-*` vars, not hardcoded Tailwind colors.

**Real-time:** `useSSE.js` connects to `GET /api/stream`. The app uses version counters (`sessionsVersion`, `fleetVersion`, etc.) as `useApi` deps — incrementing the counter is how SSE events trigger a refetch.

**Key hooks:**
- `useApi.js` — data fetching with version-based invalidation
- `useSSE.js` — SSE connection, auto-reconnect
- `useStreamingSession.js` — SDK streaming for live message updates
- `useKeyboardShortcuts.js` — all keyboard shortcuts
- `useTheme.js` — theme persistence + application

### Contracts (`packages/contracts/`)

JSON schemas in `schemas/`. `index.js` exports schema objects and `SCHEMA_VERSION`. The `schema-version.json` is the single source of version truth — referenced by both JS and Python sides. CI validates parity.

## Critical invariants

- **Contracts first:** add/change a `harness status --json` field → update `packages/contracts/` before touching emitter or consumer.
- **No harness YAML parsing in the cockpit.** The cockpit shells out to `harness status --json`. Never duplicate harness parsing logic in Express routes.
- **`buildApp()` is import-safe** — it never binds a socket. `start()` is the entry point. Server tests import `buildApp()` directly.
- **Coverage thresholds are enforced in CI.** Server thresholds: lines 80%, functions 82%, branches 68%, statements 80%. Do not lower them.
- **Fleet caps are hard-coded safety ceilings.** `MAX_FLEET_CHILDREN=4` and `HARD_REFUSE_CHILDREN=8` in `fleet-runner.js`. Do not auto-approve — every human decision routes through existing write paths.
- **`apps/cockpit` is NOT restructured into npm workspaces.** The `server/` and `client/` subdirectories have their own `package.json` and are managed with `cd` scripts, not workspace hoisting.
- **`ConversationView.jsx` (~920 LOC) and `FleetTab.jsx` (~1049 LOC)** are flagged large — split before adding to them.
- **"Pipeline" is a mode inside Runs, never a sibling tab.** Do not add a top-level Pipeline tab; Conductor/Missions collapse into Runs.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Server port |
| `OVERSIGHT_HOST` | `127.0.0.1` | Bind address (set `0.0.0.0` for LAN) |
| `OVERSIGHT_API_KEY` | — | Optional API key guard |
| `OVERSIGHT_CORS_ORIGIN` | — | Explicit CORS origin |
| `OVERSIGHT_RATE_LIMIT` | `2000` | Req/15min; `0` disables (used in e2e) |
| `OTEL_ENABLED` | — | Enable OTel tracing |
| `OVERSIGHT_WEBHOOK_URL` | — | AFK gate notifier: POST approval-pending events to this webhook (notify-only, no inbound path; unset = no-op) |
| `OVERSIGHT_BUDGET_MAX` | `0` | Max USD budget (0 = unlimited) |
| `OVERSIGHT_FLEET_ACK_TIMEOUT_MS` | `15000` | Fleet session-ack timeout |

## ADRs

Accepted decisions that fix direction live in `docs/adr/`. Key ones:
- **ADR-0004** — localhost-first topology, no DB
- **ADR-0005** — moat & surface strategy; cross-vendor reach lives in rails, not the viewer
- **ADR-0006** — canonical orchestration model (harness pipeline = spine; Fleet = phase strategy; Workflow = degenerate single-phase pipeline)
- **ADR-0007** — CORE vs EXPERIMENTAL surface split; `SCOPE.md` is the manifest
