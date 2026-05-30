# Teams Tab & History Tab — Design Spec

**Date:** 2026-03-12
**Project:** Oversight (behind-the-agent-curtain)
**Status:** Approved

---

## Overview

Add two missing top-level tabs to the Oversight dashboard:

1. **Teams Tab** — display team configs and live inbox feeds with lightweight interaction (mark read, archive, compose)
2. **History Tab** — chronological command history feed with stats summary, search, filter, and grouping

Both tabs follow the existing panel pattern established by `WorkflowsPanel` and `SkillsPanel`.

---

## 1. Teams Tab

### Existing Code

`client/src/components/TeamsPanel.jsx` exists today as a flat, read-only file with no inbox interaction. **This file is replaced in full** by the new directory-based component structure described below. The old file is deleted.

### Layout

The existing sessions sidebar (224px) remains visible — the Teams tab produces a three-panel layout consistent with the Workflows and Skills tabs:

```
[ Sessions Sidebar ] [ Team List ] [ Team Detail / Inbox ]
```

- **Team List (left panel):** Team name, member count, unread badge
- **Team Detail (right panel):** Config card at top, inbox feed below

### Team Config Card

Read-only display showing:
- Team name and description
- Member list (agent names)
- Skills assigned to the team

### Inbox Feed

- Messages listed chronologically, **newest at bottom**
- Auto-scroll with pause-on-scroll-up (same pattern as conversation view)
- Each message shows: sender, timestamp, content
- Unread messages highlighted with a subtle background accent
- Real-time updates via existing SSE `team_update` event — no new SSE wiring needed
- When the user sends a composed message the list auto-scrolls to the bottom

### Interactions

| Action | Behavior |
|--------|----------|
| Mark as read | Clears unread highlight; persists `read: true` to inbox JSON file |
| Archive | Sets `archived: true` on message; moves to collapsible "Archived" section below active messages |
| Compose | Text input pinned to bottom of inbox; send writes new message via `POST /api/teams/:name/inbox` |

### Inbox Message Schema

All inbox messages (existing and new) conform to this shape:

```json
{
  "id": "uuid-v4-string",
  "sender": "string (agent name or 'user')",
  "content": "string",
  "timestamp": "ISO 8601 string",
  "read": false,
  "archived": false
}
```

**Compose target:** A composed message is written to `~/.claude/teams/{name}/inboxes/dashboard.json` (a dedicated file for dashboard-originated messages, separate from per-agent inbox files).

**Mark read / Archive:** The `PATCH` route updates the matching message object in whichever inbox file it lives in by scanning all files in `~/.claude/teams/{name}/inboxes/` for the given `messageId`. This is a sequential single-writer scan — no locking mechanism is needed. Concurrent writes from agents are accepted as a known constraint appropriate for a local single-user dashboard.

**File creation:** If `dashboard.json` does not exist when a message is composed, the `POST` route creates it with an initial `[]` array before appending the new message.

### New Server Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/teams/:name/inbox` | Write a new message to `dashboard.json` inbox |
| `PATCH` | `/api/teams/:name/inbox/:messageId` | Update `read` or `archived` on a message |

The Teams UI fetches all teams from the existing `GET /api/teams` route and selects the detail view client-side — **no `GET /api/teams/:name` route is needed**.

### Empty State

When no teams are configured: centered icon + "No teams configured. Teams are set up via Claude Code's team configuration."

---

## 2. History Tab

### Layout

Single full-width panel (no secondary sidebar — history is not session-specific). The sessions sidebar remains visible (consistent with all other tabs).

### Stats Bar

Row of summary cards at the top (computed from full history file, not truncated):
- Total commands (all time)
- Most-used command
- Most active project
- Commands today
- 7-day activity sparkline (bar chart, one bar per day)

### Feed

History entries have this shape (from `~/.claude/history.jsonl`):
```json
{
  "display": "the command or prompt text",
  "timestamp": 1769145662143,
  "project": "C:\\Users\\Travis\\Desktop\\Projects\\my-project",
  "sessionId": "uuid-string",
  "pastedContents": {}
}
```
The `project` field is the full path string used for filtering and grouping. The `display` field is the command text shown in the feed.

Feed:
- Chronological list, **newest first**
- Each row: timestamp, `display` text (truncated), basename of `project` path
- Click row to expand full text
- Feed uses **pagination**: fetches 100 entries at a time (`?offset=N`), appends to a growing local array on scroll-to-bottom
- Virtualized list renders only visible rows over the full local array (e.g., `react-virtual` or `react-window`) — filters and grouping operate over the in-memory array, not the server

### Controls

| Control | Behavior |
|---------|----------|
| Search | Real-time filter as you type (client-side on fetched page) |
| Project filter | Dropdown — all projects or a specific one; changes fetch params |
| Date range | Today / Last 7 days / Last 30 days / All time; changes fetch params |
| Grouping toggle | Switch between flat chronological and grouped-by-project views |

**Grouped view:** Project headers with command count, expandable to show entries.

**Filter + stats independence:** The stats bar always shows full-history aggregate stats regardless of active filters. The feed reflects filtered results.

### New Server Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/history` | Existing route — add `?offset`, `?project`, `?from`, `?to` query params for pagination and filtering |
| `GET` | `/api/history/stats` | Full-file aggregate stats (requires new `getHistoryStats()` parser function — does **not** use the `limit`-based `getHistory()`) |

### Empty State

When history file is empty or missing: centered icon + "No command history found."

---

## 3. Architecture

### Client Components

```
client/src/components/
  TeamsPanel/                     # replaces old flat TeamsPanel.jsx
    TeamsPanel.jsx
    TeamInboxFeed.jsx
    TeamComposeInput.jsx
  HistoryTab/
    HistoryTab.jsx
    HistoryStatsBar.jsx
    HistoryFeed.jsx
```

### App.jsx Changes

Add two new state counters and SSE handlers following the existing pattern:

```js
// New state
const [teamsVersion, setTeamsVersion] = useState(0);
const [historyVersion, setHistoryVersion] = useState(0);

// In SSE callback (add alongside existing handlers)
if (evt.type === 'team_update')    setTeamsVersion(v => v + 1);
if (evt.type === 'history_update') setHistoryVersion(v => v + 1);
```

Add a `useApi` call for teams:

```js
const { data: teams } = useApi('/api/teams', [teamsVersion]);
```

`HistoryTab` manages its own paginated fetching internally — **do not** add a `useApi('/api/history')` call in App.jsx. Only `historyVersion` is passed as a prop so the tab knows when to refetch.

Add two new entries to the `TABS` array and render the new components in the tab switch:

```jsx
{activeTab === 'teams'   && <TeamsPanel teams={teams} />}
{activeTab === 'history' && <HistoryTab historyVersion={historyVersion} />}
```

### Server Routes

```
server/routes/
  teams.js      # Add POST /inbox and PATCH /inbox/:messageId
  history.js    # Add GET /stats; extend GET / with offset, project, from, to params
server/parsers/
  history.js    # Add getHistoryStats() — reads full file without limit
```

---

## 4. Error Handling

- SSE disconnection: existing "reconnecting..." indicator handles this
- Compose failure: inline error below input, draft preserved
- Missing/malformed inbox JSON: treat as empty inbox, log warning server-side
- Missing history file: show empty state, no crash
- Stats on empty history: all counts show 0, sparkline shows empty bars

---

## 5. Testing

### Server Unit Tests

- `server/tests/routes/teams.test.js` — POST inbox (valid, missing team, malformed body), PATCH inbox/:messageId (mark read, archive, message not found)
- `server/tests/routes/history.test.js` — GET /stats (counts, top commands, daily breakdown, empty file); GET / with offset/filter params

### Client Unit Tests

- `client/src/tests/TeamsPanel.test.jsx` — renders team list, inbox feed, mark-read, archive, compose submit, empty state
- `client/src/tests/HistoryTab.test.jsx` — stats bar renders, search filter, project filter, grouping toggle, date range; pagination uses a "Load more" button fallback (scroll-based IntersectionObserver is not reliably testable in jsdom)

### E2E Tests (Playwright)

- `e2e/teams.spec.js` — select team, read inbox, compose message, mark as read, archive
- `e2e/history.spec.js` — search, filter by project, toggle grouping, date range filter, scroll-to-load-more pagination

---

## 6. Out of Scope

- Team CRUD (create/edit/delete teams) — display + inbox interaction only
- Inbox threading / reply chains
- Message notifications / desktop alerts
- History export
- TypeScript migration (separate workstream)
