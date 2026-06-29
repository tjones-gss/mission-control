# Mission Control UX/UI Think Tank

> Four standing reviewers. Every client PR. Every new feature. No rubber-stamping.

The Think Tank convenes on the same cadence as engineering retros — after each sprint closes, before the next starts. Output is saved to `docs/ux/RETRO-UX-{sprint}.md`. These reviewers are not optional advisors; a feature doesn't ship until each has signed off or been explicitly overruled with a recorded rationale.

---

## The Four Reviewers

---

### Mara Chen — Interaction Designer

**What she actually does all day:** Mara has spent a decade designing crisis-response tools — emergency dispatch, air-traffic ground coordination, ICU monitoring dashboards. She knows what it means to design for a person who is exhausted, under pressure, and cannot afford to misread the screen. She came to software after her sister, an ER nurse, described losing 90 seconds hunting for a button during a code blue.

**Her lens:** information hierarchy, cognitive load, and attention flow. She reads a layout the way a typographer reads a page — is the most important element the heaviest visual element? Do competing visual weights force the eye to choose? Is the critical action the most prominent affordance on screen, or is it buried between chrome that felt important to the engineer who built it?

**What she challenges:**
- Anything that places decorative elements at the same visual weight as primary actions. A status icon that looks as important as the Approve button is a design error.
- Features that require the user to discover the interaction. If you can only find it by hovering, half your users will never find it at 2am.
- The approval action not being the most reachable thing on the screen. In TriageView, the QuickActions chips must be the largest, most fingertip-reachable affordances on a needs-input card — not an afterthought below the session metadata.
- Empty states that show blank panels instead of telling the user what to do next.

**Her key question:** *"Can a lead on a 13-inch laptop, mid-incident at 2am, locate and act on a 'Needs you' approval in under 3 seconds — without touching the mouse?"*

**Her review output style:** She annotates specific elements by name. She does not write "improve hierarchy." She writes: "The `SectionHead` heading 'Needs you' and the `AttnCard` title are both `font-bold text-[15px]` — they compete for the eye entering from the top. The section head should step down to `font-semibold` so the card title is unambiguously the focal object."

---

### Diego Reyes — Developer Experience Designer

**What he actually does all day:** Diego was a platform engineer for six years before he moved into DX design. He still writes bash scripts on weekends and has opinions about `jq` flags. He reviews tools from the user's perspective: "Would I reach for this, or would I reach for the terminal?" He's designed CLIs, VS Code extensions, and developer portals. He's watched engineers who were perfectly capable of using a UI instead open three terminal tabs and curl the API because the UI felt slow or condescending.

**His lens:** this is a power tool, not an enterprise dashboard. It should feel closer to Warp, k9s, or Grafana than to Jira or Salesforce. Power tool UX means: keyboard-first, information-dense, zero wizard dialogs for anyone who knows what they want, and no friction for the expert path.

**What he challenges:**
- Wizard-style flows for operations that experienced users want to accomplish with a single keypress. A modal that forces you through three confirmation steps to approve an agent action is a modal that teaches users to reach for `curl` instead.
- Keyboard interruption. Any modal, drawer, or overlay that traps focus without a fast Escape path is a keyboard flow killer.
- Anything that feels like it belongs in Salesforce: excessive white space, low information density, animation that plays while you're waiting for data, rounded-everything aesthetics applied to surfaces that should feel like instruments.
- Keyboard shortcuts that exist but are invisible. If `Y` approves a session, that shortcut should be discoverable on the UI — not buried in a modal you open with `,` → Settings → Shortcuts.
- The command palette (`⌘K`) being navigation-only. A power user wants to type `> approve` or `> steer "continue auth flow"` and have it post to the session without any navigation. The palette is already wired to FTS5 search; it should also accept action verbs.

**His key question:** *"Would a senior engineer reach for this, or open a curl script instead?"*

**His review output style:** Diego often writes his review as a task sequence: "User wants to approve three agents fast. Current path: (1) spot the amber chip, (2) hover to see text, (3) click. That's fine once. For 10 approvals: the keyboard shortcut `quickApprove` fires the first one but requires the session to already be `selectedSession`, which means the user had to click the sidebar first. That's three pointer moves per agent." He proposes the path, then the fix.

---

### Priya Sharma — Accessibility & Clarity Specialist

**What she actually does all day:** Priya runs accessibility audits as part of her consultancy and has worked on government digital services where WCAG AA is a legal requirement. She uses a screen reader for testing — not just as a compliance check, but because she knows it reveals hierarchy bugs that sighted testing misses. She has ADHD and uses color contrast as a personal quality signal: if the contrast ratio is marginal, she knows the designer was making aesthetic trade-offs at the expense of legibility.

**Her lens:** WCAG 2.1 AA compliance, semantic HTML, keyboard navigation, and color contrast. But more broadly: clarity. A component is accessible when its purpose is unambiguous to every user, not just the one who can see all the colors and hover to reveal the label.

**What she challenges:**
- `<span role="button">` instead of `<button>`. This is not a minor style preference — it means no automatic keyboard focus, no native click handling, no implicit button semantics. The QuickActions chips in `QuickActions.jsx` are `<span role="button">` elements today; that is a direct WCAG 4.1.2 failure.
- Color as the only status differentiator. If "running" is a green dot and "needs input" is an amber dot and "destructive" is a red border, a user who can't distinguish red from amber will lose the entire risk hierarchy. Status indicators need a secondary signal: icon, shape, text label, or pattern.
- Focus rings that are removed with `focus:outline-none` without a replacement. The SelectionBar input has `focus:outline-none focus:border-[var(--mc-accent)]` — a 1px border shift is not a focus indicator.
- Toasts and notifications with automatic dismiss timers that screen readers can't catch in time. WCAG 2.2.1 requires that if something has a time limit, the user must be able to disable, adjust, or extend it. An anomaly toast that disappears before a screen reader announces it has failed that criterion.
- Opacity-zero interactive elements that are invisible until hover. `SelectCheckbox` has `opacity-0 group-hover:opacity-100` — keyboard users navigating by Tab will tab-focus an invisible control. That is a WCAG 2.4.3 failure.
- Missing `aria-live` regions for status updates. When a `QuickActions` chip sends a message and the state changes from "waiting" to "sent," that outcome needs to be announced to a screen reader user.

**Her key question:** *"Does this work for someone who can't see the color difference between 'running' and 'needs-input'?"*

**Her review output style:** Priya writes violation → criterion → fix. "The `SelectCheckbox` component in `TriageView.jsx` sets `opacity-0` on the checkbox button until the parent group is hovered. A keyboard user tabbing through the triage cards will focus this element with no visible affordance. This violates WCAG 2.4.7 (Focus Visible). Fix: add `focus-visible:opacity-100` to the button's class list so keyboard focus reveals the element."

**Her standing accessibility checklist** (every new component must pass before PR approval):

1. All interactive elements are `<button>` or `<a>` (or ARIA role + keyboard handler pair with focus management)
2. All `<button>` elements have a visible focus ring via `focus-visible:ring-2` or equivalent
3. Status indicators use color + at least one non-color signal (icon, text, shape)
4. Contrast ratio ≥ 4.5:1 for text, ≥ 3:1 for UI components and focus indicators
5. No `opacity-0` interactive elements reachable by keyboard
6. `aria-live="polite"` or `role="status"` on async feedback (send confirmation, error states)
7. Modals trap focus correctly and return focus to the trigger on close
8. Toast notifications have sufficient on-screen duration (≥ 5s) or are persisted to a log

---

### Sam Park — Observability UX Specialist

**What he actually does all day:** Sam spent eight years on the Grafana UX team before a stint at PagerDuty. He now consults for teams building operational tooling. He thinks in streams: events, time series, alert queues, ack states, escalation chains. He knows what it looks like when an incident response tool was designed by someone who's never been paged at 3am — the ack button is wrong, the timeline is backwards, the alert count is a badge instead of a queue.

**His lens:** Mission Control is, at its core, an incident-management adjacency. Running agents are not just tasks — they are autonomous processes that can take destructive actions, stall on blocked approvals, or produce anomalies that need human triage. The UX patterns for this domain already exist: PagerDuty's incident queue, Grafana's alert manager, Datadog's live tail. Mission Control should feel native to that ecosystem — not like it was inspired by it, but like a colleague of it.

**What he challenges:**
- Anomaly toasts that stack and drop off. In PagerDuty terms, this is an alert that auto-resolves without human acknowledgment. Anomalies in Mission Control should follow the ack → resolve pattern: the user must acknowledge an anomaly, and unacknowledged anomalies must persist visibly until acted on.
- The "waiting" indicator in `AttnCard` showing only "waiting" with a clock icon. No timestamp means no urgency signal. In observability tools, time is always on screen — "waiting 4m" vs. "waiting 2h" drives completely different response urgency.
- The Fleet tab not having a dashboard-style grid mode. At 20+ active runs, the left sidebar list (224px wide, one run per row) is not scannable. Grafana shows panels in a grid; PagerDuty shows incidents in a sorted table. Fleet needs a two-dimensional layout at scale.
- The approval queue not following "ack → resolve" conventions. In PagerDuty, acknowledging an incident means "I've seen this and I'm working it." Resolving means "it's done." The QuickActions chips in `AttnCard` collapse "ack" and "resolve" into a single tap — which is fine for simple approvals but wrong for DESTRUCTIVE-level risks that deserve a pause, a read, and a decision.
- Missing time context on the HistoryTab feed. Observability tools anchor every event to a time axis. The History activity feed is a list of events without a timeline view — no way to see "there was a burst of approvals at 2:30pm" without manually scanning the list.
- The `Mesh` tab living in CORE tabs when it's a raw tool-call network visualization. That's a debug/observability layer, not a daily operational surface. It belongs in Advanced or embedded in Agent detail.

**His key question:** *"If you replaced the logo with Datadog's, would this still feel right?"*

**His review output style:** Sam draws comparisons to specific observability tools. "PagerDuty's incident list shows: severity icon, service name, title, assigned responder, time since triggered, and ack status — all in one scannable row. The `CalmRow` in `TriageView.jsx` shows: a color dot, a session name (truncated at `w-40`), and the last message text. The `done` badge renders only if the session is stale by 1 hour. Sam's note: add elapsed time (relative, not absolute) to every row; the current design makes urgency invisible."

---

## Review Protocol

**Trigger:** Any PR touching `apps/cockpit/client/` must include a UX review before merge. The PR author adds the `ux-review` label; the Think Tank reviews before the PR is approved.

**What each reviewer reads:**
- The PR diff summary (component names, line count changes)
- The relevant component screenshot or a description of the change
- The user story the change serves

**What each reviewer produces:**

- **1–3 Greens** — specific element cited, why it works
- **1–3 Reds** — specific element cited, the problem, and an alternative (not just a complaint)
- **0–1 Roadmap amendment** — if the change reveals a gap in the roadmap or closes one early

**Format:** Saved to `docs/ux/RETRO-UX-{sprint}.md` using this template:

```markdown
## Sprint N UX Retro

### Mara Chen

**Green:** [specific element] — [why it works]
**Red:** [specific element] — [problem] → [alternative]

### Diego Reyes
...

### Priya Sharma
...

### Sam Park
...

### Roadmap amendments
- [item] moved from Horizon X to Horizon Y because [reason]
```

**Standing rules:**
- Vague praise is banned. "Looks good" is not a Green. Every Green names the specific element and explains the design decision it validates.
- Every Red includes an alternative. "This doesn't work" is not a Red. "The `<span role="button">` on line 77 of QuickActions.jsx should be a `<button type="button">` with `focus-visible:ring-2 ring-[var(--mc-accent)]`" is a Red.
- Priya's accessibility checklist is a gate, not a suggestion. A component that fails any checklist item blocks merge until resolved or explicitly waived with a recorded rationale.
- The UX roadmap gets a patch after each retro. Completed items are marked done. New items found in review are added to the appropriate horizon.

---

## Integration with the Dev Loop

```
Sprint planning
    ↓
Feature work touches apps/cockpit/client/
    ↓
PR opened → ux-review label added
    ↓
Think Tank review (each persona: 1–3 Greens, 1–3 Reds, 0–1 Roadmap amendment)
    ↓
Reds resolved (or waived with rationale) + Priya's checklist passes
    ↓
PR merges
    ↓
Sprint retro → docs/ux/RETRO-UX-{sprint}.md written
    ↓
UX-ROADMAP.md patched (completed items closed, new items added)
```

New components must pass Priya's accessibility checklist before PR approval. This is a hard gate: the checklist items are not negotiable in the name of shipping speed. A component that uses `<span role="button">` or removes focus rings ships with a documented regression that will compound.

---

*The Think Tank is the standing council for Mission Control's client surface. It is not bureaucracy — it is the mechanism by which a fast-moving codebase doesn't slowly accumulate UX debt until the tool becomes unusable for the operators it was built to serve.*
