# Oversight

> A real-time dashboard for watching Claude Code agents work — conversations, tool calls, thinking blocks, timelines, and AI-powered session analysis, all live in your browser.

If you've ever spawned a long-running Claude Code session and wondered "what is it actually doing right now?", this is for you.

---

## The Conversation View

Every message, thinking block, and tool call — rendered as it happens. You can see the agent's internal reasoning, what tools it reached for, what came back, and where it is in the thread right now.

![Conversation view](docs/screenshots/conversation.png)

The sidebar groups your sessions into **Active**, **Recent**, and **Older** sections. Active sessions glow green. Older sessions are collapsed by default to keep focus on what's happening now — click the section header to expand. Sessions waiting for human input pulse amber with a "Waiting" label. Token counts and model are shown per session so you can keep an eye on context usage at a glance.

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

## Notifications

Oversight detects when a Claude Code session is waiting for human input — either Claude finished speaking (`end_turn`) or a tool call is pending approval. When this happens:

- **Amber pulse indicator** appears on the session card in both the sidebar and Kanban board
- **Header badge** shows the count of sessions waiting (e.g., "2 waiting")
- **Desktop notifications** fire via the browser Notification API when a session transitions to "waiting"
- **Audio ping** plays a short tone (800Hz, 200ms) alongside the desktop notification

Click the bell icon in the header to enable desktop notifications. Open **Settings** (gear icon) to toggle notifications and sound on/off. You can dismiss individual waiting indicators by clicking the X on the session card — they'll re-notify if the session comes back to a waiting state later.

Sessions older than 4 hours are considered abandoned and won't trigger notifications.

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

### Testing

```bash
npm test              # Run all server + client tests
npm run test:server   # Server tests only (Vitest)
npm run test:client   # Client tests only (Vitest + React Testing Library)
npm run test:e2e      # End-to-end tests (Playwright)
```

---

## Quirks

- **Garbled project names in the sidebar** — cosmetic only. The path encoding turns `/` into `-` in the directory name, and the decoder gets it wrong in edge cases. The `cwd` field inside each session record is always correct.
- **Intel tab requires `claude` in PATH** — if it's not available, the tab just won't populate. No crash, no error shown to the user.
- **Intel analysis on very large sessions can time out** — the 30-second timeout on the `claude` CLI call will fire on sessions with thousands of messages. The server handles this gracefully (fixed in [afe0fc7](https://github.com/CosmonautJones/oversight/commit/afe0fc7)) and the tab will show the last cached result instead.
