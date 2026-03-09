# Oversight

A real-time dashboard for watching Claude Code sessions as they happen.

## What it shows

- **Sessions** — active/inactive status, token counts, model, elapsed time
- **Conversation** — main thread + sidechains, thinking blocks, tool calls with inputs/outputs
- **Timeline** — flat event list with time deltas between events
- **Intel** — AI-powered session analysis: inferred goal, progress estimate, flags, recommendations
- **Tasks** — task boards linked to sessions
- **Teams** — team configs and inboxes
- **Skills** — skills browser
- **Live feed** — raw SSE event stream

## How it works

Chokidar watches `~/.claude/` for file changes → parses JSONL/JSON on the server → pushes SSE events to the browser → React rerenders. Entirely read-only; no writes to Claude's data. The Intel tab calls the local `claude` CLI with a structured prompt and caches results for 5 minutes.

## Data sources

| Path | Content |
|------|---------|
| `~/.claude/projects/*/*.jsonl` | Session threads |
| `~/.claude/tasks/{id}/*.json` | Task boards |
| `~/.claude/teams/*/` | Team configs + inboxes |
| `~/.claude/history.jsonl` | Command history |

## Architecture

```
~/.claude/ ──► chokidar ──► SSE ──► React
                        ╲
                         ╲──► claude CLI (Intel tab)
```

## Prerequisites

- Node 22+
- Claude Code CLI installed and available in `PATH` (required for Intel tab)

## Setup

```bash
git clone <repo-url>
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

## Running

```bash
npm run dev   # server :3001 + client :5173
```

Open http://localhost:5173

## Known quirks

- Project names in the sidebar may render as garbled paths — cosmetic only; the `cwd` field is the authoritative project path
- Intel tab is a no-op if `claude` CLI is not in `PATH`
