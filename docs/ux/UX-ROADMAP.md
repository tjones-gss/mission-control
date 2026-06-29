# Mission Control UX/UI Roadmap

> Read before writing. This roadmap was built from a direct read of the source, not assumptions.
> Files read: `App.jsx`, `TriageView/TriageView.jsx`, `QuickActions.jsx`, `SelectionBar.jsx`,
> `CommandPalette.jsx`, `FleetTab/FleetTab.jsx`, `index.css`, `SCOPE.md`.

Every item names the specific file it touches. "Improve the layout" is not a roadmap item.

---

## Current State Assessment

**What's working well:**

The `--mc-*` token layer in `index.css` is a genuine design asset — four themes (classic, calm, tron, warm) with a semantic cascade that, when honored, produces theme coherence without component-by-component edits. `TriageView.jsx` correctly implements the attention hierarchy: needs → running → idle, with risk badges (`DESTRUCTIVE`, `CODE_EXECUTION`, `REQUIRES_REVIEW`) and smart reply suggestions (`suggestReply`). `CommandPalette.jsx` is solidly built — debounced FTS5 search, grouped results, type filters, keyboard navigation. `SelectionBar.jsx` is clean and well-tokened. The progressive disclosure pattern (CORE tabs visible, ADVANCED behind a toggle) is the right architectural call.

**What's broken or debt:**

The most critical path in the product — the `QuickActions` approve action — is implemented using `<span role="button">` elements that fail keyboard and screen reader accessibility. The `FleetTab` does not use `--mc-*` tokens, breaking theme coherence for the fleet view. `SelectCheckbox` is invisible to keyboard users. The anomaly toast model has no ack/persist contract. Several components carry hardcoded Tailwind color classes that bypass the theme cascade.

---

## Horizon 1 — Foundation (Sprints 1–2)

*UX debt that blocks good governance UX. Fix these before adding anything new.*

---

### H1-1: Replace `<span role="button">` with real `<button>` in QuickActions

**File:** `apps/cockpit/client/src/components/QuickActions.jsx`

**Before:** The approve chips (yes, continue, approve, and the smart suggestion) are `<span>` elements with `role="button"` and `tabIndex={0}`. They have no native click handling, no automatic keyboard focus management, and no visible focus ring. The `onKeyDown` handler only responds to `Enter` — missing `Space`. The touch/click target is approximately 24×16px at 10px font size with `px-1.5 py-0.5` padding. This is a direct WCAG 4.1.2 (Name, Role, Value) failure on the most critical interactive element in the product.

**After:** All chips become `<button type="button">` elements. Minimum height 28px (WCAG 2.5.5 touch target size). `focus-visible:ring-2 ring-[var(--mc-accent)] ring-offset-1 ring-offset-[var(--mc-surface)]` on every button. The primary chip (`suggestion` or `yes` when no suggestion) receives stronger visual weight: slightly larger padding, `font-medium`, 1px accent-toned border. Space key fires the action.

**Personas:** Priya (WCAG gate), Mara (primary action affordance)

**Acceptance criteria:**
- `axe-core` audit shows zero violations on `QuickActions` in isolation
- Keyboard-only user can tab to a chip, press Space or Enter, and see confirmation without mouse
- Primary chip is visually distinct from secondary chips (size, border, or weight — not color alone)
- Touch target ≥ 28px height

---

### H1-2: Make `SelectCheckbox` keyboard-visible

**File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx` (the `SelectCheckbox` component)

**Before:** `SelectCheckbox` applies `opacity-0` until the parent `group` is hovered (`group-hover:opacity-100`). A keyboard user tabbing through the triage card list will tab-focus this button with zero visual indicator that it's focused. WCAG 2.4.7 (Focus Visible) violation.

**After:** Add `focus-visible:opacity-100` to the button's class list. The checkbox becomes visible whenever it receives keyboard focus, regardless of hover state. No layout change required — this is a single class addition.

**Personas:** Priya (WCAG 2.4.7), Diego (keyboard flow)

**Acceptance criteria:**
- Tab-navigating through triage cards reveals checkboxes on focus without hover
- Checked state is still visually distinct from unchecked (the existing `text-[var(--mc-accent)]` vs `text-[var(--mc-fg-4)]` contrast works)

---

### H1-3: Add non-color secondary signals to status indicators

**File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`, `apps/cockpit/client/src/components/QuickActions.jsx`

**Before:** Status is communicated entirely through color. In `AttnCard`: danger (DESTRUCTIVE) = red border + red left-stripe + red ping dot; warn = amber border + amber ping dot. In `CalmRow`: done = blue-accent dot; idle = gray dot. A user who cannot distinguish red from amber (deuteranopia affects ~8% of males) loses the DESTRUCTIVE/REQUIRES_REVIEW distinction entirely. WCAG 1.4.1 (Use of Color) violation.

**After:** Add icon-level secondary signal to each tier:
- `DESTRUCTIVE` cards: add a `ShieldAlert` (lucide) icon (12px) in `--mc-danger` color alongside the risk badge. The badge text already says "Destructive" — the icon reinforces it without adding text noise.
- `CODE_EXECUTION` / `REQUIRES_REVIEW` cards: add `AlertTriangle` (12px) in `--mc-warn`.
- `CalmRow` "done" indicator: add `CheckCircle2` (10px) alongside the dot, `text-[var(--mc-ok)]`.
- `AttnCard` left-stripe: also add `aria-label` to the stripe element: "Destructive risk" / "Requires review" (currently `aria-hidden="true"` — fine, but the card needs an overall accessible description of its risk state).

**Personas:** Priya (WCAG 1.4.1), Mara (attention hierarchy)

**Acceptance criteria:**
- Screen reader announces risk level when an AttnCard receives focus
- Risk tier is distinguishable without relying on hue differentiation
- No visual clutter — icons are 10–12px, consistent with existing `Clock` and `Cpu` usage

---

### H1-4: Migrate FleetTab to `--mc-*` tokens

**Files:** `apps/cockpit/client/src/components/FleetTab/FleetTab.jsx`, `apps/cockpit/client/src/components/FleetTab/FleetRunDetail.jsx`, `apps/cockpit/client/src/components/FleetTab/LaunchDrawer.jsx`

**Before:** `FleetTab.jsx` uses hardcoded Tailwind classes throughout: `bg-indigo-900/30`, `border-indigo-700`, `text-gray-200`, `text-gray-600`, `text-indigo-300`, `hover:bg-gray-800/60`. When a user switches to `tron` (cyan accent) or `warm` (gold accent) theme, the Fleet tab stays indigo. The theme cascade via `tailwind.config.js` remaps gray and indigo *channel variables* (`--mc-gray-*`, `--mc-indigo-*`), so `bg-indigo-900/30` does flow through the theme — but direct `text-indigo-300` and `border-indigo-700` on component-level strings do not, because those are Tailwind class strings, not CSS variable references.

**After:** Replace all direct Tailwind color literals with `--mc-*` token references via `style` props or the `text-[var(--mc-*)]` / `bg-[var(--mc-*)]` pattern already used in `TriageView.jsx`. Specifically:
- Run list selected state: `bg-[var(--mc-accent-soft)] border-[var(--mc-accent-line)]` replaces `bg-indigo-900/30 border-indigo-700`
- Run list hover: `hover:bg-[var(--mc-surface-2)]` replaces `hover:bg-gray-800/60`
- Status dot colors: `RUN_STATUS` entries should reference `--mc-ok`, `--mc-danger`, `--mc-warn`, `--mc-fg-4` via `style={{ backgroundColor: 'var(--mc-ok)' }}` or equivalent

**Personas:** Mara (visual coherence), Sam (fleet view consistency)

**Acceptance criteria:**
- Switching to `tron` or `warm` theme produces consistent colors in Fleet tab (no indigo bleedthrough)
- All four themes render Fleet run list with correct accent color for selected state

---

### H1-5: Fix focus ring on SelectionBar input and modal targets

**Files:** `apps/cockpit/client/src/components/TriageView/SelectionBar.jsx`, `apps/cockpit/client/src/components/ui/Dialog.jsx`

**Before:** `SelectionBar`'s text input has `focus:outline-none focus:border-[var(--mc-accent)]` — the outline is removed and replaced with a 1px border-color change. A 1px border shift is not a visible focus indicator per WCAG 2.4.7. The `Dialog` component traps focus (good) but the focus-return-on-close behavior and initial-focus target are worth an audit.

**After:**
- `SelectionBar` input: change to `focus:outline-none focus-visible:ring-2 ring-[var(--mc-accent)] ring-offset-1 ring-offset-[var(--mc-surface)]`. Keep the border change as an additional signal, not the only one.
- `Dialog.jsx`: verify initial focus lands on the first interactive element inside the modal, not the container div. Verify focus returns to the trigger element on close.
- All action buttons that currently only have `transition-colors` hover states: add `focus-visible:ring-2` where missing.

**Personas:** Priya (WCAG 2.4.7), Diego (keyboard flow)

**Acceptance criteria:**
- Tabbing to the SelectionBar input shows a 2px ring, not just a 1px border
- Opening and closing a Dialog returns focus to the triggering button
- No `focus:outline-none` without a replacement ring somewhere in the component chain

---

## Horizon 2 — Power User Layer (Sprints 2–4)

*Keyboard-first interactions, density modes, command palette depth.*

---

### H2-1: Command Palette action mode (`>` prefix)

**File:** `apps/cockpit/client/src/components/CommandPalette.jsx`

**Before:** `⌘K` opens a palette that searches session names and transcript messages. Selecting a result navigates to the session detail view. It cannot execute actions. To approve a session, a user must: navigate to Triage (or know the right session is selected), find the chip, click it. If they're in another tab looking at History or Fleet, the fastest approval path is close palette → click Agents tab → find card → click chip. Four steps.

**After:** Introduce an action mode triggered by typing `>` as the first character of the query. The palette switches visual mode (background tint, prompt changes to `> command...`) and shows action suggestions:
- `> approve` — quick-approves the currently `needsInput` session matching the query (or the first needs-input session if no qualifier); posts `yes` via `/api/sessions/:id/message`
- `> steer [message]` — steers the selected/first-active session with a custom message
- `> continue` — posts `continue` to the first needs-input session
- `> mute [session]` — mutes notifications for a session

This follows Spotlight/VS Code Command Palette convention. The existing `quickApprove` handler in `App.jsx` already does the POST — the palette just needs to call it. Session target: the palette already has the `sessions` prop and can identify `sessions.filter(s => s.needsInput)`.

**Personas:** Diego (keyboard-first), Sam (approve from any surface, ack pattern)

**Acceptance criteria:**
- Typing `> approve` in the palette and pressing Enter posts `yes` to the first needs-input session, closes palette, and shows a brief status toast
- The action mode is visually distinguishable from search mode
- Existing session search behavior unchanged when `>` prefix is absent
- Action mode is documented in `ShortcutHelpOverlay`

---

### H2-2: Keyboard arrow navigation in TriageView

**File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`

**Before:** The triage view has no keyboard-driven card navigation. The `quickApprove` shortcut in `App.jsx` fires `sendQuickReply(selectedSession, 'yes')` — but `selectedSession` is set by clicking a session in the sidebar `SessionsList`, not by navigating within the Triage view. A keyboard user has no way to move through the `AttnCard` list and approve items sequentially without touching the mouse.

**After:** The "Needs you" section manages its own focused-card state with `useReducer` (prev/next/select). `↓/↑` arrow keys move the focused AttnCard (focus ring on the card container, `data-focused` attribute). `Enter` on a focused AttnCard opens the session detail. `Y` on a focused AttnCard sends `yes` directly without opening detail. `Space` toggles multi-select on the focused card. The running section and calm section are tab-reachable.

This is a local interaction model — like Vim navigation inside a list — that doesn't conflict with the global shortcut system. The card focus state is separate from `selectedSessionId` (the sidebar selection).

**Personas:** Diego (keyboard-first), Mara (approval in 3 seconds)

**Acceptance criteria:**
- User can load Triage tab, press Tab once to enter the "Needs you" list, arrow-navigate to a card, press Y, and approve it — without mouse
- The focused card shows a visible focus ring (`ring-2 ring-[var(--mc-accent)]` on the card container)
- Multi-select with Space + SelectionBar broadcast works in keyboard-only flow
- `quickApprove` in App.jsx falls back to approving the keyboard-focused AttnCard when no `selectedSession` matches

---

### H2-3: Density mode for TriageView

**File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`

**Before:** Card sizing is fixed. `AttnCard` uses `p-4` with a `rounded-xl` container. `RunningTile` uses `p-3.5`. `CalmRow` uses `py-2.5`. This comfortable density is appropriate at ≤10 sessions. At 20 running agents, the Running grid becomes a long scroll and users lose the "at a glance" scan that the grid promises.

**After:** A density toggle (persisted to `localStorage` as `mc.density`) with three modes:
- `comfortable` (current default) — `p-4` cards, current sizing
- `compact` — `p-2.5` cards, `text-[12px]` session labels, `CalmRow` at `py-1.5`, `RunningTile` at `p-2`; tool count chips hidden (shown only in comfortable)
- The toggle renders as three dot-icons (⋮ size variants) in the TriageView header bar, alongside the existing Board/Detail/Triage mode buttons in `App.jsx`

Compact mode is Sam's request: at 20 agents, compact mode lets you see the whole fleet on a 1440p monitor.

**Personas:** Sam (fleet scale), Diego (density preference)

**Acceptance criteria:**
- `mc.density` persists across page reloads
- All three density levels render without layout overflow on a 1280px-wide viewport
- Compact mode still shows risk badges (they are safety-critical — never hidden)
- Density toggle is keyboard-accessible (button, not span)

---

### H2-4: Shortcut hints on key interactive elements

**Files:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`, `apps/cockpit/client/src/components/QuickActions.jsx`, `App.jsx` (the toolbar)

**Before:** The keyboard shortcuts `quickApprove`, `quickContinue`, `focusInput`, `commandPalette` exist and work but are invisible at the surface level. The only discoverability path is `?` → `ShortcutHelpOverlay`. A new team member using Mission Control for the first time has no signal that `Y` can approve a session or `⌘K` can search everything. The chips in `QuickActions` have no `title` hint showing the keyboard binding.

**After:**
- The `yes`/approve chip `title` attribute: `"Approve (Y)"`. The `continue` chip: `"Continue (C)"`. These hints appear on hover via the browser's native tooltip — zero implementation cost.
- The ⌘K button (if one is added to the header or triage view) shows `⌘K` visibly, not just as a tooltip.
- The Triage view's section header for "Needs you" adds a small `?` icon tooltip or a `kbd` element showing `↑↓ to navigate, Y to approve` — visible on hover of the section head, hidden otherwise.
- The `ShortcutHelpOverlay` is updated to include the new H2-2 arrow navigation shortcuts.

**Personas:** Diego (discoverability), Mara (3-second approval path)

**Acceptance criteria:**
- Hovering the `yes` chip shows "Approve (Y)" tooltip
- The keyboard shortcut help overlay (`?`) is up to date with all active shortcuts
- No new persistent UI chrome added (hints are hover-revealed, not always-on labels)

---

### H2-5: Add elapsed time to AttnCard and RunningTile

**Files:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`

**Before:** `AttnCard` shows a clock icon with static text "waiting." There is no timestamp indicating when the agent entered the needs-input state. A session that has been waiting 4 minutes and a session that has been waiting 2 hours are visually identical. `RunningTile` shows the last tool name and cost but no elapsed time since the session started or last activity.

**After:**
- `AttnCard`: replace the static "waiting" label with a live relative time showing the duration since `session.lastModified` (the server already emits this). Format: "waiting 4m", "waiting 2h 15m". Add a `title` attribute with the absolute ISO timestamp for the full time on hover.
- `RunningTile`: add a small elapsed time in `--mc-fg-4` at the bottom-right of the card. Format: "running 12m". This uses the same `session.lastModified` field.
- Add a shared `useRelativeTime` hook that re-renders every 30 seconds to keep the display current without server round-trips.

**Personas:** Sam (time context is observability 101), Mara (urgency hierarchy)

**Acceptance criteria:**
- AttnCard shows human-readable elapsed wait time that updates every 30 seconds
- Hovering the time element shows the absolute timestamp
- Sessions waiting >1 hour show the wait time in `--mc-warn` color (visual urgency escalation)
- The hook doesn't fire on sessions that aren't visible (intersection observer guard)

---

## Horizon 3 — Scale & Observability (Sprints 4–8)

*20+ agent fleet view, incident-management UX patterns, timeline/history.*

---

### H3-1: Virtualized Running grid in TriageView

**File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`

**Before:** All `RunningTile` and `AttnCard` components mount immediately. Each `AttnCard` fires a `useApi` call to `/api/sessions/:id/messages?limit=12` for the smart reply suggestion. At 20 needs-input sessions, this is 20 simultaneous API calls on mount. At 30 running sessions, the Running grid renders 30 DOM subtrees. This doesn't fail at small fleet sizes, but it degrades at the scale Mission Control is designed for.

**After:** Implement intersection-observer-based lazy mounting for the Running and Idle sections. The "Needs you" section stays eagerly mounted (it is the primary interaction surface and is typically small). `RunningTile` cards below the viewport fold defer their `useApi` message call until they scroll into view. Implement using a `useIntersectionObserver` hook that toggles an `isVisible` flag; when `isVisible` is false, the card renders a skeleton placeholder at the same dimensions (preventing layout shift).

For teams running 50+ sessions: add a "Show all" / "Show top 20" toggle in the Running section head, defaulting to top-20 sorted by `lastModified` descending.

**Personas:** Sam (20+ agent scale), Diego (tool performance = product quality)

**Acceptance criteria:**
- At 30 running sessions, initial page load fires ≤10 message API calls (only visible cards)
- Scrolling reveals cards progressively without layout shift
- "Show top 20" default hides older sessions; count badge shows total
- Performance measured by Chrome DevTools Network waterfall before/after

---

### H3-2: Anomaly ack → resolve workflow

**Files:** `apps/cockpit/client/src/components/AnomalyToast.jsx`, `apps/cockpit/client/src/App.jsx`

**Before:** Anomalies arrive via SSE `anomaly` event, are added to an in-memory array in `App.jsx` (capped at 4 with `prev.slice(-3)`), and render as a toast stack via `AnomalyToast`. When the stack overflows, the oldest anomaly is silently dropped. There is no acknowledgment state — dismissing the toast is permanent, with no log of what was dismissed or by whom. A burst of 5 anomalies loses the first one instantly.

**After:** Introduce a persistent anomaly store in `App.jsx` that does not drop anomalies on overflow. The store has three states per anomaly: `new` (unack'd), `acknowledged` (seen, not resolved), `resolved` (no further action needed). Introduce an `AnomalyPanel` (a drawer or modal, accessed via a bell icon with a badge count in the header) that shows all anomalies with their state and a timestamp. The `AnomalyToast` stack continues for real-time notification of new anomalies but dismissing it marks the anomaly `acknowledged` rather than deleting it. The panel allows marking `resolved`.

The header bell (`Bell` icon already imported in `App.jsx`) gets a count badge showing the number of unacknowledged anomalies. The badge persists until all anomalies are acknowledged.

SCOPE impact: this is a new component (`AnomalyPanel`) that should be classified EXPERIMENTAL until it has a full test pass.

**Personas:** Sam (ack → resolve pattern), Mara (don't hide critical information), Priya (anomalies must persist for screen readers to catch them)

**Acceptance criteria:**
- A burst of 10 anomalies loses zero of them (no array capping)
- The header bell badge count is accurate and updates in real time
- Closing a toast marks the anomaly `acknowledged`, not deleted
- Anomaly panel shows all anomalies with timestamps and status
- Screen reader announces new anomalies via an `aria-live="assertive"` region

---

### H3-3: Fleet dashboard grid view

**Files:** `apps/cockpit/client/src/components/FleetTab/FleetTab.jsx`

**Before:** The Fleet tab has a 224px left sidebar listing runs as rows, with a detail panel on the right showing the selected run. At 20+ active runs, the sidebar is a scrollable list of identically-formatted rows — `run.goal` truncated to fit the width, status dot, `N/M` child count. There is no way to see the state of all active runs at a glance.

**After:** Add a toggle between the existing "List + Detail" layout and a new "Dashboard" mode showing all runs as cards in a responsive grid (`grid-cols-2 lg:grid-cols-3`). Each dashboard card shows: run goal, status, child progress bar (N of M settled), estimated cost, elapsed time, and escalation indicator if any child is paused. Clicking a card still opens the detail panel (in a modal or slide-over). The dashboard mode persists to `mc.fleet.view` in localStorage.

The card structure should borrow from Grafana's panel model: a header with title and status badge, a body with the key metric (progress), and a footer with cost + time. Status is communicated by border color (using `--mc-*` tokens: `--mc-ok` for running, `--mc-warn` for paused, `--mc-danger` for failed) plus a text label.

**Personas:** Sam (fleet management at scale), Mara (visual scan path)

**Acceptance criteria:**
- Dashboard mode shows all active fleet runs in a 2–3 column grid without horizontal scrolling on a 1280px viewport
- Each card communicates status with color + text label (dual coding, per H1-3)
- Progress bar shows settled/total children as a proportional fill
- Switching between List and Dashboard mode preserves the selected run

---

### H3-4: History tab timeline view

**Files:** `apps/cockpit/client/src/components/HistoryTab/HistoryTab.jsx`

**Before:** The History tab has three modes (activity feed, full-text search, usage/cost stats). The activity feed is a reverse-chronological list of events. There is no time axis — no way to see that three approval requests clustered at 2:30pm, or that a session was idle for 4 hours before a burst of activity. The usage stats show daily rollups but no intra-day pattern.

**After:** Add a fourth mode, "Timeline," accessible via a mode toggle in the HistoryTab header. The timeline shows a horizontal time axis (scoped to a user-selectable range: last 1h, 6h, 24h, 7d) with session spans rendered as horizontal bars (Gantt-style). Event markers (approval requests, anomalies, session starts/stops) are plotted as vertical lines on the bar. Hovering a marker shows a tooltip with the event detail.

Implementation note: the server already provides `GET /api/stats/usage` for daily rollups and the FTS5 search index stores message timestamps. The timeline can be built on the existing data without new server routes — `GET /api/search?limit=500` with a time range filter is sufficient for a 1-hour window.

This is a Horizon 3 item because it requires the FTS5 corpus to be reliable (which it will be by then) and benefits from the H3-1 virtualization work being done first.

**Personas:** Sam (time axis is observability standard), Mara (pattern recognition at a glance)

**Acceptance criteria:**
- Timeline renders correctly for the last 1-hour window on a fleet with 5–20 sessions
- Session bars are labeled with session name (truncated with ellipsis)
- Event markers are color-coded by type (approval = amber, anomaly = red, session start = green) with accessible labels
- Time range selector allows 1h, 6h, 24h, 7d scopes

---

### H3-5: Reclassify Mesh tab to EXPERIMENTAL/Advanced

**Files:** `apps/cockpit/client/src/App.jsx` (CORE_TABS array), `SCOPE.md`

**Before:** The `Mesh` tab (`MeshView/`) is in `CORE_TABS` alongside Agents, Tasks, Runs, Fleet, History. It displays a real-time network visualization of tool calls between agents — a live packet-flow graph using the SSE `tool_call` event. This is a powerful debugging and observability tool. It is not a daily operational surface for a lead managing agent approvals.

A new user landing on Mission Control sees six CORE tabs: Agents, **Mesh**, Tasks, Runs, Fleet, History. Mesh is the second tab. It reads as core operational UI. It competes with Agents (the actual hero view) for the second tab position.

**After:** Move `mesh` from `CORE_TABS` to `ADVANCED_TABS` in `App.jsx`. Update `SCOPE.md` to classify `MeshView/` as EXPERIMENTAL (it is already flagged as a V3 hook instrumentation feature in the code comments). The tab remains fully accessible via the Advanced toggle — power users keep it; operational leads don't see it by default.

Alternatively, embed the Mesh view as a mode inside Agent detail (a "Network" tab inside `AgentTree.jsx`). This would keep the network visualization close to the session it's monitoring without cluttering the primary navigation.

**Personas:** Diego (progressive disclosure — the expert path should be accessible, but not the default), Mara (visual hierarchy: the hero view is Agents, not Mesh)

**Acceptance criteria:**
- `CORE_TABS` in `App.jsx` no longer includes `mesh` after this change
- `SCOPE.md` updated to classify `MeshView/` as EXPERIMENTAL
- The Mesh tab is reachable via Advanced toggle
- `coreTabs.test.js` updated to reflect new tab manifest (CORE tabs = Agents, Tasks, Runs, Fleet, History)

---

## Horizon 4 — Polish & Delight (Sprint 8+)

*Theme coherence, motion vocabulary, onboarding, component splits.*

---

### H4-1: Full token audit — eliminate hardcoded color literals

**Files:** All components in `apps/cockpit/client/src/components/`

**Before:** Despite the `--mc-*` token system, many components still use hardcoded Tailwind color literals. FleetTab is the most egregious (addressed in H1-4), but the pattern exists elsewhere: `bg-amber-900/40 text-amber-300` in `QuickActions.jsx`, `bg-indigo-900/40 text-indigo-300` in the "reply" button, `bg-red-900/50 text-red-300` for the error state. These bypass the theme cascade — if you're on `tron` (cyan) or `warm` (gold), these elements remain amber/indigo/red regardless.

**After:** A systematic audit using `grep -r "bg-amber\|bg-indigo\|bg-red\|bg-green\|text-amber\|text-indigo\|text-red\|text-green" apps/cockpit/client/src/components/`. Each hit is evaluated: is this a semantic state (should use `--mc-warn`, `--mc-danger`, `--mc-ok`, `--mc-accent`) or a one-off? Semantic states get replaced with token references. One-offs get a comment explaining the exception.

Target: zero hardcoded Tailwind semantic-color literals in `components/` that aren't `gray-*` (which flows through the cascade channel variables).

**Personas:** Mara (visual coherence across themes), Sam (tron theme especially — a cyan-accented fleet view should feel intentional)

**Acceptance criteria:**
- `grep` for `bg-amber\|bg-indigo\|bg-red` in `components/` returns zero results after the audit
- All four themes render `QuickActions` chips with accent-toned primary chip and muted secondary chips
- The `warm` theme's `QuickActions` shows gold accent chips, not amber ones

---

### H4-2: Defined motion vocabulary

**Files:** `apps/cockpit/client/src/index.css`, multiple components

**Before:** Animations are applied inconsistently. `animate-ping` is used for both the needs-input indicator (correct — it signals urgency) and the active-session running indicator (incorrect — running is calm, not urgent). `animate-pulse` appears on the header's "active" count badge. Several components use `transition-colors` on hover. There's no motion vocabulary — no rule for what animation means what.

**After:** Define a motion vocabulary in `index.css` and `CLAUDE.md`:
- `animate-ping` = **urgent, requires immediate attention** — used only for `needsInput` state indicators
- `animate-pulse` = **live, autonomous activity** — used for running agents and the active count badge
- `transition-colors` = **interactive affordance** — hover/focus states on buttons and cards
- Enter/exit animations for drawers, modals, and the command palette: CSS `@keyframes` slide-in/fade-in (100ms), not `transition` — these need to feel snappy, not laggy
- Anomaly toasts: `@keyframes` slide-up from bottom, auto-dismiss fade-out

Apply the vocabulary: replace the green `animate-ping` on `RunningTile`'s running indicator with `animate-pulse`. Keep `animate-ping` only for `AttnCard`'s needs-input indicator.

**Personas:** Mara (animation = attention direction), Diego (no animation that plays while waiting for data)

**Acceptance criteria:**
- `animate-ping` appears only on needs-input state indicators; all running-state indicators use `animate-pulse`
- The motion vocabulary is documented in `CLAUDE.md` (client architecture section)
- All modal/drawer entries have a 100ms enter transition

---

### H4-3: Onboarding flow for new teams

**Files:** `apps/cockpit/client/src/components/WelcomeHero.jsx` (extend), new `apps/cockpit/client/src/components/OnboardingFlow.jsx`

**Before:** `WelcomeHero` renders on the zero-sessions state (when `sessions.length === 0`) with a "Start your first agent" CTA and an "Open Trust Settings" secondary action. It's a good minimal empty state. But there's no guidance on what Mission Control actually is, how to connect a project to the harness, what the Fleet and Runs tabs do, or how to invite teammates. A new team lead opening Mission Control for the first time needs a different experience than a returning user who just cleared all their sessions.

**After:** A `OnboardingFlow` component triggered on first-ever load (gated by a `mc.onboarded` localStorage flag). Three steps, each skippable:
1. **Connect**: confirm the first agent session is running (or link to Claude Code docs to start one). Skip if sessions already exist.
2. **Govern**: "Mission Control watches your agents and asks before they take risky actions. Here's the approval queue." — a one-screenshot explainer of TriageView. CTA: "I understand."
3. **Scale**: "Want to run multiple agents on the same goal? Meet Fleet." — a one-sentence Fleet explainer with a CTA that opens the Fleet tab. Skippable.

Each step is a panel inside a Dialog (using the existing `Dialog.jsx`). The existing `WelcomeHero` serves as the background during onboarding.

**Personas:** Mara (empty state guidance), Diego (no wizard for experts — every step is skippable in one click)

**Acceptance criteria:**
- `mc.onboarded` flag prevents re-showing after completion or skip-all
- All three steps are independently skippable (one click)
- Expert path: a user who clicks "Skip setup" on step 1 never sees the flow again
- Onboarding doesn't trigger if sessions already exist when the app first loads

---

### H4-4: Split `ConversationView.jsx` (~920 LOC)

**File:** `apps/cockpit/client/src/components/ConversationView.jsx`

**Before:** Flagged in `SCOPE.md` and `CLAUDE.md` as a large component (~920 LOC). A monolithic component at this size is hard to accessibility-audit (Priya's checklist can't be run on a black box), hard to performance-profile (where is the render cost?), and creates merge conflicts when multiple contributors touch it.

**After:** Split into focused components that can be audited and tested independently:
- `MessageList.jsx` — the scrollable transcript with message rows
- `ApprovalPanel.jsx` — the pending approval UI (currently the most UX-sensitive part of the conversation)
- `ToolUseBlock.jsx` — the expandable tool call display
- `MetadataStrip.jsx` — session metadata at the top of the conversation

`ConversationView.jsx` becomes a thin coordinator that imports and composes these. Each sub-component has its own test file.

**Personas:** Priya (focused components are accessible-auditable), Diego (maintainability = iteration speed)

**Acceptance criteria:**
- `ConversationView.jsx` drops below 200 LOC after the split
- All sub-components are independently importable and testable
- Existing tests for `ConversationView` pass without modification (external API unchanged)
- Each sub-component has at least one unit test covering its primary interaction

---

## SCOPE.md Changes Implied by This Roadmap

| Item | Current classification | Proposed change |
|---|---|---|
| `MeshView/` | CORE (in CORE_TABS) | EXPERIMENTAL (move to Advanced) — H3-5 |
| `AnomalyPanel` (new) | n/a | EXPERIMENTAL until full test pass — H3-2 |
| `ConversationView.jsx` sub-components | n/a | EXPERIMENTAL until test coverage added — H4-4 |
| `QuickActions.jsx` | CORE (part of Triage view) | Remains CORE; accessibility violations (H1-1) are blocking |

---

## Acceptance Criteria Cheat Sheet

A feature from this roadmap ships when:

1. Priya's accessibility checklist passes (no `<span role="button">`, all focus rings present, dual-coded status, `aria-live` on async feedback)
2. At least one test covers the new interaction (unit test for component logic, or e2e for the critical path)
3. The component uses `--mc-*` tokens exclusively (no hardcoded Tailwind semantic colors except gray-* via cascade)
4. The Think Tank retro for the sprint records a Green from the relevant persona
5. `SCOPE.md` is updated if the component's classification changes

---

*Last updated from source read: 2026-06-28. Next update due after Sprint 1 retro.*
*Roadmap owners: UX Think Tank (see UX-THINK-TANK.md). Engineering liaison: whoever touches `apps/cockpit/client/`.*
