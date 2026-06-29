# MC UX Implementation Task List

_Graded: Impact × Urgency / Effort. Higher score = do first._
_Source-verified against actual component code on 2026-06-28._

**Scoring rubric:**

- **Impact (1–5):** How much does this improve the core governance use case? (5 = directly on the approval critical path or agent-state visibility)
- **Urgency (1–5):** How much is this blocking real usage today? (5 = confirmed WCAG violation or broken keyboard path; 1 = future polish)
- **Effort (1–5):** How hard is this to implement? (1 = one-file change under 50 lines; 5 = new component, new state, new tests, architecture change)
- **Score = Impact × Urgency / Effort** — higher = do first

---

## Tier 1 — Do Now (score ≥ 10)

These two are the rarest combination: WCAG violations on the most-trafficked interaction surface, fixable in a single focused session.

---

### H1-1: Replace all `<span role="button">` with `<button>` in QuickActions

- **File:** `apps/cockpit/client/src/components/QuickActions.jsx`
- **What:** Convert the three `<span role="button" tabIndex={0}>` elements (lines 55, 78, 98) to `<button type="button">`. Remove manual `onKeyDown` handlers (native `<button>` fires on Space and Enter without them). Add `focus-visible:ring-2 ring-[var(--mc-accent)] ring-offset-1 ring-offset-[var(--mc-surface)]` to every chip. Bump minimum height to ≥ 28px via `py-1` (currently `py-0.5`). Replace hardcoded Tailwind color literals — `bg-amber-900/40 text-amber-300` (line 91), `bg-red-900/50 text-red-300` (line 90), `bg-indigo-900/40 text-indigo-300` (line 105) — with `--mc-*` token equivalents (`--mc-warn-soft/--mc-warn`, `--mc-danger-soft/--mc-danger`, `--mc-surface-2/--mc-fg-3`). Add a `<span aria-live="polite" aria-atomic="true" className="sr-only">` inside the component that announces "Sent" when `sending` transitions from a value to `null` and "Failed" when `error` is set.
- **Why:** Priya (WCAG 4.1.2 — Name, Role, Value) and Mara (primary action affordance). Every approve/continue/reply action in the product is on a `<span>` today: no native keyboard semantics, Space key does nothing, no focus ring, touch targets ~24×16px. This is the most critical interactive element in the codebase shipping with a hard accessibility failure.
- **Acceptance:**
  - `axe-core` audit on `QuickActions` in isolation returns zero violations
  - Tab to a chip, press Space → message sent, no mouse required
  - Tab to a chip, press Enter → message sent
  - Focus ring (2px, accent-colored) is visible on each chip when keyboard-focused
  - All three chips have minimum 28px touch height
  - Switching to `tron` or `warm` theme produces correctly toned chips (no amber/indigo bleedthrough)
  - `aria-live` region announces outcome to screen reader on send/fail
- **Score:** Impact(5) × Urgency(5) / Effort(2) = **12.5**

---

### H1-2: Make `SelectCheckbox` visible on keyboard focus

- **File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx` — `SelectCheckbox` component, line 64
- **What:** The unchecked class string currently reads `'text-[var(--mc-fg-4)] opacity-0 hover:text-[var(--mc-fg-2)] group-hover:opacity-100'`. Add `focus-visible:opacity-100` to this string. One class, one line. Also verify the `RunningTile` usage of `SelectCheckbox` (lines 156–158) carries the same fix via the shared component.
- **Why:** Priya (WCAG 2.4.7 — Focus Visible). A keyboard user tabbing through triage cards tab-focuses an invisible `<button>` with zero visual indicator. The element is structurally correct (`<button type="button" role="checkbox">`) — it just needs to reveal itself on focus.
- **Acceptance:**
  - Tab through triage cards without mouse → checkboxes appear on each card as focus arrives
  - Hover is no longer required to see the checkbox
  - Checked state (`opacity-100` always, accent color) is unchanged
  - Fix applies in both `AttnCard` and `RunningTile` (both use `SelectCheckbox`)
- **Score:** Impact(2) × Urgency(5) / Effort(1) = **10.0**

---

## Tier 2 — Next Sprint (score 5–9)

---

### H3-5: Move `mesh` from `CORE_TABS` to `ADVANCED_TABS`

- **Files:** `apps/cockpit/client/src/App.jsx` (lines 65–72 `CORE_TABS`, lines 74–78 `ADVANCED_TABS`), `SCOPE.md`, `apps/cockpit/client/src/tests/coreTabs.test.js`
- **What:** In `App.jsx`, move `{ id: 'mesh', label: 'Mesh', icon: Network }` from the `CORE_TABS` array to `ADVANCED_TABS`. Update `SCOPE.md` to classify `MeshView/` as EXPERIMENTAL. Add one test in `coreTabs.test.js` asserting that `CORE_TABS.map(t => t.id)` equals `['agents', 'tasks', 'runs', 'fleet', 'history']` exactly — this locks the 5-tab CORE manifest and will catch any future regression.
- **Why:** Diego (progressive disclosure) and Mara (visual hierarchy). Mesh is currently the second CORE tab — it sits between Agents and Tasks in the default navigation for every user. It is a live packet-flow debug graph, not a daily operational surface. A team lead opening Mission Control for the first time sees Mesh as the second-most-important thing in the product before understanding the approval queue. The fix is a single array membership change.
- **Acceptance:**
  - Default view (Advanced collapsed) shows 5 tabs: Agents, Tasks, Runs, Fleet, History
  - Mesh is accessible via the Advanced toggle
  - `coreTabs.test.js` has an exact-match assertion on the 5-tab CORE manifest and passes
  - `SCOPE.md` updated with `MeshView/` → EXPERIMENTAL
- **Score:** Impact(3) × Urgency(3) / Effort(1) = **9.0**

---

### H2-5: Add elapsed time to `AttnCard` and `RunningTile`

- **Files:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`, new `apps/cockpit/client/src/hooks/useRelativeTime.js`
- **What:** Create a `useRelativeTime(timestamp)` hook that returns a human-readable duration string (`"4m"`, `"2h 15m"`) from a timestamp to `Date.now()`, re-evaluating every 30 seconds via `setInterval`. In `AttnCard` (line 127), replace the static `<Clock size={12} /> waiting` label with `<Clock size={12} /> waiting {relativeTime}` where `relativeTime` comes from `useRelativeTime(session.lastModified)`. Add a `title` attribute to the time element with the ISO timestamp. Apply `style={{ color: 'var(--mc-warn)' }}` when the duration exceeds 1 hour. In `RunningTile`, add a small `<span>` at the bottom-right of the card: `running {relativeTime}` in `--mc-fg-4`.
- **Why:** Sam (time context is observability 101) and Mara (urgency hierarchy). Currently a session waiting 4 minutes and one waiting 2 hours are visually identical — the "waiting" clock icon conveys zero urgency signal. This is an operational gap: operators cannot triage by urgency without opening each session.
- **Acceptance:**
  - `AttnCard` shows "waiting 4m" / "waiting 2h 15m" — live, updating every 30s without a server call
  - Sessions waiting >1 hour render the wait time in `--mc-warn` color
  - Hovering the time element shows the absolute ISO timestamp via `title`
  - `RunningTile` shows "running 12m" in muted `--mc-fg-4`
  - Hook cleans up its `setInterval` on unmount
- **Score:** Impact(4) × Urgency(3) / Effort(2) = **6.0**

---

### H1-5: Fix focus ring on `SelectionBar` input

- **Files:** `apps/cockpit/client/src/components/TriageView/SelectionBar.jsx` (line 88), `apps/cockpit/client/src/components/ui/Dialog.jsx` (audit)
- **What:** In `SelectionBar.jsx` at line 88, the input has `focus:border-[var(--mc-accent)] focus:outline-none` — the outline is removed and replaced with a 1px border-color change which is not a visible focus indicator per WCAG 2.4.7. Change to: keep `focus:outline-none focus:border-[var(--mc-accent)]` AND add `focus-visible:ring-2 ring-[var(--mc-accent)] ring-offset-1 ring-offset-[var(--mc-bg)]`. Separately, open `Dialog.jsx` and verify: (a) the first interactive element inside the modal receives focus on open, and (b) focus returns to the triggering button on close — add `autoFocus` or a `useEffect` focus call if either is missing.
- **Why:** Priya (WCAG 2.4.7 — Focus Visible). A keyboard user sending a broadcast message sees no visible indicator when the input is focused. This compounds with the `SelectCheckbox` issue (H1-2) to create a keyboard navigation dead zone in the triage multi-select flow.
- **Acceptance:**
  - Tabbing to the SelectionBar input shows a 2px accent ring (not just a border color change)
  - No `focus:outline-none` without a replacement ring visible in the component
  - Dialog opens with focus on first interactive element; closes and returns focus to trigger
- **Score:** Impact(2) × Urgency(5) / Effort(2) = **5.0**

---

### H2-2: Keyboard arrow navigation in `TriageView`

- **File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`
- **What:** Add a `focusedCardIndex` state (or `useReducer`) to `TriageView` scoped to the "Needs you" section. When the section container receives keyboard focus (via a `tabIndex={0}` wrapper or the first card's focus), `↓` and `↑` arrow keys move `focusedCardIndex` through the `needs` array. The focused `AttnCard` receives a visible ring via a `data-keyboard-focused` prop that drives `ring-2 ring-[var(--mc-accent)]` on the card's outermost `div`. `Enter` on a focused card calls `onSelect(session.sessionId)`. `Y` on a focused card calls `send('yes')` directly via `QuickActions`' exposed send function (or by lifting the send call up). `Space` toggles `onToggleSelect`. This is local to the triage section — it does not affect `selectedSessionId` in `App.jsx` until Enter is pressed.
- **Why:** Diego (keyboard-first) and Mara (3-second approval path). The `quickApprove` shortcut in `App.jsx` exists but requires `selectedSessionId` to be set — which requires a prior mouse click on a session in the sidebar. A keyboard-first operator can tab to the triage list but has no way to move through it and approve items sequentially without a mouse.
- **Acceptance:**
  - Tab once to enter "Needs you" section → first card shows focus ring
  - `↓/↑` moves the ring through the needs list
  - `Y` on a focused card sends `yes` without opening session detail
  - `Enter` on a focused card navigates to session detail
  - `Space` toggles multi-select on the focused card
  - Mouse flow is completely unchanged
- **Score:** Impact(5) × Urgency(3) / Effort(3) = **5.0**

---

## Tier 3 — Horizon 2+ (score < 5)

Items below this line are real improvements but do not block today's governance use case or violate active WCAG criteria.

---

### H1-3: Add non-color secondary signals to status indicators

- **File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`
- **What:** In `AttnCard`, the ping dot communicates danger (red) vs warn (amber) by hue only. Add `ShieldAlert` (12px, `--mc-danger`) inline with the `DESTRUCTIVE` risk badge render path and `AlertTriangle` (12px, `--mc-warn`) for `CODE_EXECUTION`/`REQUIRES_REVIEW`. In `CalmRow`, the "done" vs "idle" dot is color-only (accent vs `--mc-fg-5`); add `CheckCircle2` (10px, `--mc-ok`) alongside the "done" dot. Note: the `RiskBadge` text labels already partially satisfy WCAG 1.4.1 for the risk tiers — these additions strengthen the signal and remove the last purely-color-only indicators.
- **Why:** Priya (WCAG 1.4.1 — Use of Color) and Mara (attention hierarchy).
- **Acceptance:** Risk tier distinguishable without hue differentiation; icons are 10–12px, consistent with existing `Clock`/`Cpu` usage; screen reader announces risk level on AttnCard focus
- **Score:** Impact(3) × Urgency(3) / Effort(2) = **4.5**

---

### H2-4: Add keyboard shortcut hints to QuickActions chips

- **Files:** `apps/cockpit/client/src/components/QuickActions.jsx`, `apps/cockpit/client/src/components/TriageView/TriageView.jsx` (section header), `apps/cockpit/client/src/components/ShortcutHelpOverlay.jsx`
- **What:** Add `title="Approve (Y)"` to the `yes` chip button (after H1-1 makes it a `<button>`), `title="Continue (C)"` to the continue chip. Add a `<kbd>` hint in the "Needs you" section header showing `↑↓ Y` on hover (after H2-2 implements arrow navigation). Update `ShortcutHelpOverlay` to include the new arrow + Y navigation shortcuts.
- **Why:** Diego (discoverability). Shortcuts exist and work; they're invisible at the surface.
- **Acceptance:** Hovering the `yes` chip shows "Approve (Y)" tooltip; shortcut overlay is current; no persistent UI chrome added
- **Score:** Impact(2) × Urgency(2) / Effort(1) = **4.0**

---

### H3-2: Anomaly ack → resolve workflow

- **Files:** `apps/cockpit/client/src/App.jsx` (lines 268–272 — the `setAnomalies` cap), `apps/cockpit/client/src/components/AnomalyToast.jsx`, new `apps/cockpit/client/src/components/AnomalyPanel.jsx`
- **What:** In `App.jsx`, remove the `.slice(-3)` cap on line 271 — replace with an unbounded store that tracks per-anomaly state (`new | acknowledged | resolved`). Dismissing a `ToastRow` marks the anomaly `acknowledged` (not deleted). Add an `AnomalyPanel` component (a slide-over or modal) triggered from a `Bell` icon in the header that shows all anomalies with their state, timestamp, and `resolve` action. The `Bell` carries a count badge for unacknowledged anomalies. Add `aria-live="assertive"` to the toast container for screen reader announcement.
- **Why:** Sam (ack → resolve pattern) and Priya (anomalies must persist for screen readers). Currently, a burst of 5 anomalies silently drops the first. A DESTRUCTIVE risk anomaly can be lost with zero trace.
- **Acceptance:** 10 anomalies in quick succession = 10 preserved; bell badge count accurate; dismiss = acknowledged not deleted; anomaly panel shows full history with timestamps; `aria-live="assertive"` on new anomaly injection
- **Note:** `AnomalyPanel` should be classified EXPERIMENTAL in `SCOPE.md` until full test pass
- **Score:** Impact(4) × Urgency(3) / Effort(4) = **3.0**

---

### H2-1: Command palette action mode (`>` prefix)

- **File:** `apps/cockpit/client/src/components/CommandPalette.jsx`
- **What:** When the query begins with `>`, switch the palette to action mode (tinted background, prompt changes to `> command…`). Parse the remainder as an action verb + optional qualifier. Supported verbs: `approve` (calls `sendQuickReply` from `App.jsx` on the first `needsInput` session), `continue` (same, posts `continue`), `steer [message]` (posts the message to the first active session). The existing `sessions` prop already carries the full session list including `needsInput` flags. Close palette + show status toast on success.
- **Why:** Diego (keyboard-first from any surface) and Sam (ack from any view). Current path to approve while viewing History: close palette → click Agents tab → find card → click chip — 4 steps. Action mode: `⌘K → > approve → Enter` — 3 keystrokes.
- **Acceptance:** `> approve` in palette posts `yes` to first needs-input session; action mode is visually distinct from search mode; existing search behavior unchanged when `>` absent; documented in `ShortcutHelpOverlay`
- **Score:** Impact(4) × Urgency(2) / Effort(3) = **2.67**

---

### H1-4: Migrate `FleetTab` to `--mc-*` tokens

- **Files:** `apps/cockpit/client/src/components/FleetTab/FleetTab.jsx`, `FleetRunDetail.jsx`, `LaunchDrawer.jsx`
- **What:** Replace all hardcoded Tailwind color literals in FleetTab. Confirmed hits in `FleetTab.jsx`: `text-gray-600` (line 100), `text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30` (line 106), `text-gray-600` (line 114), `bg-indigo-900/30 border-indigo-700` (lines 128–129), `text-gray-200` (line 134), `text-gray-600` (line 138), `bg-indigo-900/30 border-indigo-800/50` (line 157), `text-indigo-400` (line 158), `text-gray-100` (line 161), `text-gray-500` (line 164), `bg-indigo-600 hover:bg-indigo-500` (line 172). Replace with `--mc-*` token equivalents: selected state → `bg-[var(--mc-accent-soft)] border-[var(--mc-accent-line)]`; hover → `hover:bg-[var(--mc-surface-2)]`; text → `text-[var(--mc-fg)]` / `text-[var(--mc-fg-4)]`; CTA → `bg-[var(--mc-accent)] hover:opacity-90`.
- **Why:** Mara (visual coherence) and Sam (Fleet is where operators spend time at scale — it should honor the theme). The tron and warm themes currently leave Fleet looking like a different product.
- **Acceptance:** Switching to any of the 4 themes produces consistent Fleet colors; no `bg-indigo` or `text-indigo` or `text-gray` literals remain in the three files
- **Score:** Impact(2) × Urgency(2) / Effort(2) = **2.0**

---

### H2-3: Density mode for `TriageView`

- **File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`
- **What:** Add a `density` state (`'comfortable' | 'compact'`) persisted to `localStorage` as `mc.density`. A two-button toggle (comfortable/compact icon) in the TriageView header applies density classes via a context or prop drill: compact mode sets `AttnCard` to `p-2.5`, `RunningTile` to `p-2` with `text-[12px]` labels, `CalmRow` to `py-1.5`, and hides tool-count chips. Risk badges are never hidden regardless of density.
- **Why:** Sam (20+ agent fleet) and Diego (density preference). At 20 running agents the Running grid is a long scroll; compact mode fits the whole fleet on a 1440p monitor.
- **Acceptance:** `mc.density` persists across reload; compact mode hides tool chips but never risk badges; all three density levels render without overflow at 1280px width; toggle is a `<button>`, not a `<span>`
- **Score:** Impact(3) × Urgency(2) / Effort(3) = **2.0**

---

### H4-4: Split `ConversationView.jsx` (~920 LOC)

- **File:** `apps/cockpit/client/src/components/ConversationView.jsx`
- **What:** Extract four sub-components into separate files: `MessageList.jsx` (scrollable transcript with message rows), `ApprovalPanel.jsx` (pending approval UI — the most UX-sensitive section), `ToolUseBlock.jsx` (expandable tool call display), `MetadataStrip.jsx` (session metadata header). `ConversationView.jsx` becomes a thin coordinator under 200 LOC. Each sub-component gets at least one unit test covering its primary interaction.
- **Why:** Priya (focused components are independently auditable against her checklist) and Diego (maintainability = iteration speed). The 920 LOC monolith is flagged in both `CLAUDE.md` and `SCOPE.md` as a split candidate.
- **Acceptance:** `ConversationView.jsx` drops below 200 LOC; each sub-component independently importable and testable; existing `ConversationView` tests pass unchanged; each sub-component has ≥1 unit test
- **Score:** Impact(2) × Urgency(2) / Effort(3) = **1.33**

---

### H4-2: Define motion vocabulary

- **Files:** `apps/cockpit/client/src/index.css`, `apps/cockpit/client/src/components/TriageView/TriageView.jsx`
- **What:** In `TriageView.jsx`, `RunningTile` at line 169 uses `animate-ping` on the running-agent indicator — the same class as the needs-input (urgent) indicator. Replace with `animate-pulse` on `RunningTile`'s green dot only; `animate-ping` stays exclusively on `AttnCard`'s needs-input indicator. Document the vocabulary in `CLAUDE.md` (client section): `animate-ping` = urgent/requires-immediate-attention; `animate-pulse` = live/autonomous-activity; `transition-colors` = interactive affordance.
- **Why:** Mara (animation = attention direction). Currently both "I need you now" and "I'm just running" use the same blink animation — the urgent signal is diluted.
- **Acceptance:** `grep -n "animate-ping" src/components/` returns results only in AttnCard's needs-input indicator; `animate-pulse` appears on RunningTile; motion vocabulary documented in `CLAUDE.md`
- **Score:** Impact(2) × Urgency(1) / Effort(2) = **1.0**

---

### H3-1: Virtualize the Running grid (intersection observer)

- **File:** `apps/cockpit/client/src/components/TriageView/TriageView.jsx`
- **What:** Create a `useIntersectionObserver` hook that toggles `isVisible` when a container scrolls into the viewport. Wrap `RunningTile` cards with it: when `isVisible` is false, render a skeleton `<div>` at the same dimensions (no API call, no DOM subtree). The "Needs you" section mounts eagerly regardless. Add a "Show top 20 / Show all" toggle in the Running section header when `running.length > 20`, defaulting to top-20 sorted by `lastModified` descending.
- **Why:** Sam (20+ agent scale) and Diego (performance = product quality). At 30 running sessions, 30 simultaneous `useApi` calls fire on mount. This doesn't fail today but degrades meaningfully at scale.
- **Acceptance:** At 30 running sessions, initial page load fires ≤10 message API calls (only visible cards); scrolling reveals cards progressively without layout shift; "Show top 20" default hides older sessions with a count badge
- **Score:** Impact(3) × Urgency(1) / Effort(4) = **0.75**

---

### H3-3: Fleet dashboard grid view

- **File:** `apps/cockpit/client/src/components/FleetTab/FleetTab.jsx`
- **What:** Add a toggle between the current "List + Detail" layout and a new "Dashboard" mode showing all fleet runs as cards in a `grid-cols-2 lg:grid-cols-3` responsive grid. Each card: run goal, status (color + text label per H1-3 dual-coding), child progress bar (N of M settled), estimated cost, elapsed time, and escalation indicator. Persist mode to `mc.fleet.view`. Clicking a card opens the existing detail panel.
- **Why:** Sam (fleet management at scale) and Mara (visual scan path). At 20+ active runs the 224px sidebar list is not scannable.
- **Acceptance:** Dashboard mode shows all runs in 2–3 column grid without horizontal scroll at 1280px; each card has color + text label status; progress bar shows settled/total; list↔dashboard toggle preserves selected run
- **Score:** Impact(3) × Urgency(1) / Effort(4) = **0.75**

---

### H4-3: Onboarding flow for new teams

- **Files:** New `apps/cockpit/client/src/components/OnboardingFlow.jsx`, `apps/cockpit/client/src/components/WelcomeHero.jsx`
- **What:** A three-step `OnboardingFlow` component gated by a `mc.onboarded` localStorage flag (never shown after first completion or skip-all). Steps use the existing `Dialog.jsx`. Step 1: confirm first session is running (skip if `sessions.length > 0`). Step 2: one-screenshot explainer of the approval queue. Step 3: Fleet intro with a CTA that opens the Fleet tab. Each step is independently skippable.
- **Why:** Mara (empty state guidance). `WelcomeHero` is a good zero-sessions screen but provides no orientation for a team lead's first real session.
- **Acceptance:** `mc.onboarded` flag prevents re-show; all steps independently skippable; no trigger if sessions already exist on first load; "Skip setup" on step 1 ends the flow permanently
- **Score:** Impact(3) × Urgency(1) / Effort(4) = **0.75**

---

### H4-1: Full token audit — eliminate hardcoded semantic color literals

- **Files:** All components in `apps/cockpit/client/src/components/`
- **What:** Run `grep -rn "bg-amber\|bg-indigo\|bg-red\|bg-green\|text-amber\|text-indigo\|text-red\|text-green" apps/cockpit/client/src/components/`. Each hit: is it a semantic state? Replace with `--mc-warn`, `--mc-danger`, `--mc-ok`, `--mc-accent` tokens. Is it a one-off? Add a comment explaining the exception. The `QuickActions` amber/red/indigo literals (H1-1) and `FleetTab` (H1-4) are already handled by prior tasks — this is the sweep for the remainder.
- **Why:** Mara (visual coherence). The `--mc-*` token system exists precisely for this; hardcoded literals mean theme-switching produces a patchwork product.
- **Acceptance:** `grep` for `bg-amber\|bg-indigo\|bg-red` in `components/` returns zero non-commented hits (after H1-1 and H1-4 are done); all four themes render `QuickActions` with accent-toned chips
- **Score:** Impact(2) × Urgency(1) / Effort(3) = **0.67**

---

### H3-4: History tab timeline view

- **File:** `apps/cockpit/client/src/components/HistoryTab/HistoryTab.jsx`
- **What:** Add a fourth mode ("Timeline") via a mode toggle in the HistoryTab header. The timeline renders a horizontal time axis (user-selectable: 1h, 6h, 24h, 7d) with session spans as horizontal Gantt bars. Event markers (approvals, anomalies, session starts/stops) are plotted as vertical lines with hover tooltips. Implementation: `GET /api/search?limit=500` with time range filter is sufficient for the 1h window — no new server routes needed.
- **Why:** Sam (time axis is observability standard) and Mara (pattern recognition at a glance). There is currently no way to see "there was a burst of approvals at 2:30pm" without manually scanning the feed.
- **Acceptance:** Timeline renders for last 1h on a 5–20 session fleet; session bars labeled with truncated session names; event markers color-coded by type with accessible labels; time range selector works for 1h/6h/24h/7d
- **Note:** Depends on H3-1 (FTS5 corpus reliability) being solid first
- **Score:** Impact(2) × Urgency(1) / Effort(5) = **0.4**

---

## Loop Architecture workstream (new — 2026-06-28)

Provisioning track from [ADR-0009](../adr/0009-loop-architecture-skills.md): turn the four
loop-engineering designs (bossman, nethum-protocol, steven, johndavis) into installable MC
skills, Fleet templates, and Workflow definitions. Strategically high impact but off
today's governance critical path, so urgency scores are low.

---

### LA-1: Loop-architecture skills library — spec + ADR

- **Files:** `docs/adr/0009-loop-architecture-skills.md` (done), spec doc (TBD), `STATE.md`, `SCOPE.md`
- **What:** Author the spec that turns each loop design into a loop-deployment skill: what gets scaffolded into a target project (CLAUDE.md hooks, roster/state files, skill catalog, cron schedule), how the project registers with Fleet, and the three integration surfaces (Skills, Fleet templates, Workflow definitions). ADR-0009 records the decision; this task is the implementing spec + proof-of-concept scoping.
- **Why:** Establishes the provisioning direction — MC stops being observe-only and becomes an active provisioner. Foundation for LA-2/3/4.
- **Acceptance:** ADR-0009 accepted; spec enumerates the scaffold surface and the Fleet registration handshake for at least bossman; `SCOPE.md` classifies the new surface.
- **Score:** Impact(4) × Urgency(2) / Effort(3) = **2.67**

---

### LA-2: bossman skill — proof of concept

- **What:** First loop-deployment skill. Scaffolds the bossman loop (Node engine, daily/weekly crons) into a target project and registers it with Fleet. Most operator-friendly of the four — chosen as the PoC.
- **Why:** Proves the loop-deployment skill pattern end-to-end before generalizing to the harder architectures.
- **Acceptance:** Invoking the skill scaffolds a runnable bossman loop into a target project; the project appears in Fleet; agents it spawns surface in TriageView natively.
- **Score:** Impact(4) × Urgency(2) / Effort(3) = **2.67**

---

### LA-4: steven 5-stage Workflow definition

- **What:** Encode steven's Scope → Gather → Plan → Work → Verify pipeline as MC's first real multi-phase Workflow definition (Workflows were degenerate single-phase per ADR-0006).
- **Why:** Exercises the canonical phase model with a real multi-phase pipeline; low effort relative to its demonstration value.
- **Acceptance:** A Workflow definition runs the five stages in order with per-phase gating; visible in Runs.
- **Score:** Impact(3) × Urgency(1) / Effort(2) = **1.5**

---

### LA-3: Fleet templates for loop architectures

- **What:** Per-architecture Fleet templates that pre-configure wave structure and child caps (within the hard `MAX_FLEET_CHILDREN` / `HARD_REFUSE_CHILDREN` ceilings). Becomes the canonical way to provision a new agent project.
- **Why:** Turns Fleet from ad-hoc fan-out into a templated provisioner; the heaviest lift of the workstream.
- **Acceptance:** Selecting a template provisions a Fleet run with the architecture's wave structure; caps never exceed the hard ceilings.
- **Score:** Impact(4) × Urgency(1) / Effort(5) = **0.8**

---

## Score Summary

| ID | Task | Impact | Urgency | Effort | Score | Tier |
|----|------|--------|---------|--------|-------|------|
| H1-1 | QuickActions: `<span>` → `<button>` | 5 | 5 | 2 | **12.5** | 1 |
| H1-2 | SelectCheckbox `focus-visible:opacity-100` | 2 | 5 | 1 | **10.0** | 1 |
| H3-5 | Move Mesh to ADVANCED_TABS | 3 | 3 | 1 | **9.0** | 2 |
| H2-5 | Elapsed time in AttnCard + RunningTile | 4 | 3 | 2 | **6.0** | 2 |
| H1-5 | SelectionBar focus ring | 2 | 5 | 2 | **5.0** | 2 |
| H2-2 | Keyboard arrow navigation in TriageView | 5 | 3 | 3 | **5.0** | 2 |
| H1-3 | Non-color secondary status signals | 3 | 3 | 2 | 4.5 | 3 |
| H2-4 | Shortcut hints on chips | 2 | 2 | 1 | 4.0 | 3 |
| H3-2 | Anomaly ack → resolve workflow | 4 | 3 | 4 | 3.0 | 3 |
| H2-1 | Command palette action mode (`>`) | 4 | 2 | 3 | 2.67 | 3 |
| LA-1 | Loop-architecture skills library — spec + ADR | 4 | 2 | 3 | 2.67 | 3 |
| LA-2 | bossman skill — proof of concept | 4 | 2 | 3 | 2.67 | 3 |
| H1-4 | FleetTab token migration | 2 | 2 | 2 | 2.0 | 3 |
| H2-3 | TriageView density mode | 3 | 2 | 3 | 2.0 | 3 |
| LA-4 | steven 5-stage Workflow definition | 3 | 1 | 2 | 1.5 | 3 |
| H4-4 | Split `ConversationView.jsx` | 2 | 2 | 3 | 1.33 | 3 |
| H4-2 | Motion vocabulary | 2 | 1 | 2 | 1.0 | 3 |
| LA-3 | Fleet templates for loop architectures | 4 | 1 | 5 | 0.8 | 3 |
| H3-1 | Virtualize Running grid | 3 | 1 | 4 | 0.75 | 3 |
| H3-3 | Fleet dashboard grid | 3 | 1 | 4 | 0.75 | 3 |
| H4-3 | Onboarding flow | 3 | 1 | 4 | 0.75 | 3 |
| H4-1 | Full token audit | 2 | 1 | 3 | 0.67 | 3 |
| H3-4 | History timeline view | 2 | 1 | 5 | 0.4 | 3 |

---

## Top 3 — Code Session Briefs

These three items have the highest scores, the lowest effort, and are independent of each other. Each can be handed to a code session right now.

---

### 🥇 H1-1 — QuickActions button replacement (score 12.5)

**The problem:** Every approve/continue/reply action in Mission Control is implemented as a `<span role="button">` — no native keyboard semantics, Space key silently does nothing, no focus ring, touch targets approximately 24×16px at `text-[10px]` with `py-0.5` padding. This is a confirmed WCAG 4.1.2 (Name, Role, Value) violation on the product's single most critical interactive element. Additionally, all three chip variants use hardcoded Tailwind palette colors (`bg-amber-900/40`, `bg-red-900/50`, `bg-indigo-900/40`) that bypass the `--mc-*` theme cascade.

**What the code session should implement in `apps/cockpit/client/src/components/QuickActions.jsx`:**
1. Convert the `<span role="button" tabIndex={0}>` at line 55 (suggestion chip), the `<span>` in the `replies.map` at line 78, and the `<span role="button">` at line 98 (reply button) to `<button type="button">` elements.
2. Remove the `onKeyDown` handlers on all three (native `<button>` fires on both Space and Enter — no handler needed).
3. Add `focus-visible:ring-2 ring-[var(--mc-accent)] ring-offset-1 ring-offset-[var(--mc-surface)]` to every chip's className.
4. Change `py-0.5` to `py-1` on all chips to bring touch targets to ≥28px height.
5. Replace `bg-amber-900/40 text-amber-300 hover:bg-amber-800/60` (line 91) with `style` prop using `var(--mc-warn-soft)` / `var(--mc-warn)`.
6. Replace `bg-red-900/50 text-red-300` (line 90) with `var(--mc-danger-soft)` / `var(--mc-danger)`.
7. Replace `bg-indigo-900/40 text-indigo-300` (line 105) with `var(--mc-surface-2)` / `var(--mc-fg-3)` (the reply button is not a semantic state — muted neutral is correct).
8. Add a `<span aria-live="polite" aria-atomic="true" className="sr-only">` at the bottom of the component's return that shows the current send outcome so screen readers announce it.

---

### 🥈 H1-2 — SelectCheckbox focus visibility (score 10.0)

**The problem:** The `SelectCheckbox` component in `TriageView.jsx` (line 51–71) is structurally correct — it's a real `<button type="button" role="checkbox">` — but its unchecked state sets `opacity-0` with no `focus-visible` exception. A keyboard user tabbing through the triage card list lands on a fully invisible interactive element. This is WCAG 2.4.7 (Focus Visible) failure.

**What the code session should implement in `apps/cockpit/client/src/components/TriageView/TriageView.jsx`:**

The `SelectCheckbox` component renders this class string for the unchecked button (line 64):
```
'text-[var(--mc-fg-4)] opacity-0 hover:text-[var(--mc-fg-2)] group-hover:opacity-100'
```

Change it to:
```
'text-[var(--mc-fg-4)] opacity-0 hover:text-[var(--mc-fg-2)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--mc-accent)]'
```

That is the entire change. Verify the fix works for both `AttnCard` (which passes `SelectCheckbox` in the card header, line 104) and `RunningTile` (which uses it as an absolute-positioned overlay, lines 156–158) — both use the same component, so the single change covers both.

---

### 🥉 H3-5 — Move Mesh to ADVANCED_TABS (score 9.0)

**The problem:** `Mesh` is `CORE_TABS[1]` — the second tab in the default navigation for every user of Mission Control. It is a live packet-flow network visualization of tool calls between agents: a powerful debug tool, not a daily operational surface. A new user or team lead opens Mission Control and sees six tabs: Agents, **Mesh**, Tasks, Runs, Fleet, History. Mesh reads as primary operational UI and competes for attention with the Agents tab (the actual hero view).

**What the code session should implement:**

1. **`apps/cockpit/client/src/App.jsx`** — Move the `{ id: 'mesh', label: 'Mesh', icon: Network }` entry out of `CORE_TABS` (lines 65–72) and into `ADVANCED_TABS` (lines 74–78). This is a one-line move.

2. **`SCOPE.md`** — Add `MeshView/` to the EXPERIMENTAL classification section (or the equivalent block where V3 features are listed). The CLAUDE.md already flags mesh as a "V3 hook instrumentation feature."

3. **`apps/cockpit/client/src/tests/coreTabs.test.js`** — Add a test that pins the exact CORE tab manifest:
   ```js
   it('CORE_TABS contains exactly the five operational tabs', () => {
     expect(CORE_TABS.map((t) => t.id)).toEqual(['agents', 'tasks', 'runs', 'fleet', 'history'])
   })
   ```
   This ensures no future change silently re-promotes a debug surface to CORE without a test failure.

The `Network` import in `App.jsx` can remain — it's still used for `ADVANCED_TABS`. No component code changes. No CSS changes. Total diff: ~5 lines plus the test.

---

_Next update due after Sprint 1 retro. Completed items should be marked ✅ and the score table updated._
_Roadmap owners: UX Think Tank. Engineering liaison: whoever touches `apps/cockpit/client/`._
