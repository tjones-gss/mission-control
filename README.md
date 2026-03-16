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

## Notifications & Sound

Oversight detects when a Claude Code session is waiting for human input — either Claude finished speaking (`end_turn`) or a tool call is pending approval. When this happens:

- **Amber pulse indicator** appears on the session card in both the sidebar and Kanban board
- **Header badge** shows the count of sessions waiting (e.g., "2 waiting")
- **Desktop notifications** fire via the browser Notification API when a session transitions to "waiting"
- **Event-specific sounds** play synthesized audio via the Web Audio API — different sounds for different event types

Click the bell icon in the header to enable desktop notifications. Open **Settings** (gear icon or `,` key) to configure notifications, sounds, and keyboard shortcuts. You can dismiss individual waiting indicators by clicking the X on the session card — they'll re-notify if the session comes back to a waiting state later.

Sessions older than 4 hours are considered abandoned and won't trigger notifications.

### Sound presets

8 built-in synthesized sounds, no external files required:

| Preset | Description |
|--------|-------------|
| `chime` | Two ascending tones (C5 → E5) — default for "needs input" |
| `ping` | Single 800Hz tone, 200ms fade |
| `alert` | Three rapid square-wave pulses |
| `gentle` | Soft 440Hz sine, slow fade |
| `urgent` | Alternating sawtooth tones, 3 cycles |
| `success` | Major triad arpeggio (C5 → E5 → G5) |
| `fail` | Minor second descend (E4 → Eb4) |
| `none` | No sound |

Each event type can be mapped to any preset (or a custom uploaded sound) via Settings → Sounds & Voice.

### Text-to-speech

Enable per-event TTS voice announcements in Settings → Sounds & Voice. When enabled, events like "needs input" or "session complete" are spoken aloud using the browser's `speechSynthesis` API. Choose from any system voice. New announcements automatically cancel any in-progress speech to prevent pile-up.

### Custom sounds

Upload your own `.mp3` or `.wav` files (up to 500KB each, 2MB total) via Settings → Sounds & Voice. Assign them to any event type. Sound names are restricted to alphanumeric characters, hyphens, and underscores.

---

## Keyboard Shortcuts

Navigate the dashboard without touching the mouse. All shortcuts are rebindable in Settings → Shortcuts.

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate sessions (next / previous) |
| `Enter` | Open detail view for selected session |
| `Escape` | Back to board view (or close modals) |
| `1` - `4` | Switch tabs (Agents, Tasks, Workflows, Skills) |
| `y` | Approve — send "yes" to waiting session |
| `c` | Continue — send "continue" to waiting session |
| `/` | Focus message input |
| `m` | Mute selected session's notifications |
| `,` | Open settings |
| `?` | Toggle keyboard shortcut overlay |

Shortcuts are disabled when focus is in a text input (except `Escape`). Modifier combos like `Ctrl+k` are supported for custom bindings.

A floating `?` badge in the bottom-right corner opens a quick reference overlay.

---

## Interaction

Oversight isn't just a viewer — you can talk back to your agents directly from the browser.

### Sending messages

The **Conversation** tab has a message input bar at the bottom. Type a message and hit Send (or press Enter) to send it to the active session via `claude --resume`. The response appears in the conversation automatically via the existing SSE pipeline.

### Quick actions

Sessions waiting for input show one-click **quick-action buttons** ("yes", "continue", "approve") on both the sidebar cards and the Kanban board. These send the corresponding text as a message — no typing needed for common responses.

A **"reply"** button opens the session detail view with the conversation input focused.

### Skills

The sub-tab bar in the detail view includes a **skill picker** dropdown. Select a skill (e.g., `/commit`, `/review-pr`) and click Run to invoke it on the current session.

### New sessions

Click the **+** button in the Sessions sidebar header to spawn a new Claude Code session. Provide a working directory and a prompt, and Oversight will start a fresh `claude -p` subprocess.

### Architecture

All interaction goes through the `claude` CLI as a subprocess (`server/claude-cli.js`). This reuses Claude Code's own session persistence — no custom protocol, no API keys, no Agent SDK dependency. The subprocess writes to the JSONL file, chokidar sees the change, and SSE pushes the update to all browser tabs.

Concurrent writes to the same session are blocked (409 Conflict) to prevent race conditions.

---

## How it works

```
~/.claude/ ──► chokidar ──► SSE ──► React
                        ╲
                         ╲──► claude CLI (Intel tab)
```

The server watches `~/.claude/` with chokidar. When files change, it parses the relevant JSONL or JSON, then pushes a Server-Sent Events message to all connected browser tabs. React rerenders.

For **interaction** (sending messages, invoking skills), Oversight spawns `claude --resume <sessionId> -p "message"` as a subprocess. The CLI appends to the session's JSONL file, and the existing watcher picks up the changes — no custom write path needed.

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
