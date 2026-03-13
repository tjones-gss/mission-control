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

### Layout

Two-panel layout:
- **Left:** Team list (mirrors the session sidebar pattern) — team name, member count, unread badge
- **Right:** Team detail — config card at top, inbox feed below

### Team Config Card

Read-only display showing:
- Team name and description
- Member list (agent names)
- Skills assigned to the team

### Inbox Feed

- Messages listed chronologically, newest at bottom
- Auto-scroll with pause-on-scroll-up (same pattern as conversation view)
- Each message shows: sender, timestamp, content
- Unread messages highlighted with a subtle background accent
- Real-time updates via existing SSE `team_update` event — no new SSE wiring needed

### Interactions

| Action | Behavior |
|--------|----------|
| Mark as read | Clears unread highlight; persists to inbox JSON file |
| Archive | Removes from active view; moves to collapsible archived section |
| Compose | Text input pinned to bottom of inbox; send writes new message via POST |

### New Server Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `POST` | `/api/teams/:name/inbox` | Write a new message to team inbox |
| `PATCH` | `/api/teams/:name/inbox/:messageId` | Mark message as read or archived |

Existing `GET /api/teams` and implied `GET /api/teams/:name` remain unchanged.

### Empty State

When no teams are configured: centered icon + "No teams configured" message with a link to Claude Code docs on setting up teams.

---

## 2. History Tab

### Layout

Single full-width panel (no sidebar — history is not session-specific).

### Stats Bar

Row of summary cards at the top:
- Total commands (all time)
- Most-used command
- Most active project
- Commands today
- 7-day activity sparkline (bar chart)

### Feed

- Chronological list, newest first
- Each row: timestamp, command/prompt text (truncated), source project
- Click row to expand full text
- Virtualized list for performance on large history files

### Controls

| Control | Behavior |
|---------|----------|
| Search | Real-time filter as you type |
| Project filter | Dropdown — all projects or a specific one |
| Date range | Today / Last 7 days / Last 30 days / All time |
| Grouping toggle | Switch between flat chronological and grouped-by-project views |

**Grouped view:** Project headers with command count, expandable to show entries.

### New Server Routes

| Method | Route | Purpose |
|--------|-------|---------|
| `GET` | `/api/history` | Already exists — wire up to UI |
| `GET` | `/api/history/stats` | Aggregated stats: counts, top commands, daily activity breakdown |

### Empty State

When history file is empty or missing: centered icon + "No command history found."

---

## 3. Architecture

### Client Components

```
client/src/components/
  TeamsPanel/
    TeamsPanel.jsx          # Two-panel layout, team list + detail
    TeamInboxFeed.jsx       # Inbox message list with auto-scroll
    TeamComposeInput.jsx    # Pinned compose box
  HistoryTab/
    HistoryTab.jsx          # Full-width panel, stats + feed
    HistoryStatsBar.jsx     # Summary cards + sparkline
    HistoryFeed.jsx         # Virtualized feed with controls
```

### Server Routes

```
server/routes/
  teams.js      # Add POST /inbox and PATCH /inbox/:messageId
  history.js    # Add GET /stats endpoint
```

### Navigation

Add `Teams` and `History` to the tab bar in `client/src/App.jsx` alongside Agents, Tasks, Workflows, Skills.

---

## 4. Error Handling

- SSE disconnection: existing "reconnecting..." indicator handles this
- Compose failure: inline error below input, draft preserved
- Missing/malformed inbox JSON: treat as empty inbox, log warning server-side
- History file missing: show empty state, no crash

---

## 5. Testing

### Server Unit Tests

- `teams.test.js` — POST inbox, PATCH inbox/:messageId (valid, missing team, malformed body)
- `history.test.js` — GET /stats (counts, top commands, daily breakdown, empty file)

### Client Unit Tests

- `TeamsPanel.test.jsx` — renders team list, inbox feed, mark-read, archive, compose submit
- `HistoryTab.test.jsx` — stats bar renders, search filter, project filter, grouping toggle, date range

### E2E Tests (Playwright)

- `teams.spec.js` — select team, read inbox, compose message, mark as read, archive
- `history.spec.js` — search, filter by project, toggle grouping, date range filter

---

## 6. Out of Scope

- Team CRUD (create/edit/delete teams) — display + inbox interaction only
- Inbox threading / reply chains
- Message notifications / desktop alerts
- History export
- TypeScript migration (separate workstream)
