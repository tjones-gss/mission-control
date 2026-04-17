# Oversight

> A real-time dashboard for watching Claude Code agents work — conversations, tool calls, thinking blocks, task boards, team inboxes, and more, all live in your browser.

If you've ever spawned a long-running Claude Code session and wondered "what is it actually doing right now?", this is for you.

---

## Board View

The default view groups sessions into **Active**, **Idle**, and **Done** columns. Each card shows the session name, last message snippet, agent count, token usage, and model. Active sessions glow green; sessions waiting for human input pulse amber with quick-action buttons (yes, continue, approve) right on the card.

![Board view](docs/screenshots/kanban.png)

The sidebar lists all sessions grouped by **Active**, **Recent**, and **Older**. Click any session to open the detail view. The header shows live connection status and a count of sessions needing attention.

---

## Conversation View

Click into a session to see every message, thinking block, and tool call rendered as it happens. The agent's internal reasoning, tool inputs/outputs, and current position in the thread are all visible.

![Conversation view](docs/screenshots/conversation.png)

The message input at the bottom lets you send messages directly to the session. Attach images via the paperclip button, drag-and-drop, or Ctrl+V paste (PNG, JPEG, GIF, WebP, max 5MB). A thumbnail preview appears before sending.

A **skill picker** dropdown lets you invoke any user or plugin skill (e.g., `/commit`, `/review-pr`) on the current session.

The **session control bar** at the top shows:
- Session name (click the pencil icon to rename)
- Model badge and token count
- Permission mode, model, and effort dropdowns (applied to subsequent messages)
- Fork button to branch the conversation with a custom prompt

---

## Timeline

A flat, chronological event list with the time delta between each event. Useful for spotting where a session stalled, where it sped up, and exactly when a tool call fired.

![Timeline view](docs/screenshots/timeline.png)

Each row shows the event type (THINK, TEXT, BASH, READ, etc.), a snippet of the content, and the gap since the previous event.

---

## Summary

High-level session metadata: session slug, git branch, last thought, last action, and a breakdown of every tool used with call counts.

![Summary view](docs/screenshots/summary.png)

---

## Intel

Runs the session context through the `claude` CLI and returns a structured analysis: what the session is trying to accomplish, where it is in that goal, any flags worth attention, and a recommendation. Results are cached for 5 minutes and refresh automatically when the session changes significantly.

![Intel view](docs/screenshots/intel.png)

Requires `claude` in your PATH. Silently skips if not available.

---

## Tasks

Each session can have a task board. Create, edit, update status, assign owners, and manage dependencies (blocks/blockedBy). Tasks are stored as JSON files in `~/.claude/tasks/{sessionId}/`.

![Tasks view](docs/screenshots/tasks.png)

---

## Workflows

Build reusable multi-step playbooks. Each workflow is a named sequence of steps:

- **Instruction** — plain text for Claude to follow
- **Command** — a shell command to run
- **Agent** — spawn a subagent (general-purpose, Explore, Plan, etc.) with a custom prompt
- **Skill** — invoke any user or plugin skill

Create, reorder, edit, and delete steps with the visual editor. Click **Export as Skill** to turn a workflow into a reusable Claude Code skill file (saved to `~/.claude/skills/`).

![Workflows view](docs/screenshots/workflows.png)

---

## Skills Browser

Browse, search, create, edit, and delete skills. Skills are grouped by source: user skills (editable) and plugin skills (read-only). Each skill shows its description, command, and full content (expandable). Filter by plugin name or search across all skills.

![Skills view](docs/screenshots/skills.png)

---

## Teams

See your Claude Code team task boards and inboxes. View what's in-flight, what's completed, and which agent is on what. Team inboxes support message threading with read/archived status.

![Teams view](docs/screenshots/teams.png)

---

## History

Browse your Claude Code command history with search, project filtering, and grouped/list view toggle. Stats show total commands, projects, and timespan at a glance.

![History view](docs/screenshots/history.png)

---

## New Sessions

Click the **+** button in the sidebar to spawn a new Claude Code session. Fill in a working directory, prompt, and optionally: session name, model (sonnet/opus/haiku), permission mode, effort level, and worktree isolation.

![New session form](docs/screenshots/new-session.png)

New sessions are created via a one-shot CLI subprocess (`claude -p ... --output-format json`). Interactive messaging after creation runs through a PTY on your Claude subscription — no API credits consumed.

> The `effort` dropdown is forwarded only to SDK-backed paths (tool approvals, skill runs). It is not a valid flag for the one-shot CLI used by new-session creation and is silently dropped there.

---

## Settings

Open with the gear icon or `,` key. Three tabs: Notifications, Sounds & Voice, and Shortcuts.

![Settings](docs/screenshots/settings.png)

### Notifications & Sound

Oversight detects when a session is waiting for human input — either Claude finished speaking (`end_turn`) or a tool call is pending approval. When this happens:

- **Amber pulse** on the session card in both sidebar and board
- **Header badge** shows count of sessions waiting
- **Desktop notifications** via the browser Notification API
- **Event-specific sounds** via the Web Audio API

Sessions older than 4 hours are considered abandoned and won't trigger notifications.

**8 built-in synthesized sounds** (no external files):

| Preset | Description |
|--------|-------------|
| `chime` | Two ascending tones — default for "needs input" |
| `ping` | Single 800Hz tone, 200ms fade |
| `alert` | Three rapid square-wave pulses |
| `gentle` | Soft 440Hz sine, slow fade |
| `urgent` | Alternating sawtooth tones, 3 cycles |
| `success` | Major triad arpeggio |
| `fail` | Minor second descend |
| `none` | No sound |

**Text-to-speech:** Enable per-event TTS voice announcements. Choose from any system voice. New announcements cancel in-progress speech automatically.

**Custom sounds:** Upload `.mp3` or `.wav` files (up to 500KB each, 2MB total) and assign them to any event type.

### Keyboard Shortcuts

All shortcuts are rebindable in Settings. Support for modifier combos (`Ctrl+k`, `Shift+j`, etc.).

| Key | Action |
|-----|--------|
| `j` / `k` | Navigate sessions (next / previous) |
| `Enter` | Open detail view for selected session |
| `Escape` | Back to board view / close modals |
| `1` - `6` | Switch tabs (Agents, Tasks, Workflows, Skills, Teams, History) |
| `y` | Approve — send "yes" to waiting session |
| `c` | Continue — send "continue" to waiting session |
| `/` | Focus message input |
| `m` | Mute selected session's notifications |
| `,` | Open settings |
| `?` | Toggle shortcut overlay |

---

## Interactive Session Control (PTY)

When you send a message from the Conversation view, Oversight spawns a pseudo-terminal running `claude --resume <sessionId>` rather than making API calls. **Dashboard messaging uses your existing Claude subscription** — no API credits consumed.

**Tool approval workflow:**
1. Claude requests to use a tool (e.g., Bash, Write)
2. Oversight detects the approval prompt in the PTY output
3. An amber **Tool Approval Banner** appears in the conversation view
4. Click **Allow** or **Deny** — the response is typed into the PTY
5. Auto-denied after 120 seconds if no action taken

The PTY stays alive between messages for the same session. Concurrent writes to the same session are blocked (409 Conflict).

**Completion detection** uses dual mechanisms: PTY output silence (3s of no TUI redraws) and JSONL file silence (8s fallback), with a 10-minute safety timeout.

---

## Live Feed

The right sidebar shows a real-time stream of all SSE events: session updates, new sessions, task changes, team updates, and intelligence results. Useful for seeing cross-session activity at a glance.

---

## How It Works

```
                    ┌─────────────┐
~/.claude/ ──────►  │  chokidar   │──► SSE ──► React
                    │  (watcher)  │
                    └─────────────┘
                          │
┌─────────────────────────┼──────────────────────────┐
│                         │                          │
▼                         ▼                          ▼
PTY sessions          CLI subprocess           claude CLI
(pty-session.js)      (claude-cli.js)         (Intel tab)
- send messages       - new sessions
- tool approval       - fork sessions
- subscription auth   - worktree sessions
```

The server watches `~/.claude/` with chokidar. When files change, it parses the relevant JSONL or JSON, then pushes Server-Sent Events to all connected browser tabs.

For **interactive messaging**, Oversight spawns `claude --resume <sessionId>` in a PTY so it runs on your Claude subscription. For **one-shot operations** (new sessions, fork, worktree), it uses the CLI subprocess. Either way, the CLI writes to the session's JSONL file, chokidar picks up the change, and SSE pushes the update.

### Data Sources

| Path | What's there |
|------|-------------|
| `~/.claude/projects/*/*.jsonl` | Session threads (messages, tool calls, thinking) |
| `~/.claude/tasks/{sessionId}/*.json` | Task boards linked to sessions |
| `~/.claude/teams/*/config.json` | Team configs and task queues |
| `~/.claude/teams/*/inboxes/*.json` | Team inbox messages |
| `~/.claude/history.jsonl` | Command history |
| `~/.claude/skills/*.md` | User skill files |
| `server/data/workflows/*.json` | Workflow definitions |
| `server/data/session-names.json` | Custom session display names |

### SSE Event Types

`session_update`, `new_session`, `task_update`, `team_update`, `history_update`, `intelligence_update`, `sdk_message`, `sdk_result`, `sdk_error`, `tool_approval_request`, `tool_approval_resolved`

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
- **Intel tab requires `claude` in PATH** — if it's not available, the tab just won't populate.
- **Intel analysis on very large sessions can time out** — the 30-second timeout on the `claude` CLI call will fire on sessions with thousands of messages. The tab shows the last cached result instead.
