# Feature Briefs — Design Spec

**Date:** 2026-06-05
**Status:** Approved (design); pending implementation plan

## Context

Mission Control exposes many distinct surfaces (Agents, Tasks, Runs with two modes,
Fleet, History, Workflows, Skills, Teams). A new user — or the owner returning after
a gap — has no in-app explanation of *what each feature is* or *how to use it
correctly*. The only existing guidance is the Help (Legend) modal, which is global
and easy to miss, plus a single empty-state explainer on Fleet.

This adds a short, consistent **brief** at the top of each major surface: a one-line
summary of what it is, expandable to a few lines on how to use it, dismissable for
power users who don't need it.

## Decisions (confirmed with user)

- **Format:** a dismissible, expandable banner at the top of each surface.
- **Scope:** all 8 top-level tabs, plus a distinct brief for each Runs mode
  (Conductor, Mission Control) — ~10 briefs total. The nested Inspect viewer and
  per-session sub-tabs are **out of scope** for this pass.
- **Identity:** keep the existing dark cockpit / monospace look. No new
  colors/fonts; the brief is slim and subdued.

## Architecture

One reusable component driven by a central registry — single source of truth for
copy, banner logic written once, tab files barely touched.

- **`src/components/FeatureBrief/briefs.js`** — the registry. Maps a `surfaceId`
  to `{ title, summary, body }`. All copy lives here.
- **`src/components/FeatureBrief/FeatureBrief.jsx`** — the banner component.
  Props: `surfaceId` (string). Looks up its copy in the registry; renders nothing
  if the id is unknown or has no entry (defensive).
- **`App.jsx`** — renders `<FeatureBrief surfaceId={activeTab} />` as the first
  child inside `<main>`, for every tab **except** `runs`.
- **`RunsTab.jsx`** — renders `<FeatureBrief surfaceId={mode === 'conductor'
  ? 'runs.conductor' : 'runs.missions'} />` directly under its mode-switch bar, so
  the brief is specific to the selected mode.

### Component states

1. **Default (not dismissed):** slim bar — `ⓘ` icon + one-line `summary` +
   `▾` expand button + `✕` dismiss button.
2. **Expanded:** same bar plus the multi-line `body` below; `▴` collapses back to
   the summary. Expansion is ephemeral (not persisted).
3. **Dismissed:** the full bar is replaced — in the same insertion slot — by a
   thin, right-aligned row containing only the `ⓘ` re-opener button (no floating
   overlay). Clicking it restores state 1. The component always occupies the same
   slot; only its height/content changes between states.

### Persistence

Only the **dismissed** flag is remembered, per surface:

- Key: `mc.brief.<surfaceId>.dismissed` → `'true'` when dismissed.
- Read/write wrapped in `try/catch`, mirroring the existing `mc.showAdvanced`
  pattern in `App.jsx` (so private-mode / test environments degrade gracefully).

### Styling

Slim and in-aesthetic: `border-b border-gray-800 bg-gray-900/40`, body text
`text-gray-400 text-xs`, summary `text-gray-300`, indigo `ⓘ`. Icons from
`lucide-react` (`Info`, `ChevronDown`/`ChevronUp`, `X`). The re-opener is a
borderless `text-gray-600 hover:text-gray-300` icon button.

### Accessibility

- Expand button: `aria-expanded`, `aria-controls` pointing at the body region.
- Dismiss and re-opener buttons: `aria-label` ("Dismiss brief" / "Show brief").
- The banner is informational (no role="dialog"); it does not trap focus.

## Brief copy (all surfaces)

Voice: terse, factual, sourced from `CLAUDE.md`. Each `body` ends with a **Use it:**
sentence.

| surfaceId | title | summary |
|---|---|---|
| `agents` | Agents | Live view of every Claude Code session you're running. |
| `tasks` | Tasks | The selected session's task list (todos), live. |
| `runs.conductor` | Runs · Conductor | Drive one accepted ADR end-to-end through 5 phases. |
| `runs.missions` | Runs · Mission Control | Run harness-governed missions on-rails. |
| `fleet` | Fleet | Fan one goal across N child agents, each in its own git worktree. |
| `history` | History | A searchable audit feed of past commands and sessions across projects. |
| `workflows` | Workflows | Compose multi-step skill/agent pipelines — and run them. |
| `skills` | Skills | Browse the skills installed on this machine (yours + plugins). |
| `teams` | Teams | Team inboxes and configs for multi-agent collaboration. |

**Bodies:**

- **agents** — The board groups sessions by Active / Idle / Done. Open one for its
  conversation, timeline, summary, Intel analysis, plans, and the Inspect viewer.
  **Use it:** pick a session on the left, or click a board card, to drill into detail.
- **tasks** — Mirrors the agent's own task board for the selected session so you can
  see what it's planning and where it is. **Use it:** select a session on the left;
  the board updates live as the agent works.
- **runs.conductor** — A pure orchestrator that delegates all implementation to
  subagents, running one ADR through bootstrap → plan → build → integration → ship.
  **Use it:** Start a run here, or run `/conductor <NNNN>` in any project with the
  harness installed.
- **runs.missions** — Harness-governed missions that graduate draft → ready → build.
  The cockpit never edits `mission-index.yml` directly — the harness CLI owns that.
  **Use it:** compile a roadmap into draft missions, mark one ready, then execute.
- **fleet** — Each child runs under harness rails and escalates on danger; results
  are synthesized at the end (Fleet → child session + harness → subagents). **Use
  it:** New Fleet Run → set a goal → add one row per child (path + prompt or
  workflow) → optional budget/verify → Launch.
- **history** — Stats up top (totals, today, top command/project, 7-day trend), then
  a filterable, infinite-scrolling log. **Use it:** search or filter by project to
  find what ran when.
- **workflows** — Each workflow is an ordered list of steps (skill, agent,
  instruction, or shell command). **Use it:** New → add steps → Run to spawn a Claude
  session that executes them (or export to a skill).
- **skills** — Search and filter the catalog of skills Claude Code can invoke.
  **Use it:** search by name; click a skill to see its description and source.
- **teams** — Teams are defined in Claude Code's team configuration. **Use it:**
  select a team to see its members and inbox feed, and post a message to the team.

## Testing

- **`FeatureBrief.test.jsx`** (vitest + @testing-library, matching `src/tests/`
  conventions):
  - renders the summary for a known `surfaceId`;
  - expand button toggles the body and flips `aria-expanded`;
  - dismiss hides the bar, shows the re-opener, and persists
    `mc.brief.<id>.dismissed=true` to `localStorage`;
  - on mount with the dismissed flag set, starts dismissed (re-opener only);
  - re-opener restores the bar and clears the flag;
  - unknown / empty `surfaceId` renders nothing.
- **Registry test:** every `surfaceId` in the registry has a non-empty `title`,
  `summary`, and `body`; the set of ids matches the agreed surfaces.

## Files

- `+ src/components/FeatureBrief/briefs.js`
- `+ src/components/FeatureBrief/FeatureBrief.jsx`
- `+ src/tests/components/FeatureBrief.test.jsx`
- `~ src/App.jsx` (render `<FeatureBrief>` at top of `<main>` for non-runs tabs)
- `~ src/components/RunsTab/RunsTab.jsx` (render mode-specific `<FeatureBrief>`)

## Out of scope

- Inspect panel (Config/Hooks/MCP/Memory) and per-session sub-tab briefs.
- Any change to fonts, colors, or layout beyond inserting the banner.
- Server changes — this is client-only, static copy.

## Verification

- `npm --prefix apps/cockpit run test:client` green (incl. new tests).
- `npm --prefix apps/cockpit run lint` clean.
- Manual: open each tab + both Runs modes; confirm the brief shows, expands,
  dismisses (and stays dismissed across reload), and re-opens. Confirm no overlap
  with existing tab headers.
