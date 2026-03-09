# Oversight

> A real-time dashboard for watching Claude Code agents work — conversations, tool calls, thinking blocks, timelines, and AI-powered session analysis, all live in your browser.

If you've ever spawned a long-running Claude Code session and wondered "what is it actually doing right now?", this is for you.

---

## The Conversation View

Every message, thinking block, and tool call — rendered as it happens. You can see the agent's internal reasoning, what tools it reached for, what came back, and where it is in the thread right now.

![Conversation view](docs/screenshots/conversation.png)

The sidebar shows all your sessions sorted by recency. Active sessions (modified in the last 5 minutes) glow green. Token counts and model are shown per session so you can keep an eye on context usage at a glance.

---

## Timeline

A flat, chronological event list with the time delta between each event. Useful for spotting where a session stalled, where it sped up, and exactly when a tool call fired.

![Timeline view](docs/screenshots/timeline.png)

Each row shows the event type (THINK, TEXT, BASH, READ, etc.), a snippet of the content, and the gap since the previous event. Great for post-mortems.

---

## Summary

High-level session metadata at a glance: session slug, git branch, last thought, last action, and a breakdown of every tool used with call counts.

![Summary view](docs/screenshots/summary.png)

---

## Intel

The Intel tab runs the session context through the `claude` CLI and returns a structured analysis: what the session is trying to accomplish, where it is in that goal, any flags worth attention, and a recommendation. Results are cached for 5 minutes and refresh automatically when the session changes significantly.

![Intel view](docs/screenshots/intel.png)

Requires `claude` in your PATH. Silently skips if it's not available.

---

## Teams

If you use Claude Code teams, Oversight shows your team task boards alongside the session list. See what's in-flight, what's completed, and which agent is on what.

![Teams view](docs/screenshots/teams.png)

---

## How it works

```
~/.claude/ ──► chokidar ──► SSE ──► React
                        ╲
                         ╲──► claude CLI (Intel tab)
```

The server watches `~/.claude/` with chokidar. When files change, it parses the relevant JSONL or JSON, then pushes a Server-Sent Events message to all connected browser tabs. React rerenders. The whole pipeline is **read-only** — Oversight never writes to your Claude data.

### Data sources

| Path | What's there |
|------|-------------|
| `~/.claude/projects/*/*.jsonl` | Session threads (messages, tool calls, thinking) |
| `~/.claude/tasks/{sessionId}/*.json` | Task boards linked to a session |
| `~/.claude/teams/*/config.json` | Team configs and task queues |
| `~/.claude/history.jsonl` | Command history |

---

## Setup

**Prerequisites:** Node 22+, Claude Code CLI in PATH.

```bash
git clone https://github.com/CosmonautJones/oversight.git
cd oversight
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

```bash
npm run dev
```

Opens on http://localhost:5173. The API server runs on :3001.

---

## Quirks

- **Garbled project names in the sidebar** — cosmetic only. The path encoding turns `/` into `-` in the directory name, and the decoder gets it wrong in edge cases. The `cwd` field inside each session record is always correct.
- **Intel tab requires `claude` in PATH** — if it's not available, the tab just won't populate. No crash, no error shown to the user.
- **Intel analysis on very large sessions can time out** — the 30-second timeout on the `claude` CLI call will fire on sessions with thousands of messages. The server handles this gracefully (fixed in [afe0fc7](https://github.com/CosmonautJones/oversight/commit/afe0fc7)) and the tab will show the last cached result instead.
