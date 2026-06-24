# MeshView — Goal Spec for Claude Code

> Add the Mesh topology tab to Oversight's cockpit client.
> **Read CLAUDE.md before starting.** Run tests first: `npm run test:cockpit` — must pass at baseline.
> This spec is additive: no existing component or behaviour changes. New files only (plus 3 targeted edits to `App.jsx`).

---

## 1. OUTCOME

When complete, all of the following must be true:

1. A **Mesh** tab appears in the cockpit's top nav between **Agents** and **Tasks**.
2. Clicking **Mesh** renders a live SVG canvas showing all sessions as nodes connected to a central Dispatch hub. Active sessions pulse; idle sessions are dimmed; done sessions are very dim.
3. Animated packets travel along edges from active sessions toward Dispatch, giving a live "traffic" feel without needing any new API data.
4. Clicking any node slides a **detail panel** in from the right showing: session name, status, cost, tool count, and a button that switches to the Agents tab and selects that session.
5. The detail panel closes on Escape or clicking the canvas.
6. All `--mc-*` CSS variables are used for every colour, background, and border — no hardcoded hex values. The view must look correct in all four themes (classic, calm, tron, warm).
7. All existing tests still pass (`npm run test:cockpit` exit 0).
8. The component renders without console errors when there are 0 sessions, 1 session, or 82 sessions.

---

## 2. VERIFICATION

After completing each step, run:
```bash
npm --prefix apps/cockpit test:client
```
Exit code must be 0.

At the end of the run, also run:
```bash
npm run test:cockpit
```
Full suite (server + client) must pass.

**Smoke test for the UI (manual, run once before committing the final step):**
```bash
npm run up
# Open http://localhost:5173
# Click "Mesh" tab
# Verify: nodes visible, packets animating, no console errors
# Click a node — verify detail panel slides in
# Press Escape — verify panel closes
# Switch theme via Settings — verify colours update (no hardcoded hex)
```

**New client test file to create: `src/tests/components/MeshView.test.jsx`**

Required assertions:
```js
// renders without crash — 0 sessions
render(<MeshView sessions={[]} sessionsVersion={0} onSelectSession={() => {}} />)
expect(screen.getByRole('img')).toBeInTheDocument()  // the SVG has role="img"

// renders correct node count — N sessions = N+1 nodes (sessions + Dispatch hub)
const sessions = [
  { id:'a', projectLabel:'alpha', status:'running', totalCost:1.5,  toolCount:3 },
  { id:'b', projectLabel:'beta',  status:'idle',    totalCost:0.8,  toolCount:1 },
]
render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)
expect(document.querySelectorAll('[data-node]').length).toBe(3) // 2 + dispatch hub

// detail panel hidden by default
expect(document.querySelector('[data-panel]')).not.toHaveClass('open')

// click a node — panel opens
fireEvent.click(document.querySelectorAll('[data-node]')[1])
expect(document.querySelector('[data-panel]')).toHaveClass('open')

// Escape closes panel
fireEvent.keyDown(document, { key: 'Escape' })
expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
```

---

## 3. TECHNICAL SPECIFICATION

### 3.1 — Files to create

```
apps/cockpit/client/src/components/MeshView/
  MeshView.jsx        ← main component
  MeshView.css        ← scoped styles (imports --mc-* only)
  index.js            ← re-export: export { MeshView } from './MeshView.jsx'
apps/cockpit/client/src/tests/components/MeshView.test.jsx
```

### 3.2 — Component signature

```jsx
// Named export
export function MeshView({ sessions = [], sessionsVersion, onSelectSession }) { }

// Props:
//   sessions         — array from GET /api/sessions, already fetched in App
//   sessionsVersion  — integer; changes when sessions data changes (triggers re-layout)
//   onSelectSession  — (sessionId: string) => void
//                      call this when user clicks "Open in Triage" in the detail panel
//                      App.jsx will: setActiveTab('agents'); setSelectedSessionId(id)
```

### 3.3 — Session data shape

Read the shape from the live endpoint before writing layout code:
```bash
curl http://localhost:3001/api/sessions | head -c 2000
```

Defensive field access — always use `?? fallback`:
- Name:   `session.projectLabel ?? session.name ?? 'Session'`
- Status: `session.status ?? 'idle'`  (values: 'running' | 'idle' | 'done' | 'error')
- Cost:   `session.totalCost ?? session.cost ?? 0`   (number, USD)
- Tools:  `session.toolCount ?? 0`

### 3.4 — Layout algorithm (radial tiers)

Do not use force-directed. Use a deterministic 3-tier radial layout computed once on mount and re-computed when `sessionsVersion` changes.

```
Tier 0 (centre):   Dispatch hub — always at (cx, cy)
Tier 1 (r = 35%):  Active sessions (status === 'running')
Tier 2 (r = 62%):  Idle / recent sessions (status === 'idle')
Tier 3 (r = 82%):  Done sessions (status === 'done' | 'error') — very dim, opacity 0.25
```

Radial placement:
```js
function layoutNodes(sessions, W, H) {
  const cx = W / 2, cy = H / 2;
  const tiers = { running: [], idle: [], done: [], error: [] };
  sessions.forEach(s => (tiers[s.status] ?? tiers.idle).push(s));

  const radii = { running: Math.min(W, H) * 0.32,
                  idle:    Math.min(W, H) * 0.56,
                  done:    Math.min(W, H) * 0.76 };

  const placed = [{ id: '__dispatch', x: cx, y: cy, tier: 0 }];

  ['running', 'idle', 'done'].forEach(tier => {
    const nodes = [...(tiers[tier] ?? []), ...(tier === 'done' ? (tiers.error ?? []) : [])];
    const r = radii[tier];
    nodes.forEach((s, i) => {
      const angle = (2 * Math.PI * i / nodes.length) - Math.PI / 2;
      placed.push({ ...s, x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), tier: ['running','idle','done'].indexOf(tier) + 1 });
    });
  });

  return placed;
}
```

Re-run layout in a `useMemo` keyed on `[sessionsVersion, containerWidth, containerHeight]`.
Use a `ResizeObserver` (or `useRef` + resize event) to track container dimensions.

### 3.5 — Node rendering

Draw with SVG (not Canvas). Each node is a `<g data-node={session.id}>` group.

| Status   | Shape    | Radius | Opacity | Pulse ring |
|----------|----------|--------|---------|------------|
| running  | circle   | 20px   | 1.0     | yes        |
| idle     | circle   | 16px   | 0.65    | no         |
| done     | circle   | 13px   | 0.25    | no         |
| error    | circle   | 16px   | 1.0     | no         |
| Dispatch | diamond  | 26px   | 1.0     | yes        |

Colours from CSS variables:
```
running  → var(--mc-ok)          stroke, pulse ring colour
idle     → var(--mc-fg-4)
done     → var(--mc-fg-5)
error    → var(--mc-danger)
Dispatch → var(--mc-accent)
```

Fill = colour at 15% opacity (`color-mix(in srgb, var(--mc-ok) 15%, transparent)` or inline rgba).
Stroke = colour at full opacity, stroke-width 1.5px (running: 2px).

Pulse ring: `<circle>` with same centre, r = nodeRadius + 8, stroke = colour 20% opacity, no fill.
Animate with a CSS `@keyframes pulse` on opacity 0.6 → 0 → 0.6 over 2.4s.

Label: `<text>` 10px, `var(--mc-fg-3)`, below the node (y offset = radius + 13px), truncated to 16 chars.
Cost badge: `<text>` 8.5px, `var(--mc-fg-5)`, below label if cost > 0. Format: `$4.91`.

### 3.6 — Edges

One `<line>` per session connecting it to the Dispatch hub.

```
stroke:       var(--mc-border-2)
stroke-width: 1px (running: 1.5px)
opacity:      0.5 (running), 0.25 (idle), 0.1 (done)
```

No SVG filters, no gradients.

### 3.7 — Packet animation

Animate small dots traveling from each **running** session toward Dispatch.

```js
// State: array of packet objects
// { id, fromX, fromY, toX, toY, t (0→1), speed, col }

useEffect(() => {
  let raf;
  const step = () => {
    setPackets(prev => {
      // Advance existing packets
      const next = prev
        .map(p => ({ ...p, t: p.t + p.speed }))
        .filter(p => p.t < 1);
      // Spawn new packets from running sessions occasionally
      if (Math.random() < 0.04 && runningNodes.length) {
        const src = runningNodes[Math.floor(Math.random() * runningNodes.length)];
        const hub = nodes.find(n => n.id === '__dispatch');
        if (src && hub) next.push({
          id: Math.random().toString(36).slice(2),
          fromX: src.x, fromY: src.y, toX: hub.x, toY: hub.y,
          t: 0, speed: 0.006 + Math.random() * 0.004,
          col: 'var(--mc-ok)',
        });
      }
      return next;
    });
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}, [nodes]); // re-register when layout changes
```

Render: `<circle cx={lerp(p.fromX,p.toX,p.t)} cy={lerp(p.fromY,p.toY,p.t)} r={2.5} fill={p.col} opacity={0.8} />`

Cap total packets at 12 to keep the RAF loop cheap.

### 3.8 — Detail panel

A `<div data-panel>` absolutely positioned on the right edge, sliding in via CSS transition.

```css
.mesh-panel {
  position: absolute; top: 0; right: 0; bottom: 28px; /* above status bar */
  width: 300px;
  transform: translateX(100%);
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  background: var(--mc-surface);
  border-left: 1px solid var(--mc-border);
  z-index: 10;
}
.mesh-panel.open {
  transform: translateX(0);
}
```

Panel contents:
- Session name (bold, `--mc-fg`)
- Status chip (colour-coded `--mc-ok` / `--mc-warn` / `--mc-fg-4`)
- Cost: `$X.XX` (`--mc-fg-2`)
- Tool calls: integer count
- Divider
- Button: **"Open in Triage"** — calls `onSelectSession(session.id)` then closes panel
- Button: **"✕ Close"** — closes panel

State: `const [selected, setSelected] = useState(null)`. Panel is open when `selected !== null`.

Click on a node sets `setSelected(session)`. Click on SVG background (not a node) sets `setSelected(null)`. Escape key also closes.

The SVG must have `role="img"` and an `aria-label="Agent topology mesh"` for accessibility.
Each node group must have `aria-label={session.projectLabel}` and `tabIndex={0}`.

### 3.9 — Status bar

A fixed 28px bar at the bottom of the canvas (inside the component, not the app shell):

```
  ● N running    ·    N idle    ·    N done    ·    total $X.XX
```

Use `--mc-fg-5` for text, `--mc-ok` / `--mc-fg-4` / `--mc-fg-5` for the coloured dots.

---

## 4. APP.JSX EDITS (exact locations)

### Edit 1 — Add to CORE_TABS (around line 59–75)

Import the icon (use `Network` from lucide-react, or `Cpu` if Network isn't available):
```js
import { ..., Network } from 'lucide-react'
```

Add entry after the `agents` entry:
```js
{ id: 'mesh', label: 'Mesh', icon: Network },
```

### Edit 2 — Add render block (around line 691–751, after the agents block)

```jsx
{activeTab === 'mesh' && (
  <ErrorBoundary>
    <MeshView
      sessions={sessions}
      sessionsVersion={sessionsVersion}
      onSelectSession={(id) => {
        setActiveTab('agents')
        // If App has a selectedSessionId state, set it here.
        // If not, skip — the Triage view will show the session in the list.
      }}
    />
  </ErrorBoundary>
)}
```

Import at top:
```js
import { MeshView } from './components/MeshView/index.js'
```

### Edit 3 — No new SSE handlers needed

`sessions` is already fetched and `sessionsVersion` already increments on `session_update`. The MeshView receives both as props and re-layouts automatically.

---

## 5. CONSTRAINTS (must not change)

- **No existing components modified** except `App.jsx` (3 targeted edits above — nothing else).
- **No new API routes.** MeshView uses the existing `/api/sessions` data via props.
- **No new backend changes.** This is a pure client addition.
- **`TriageView` remains the default Agents view.** Do not change which sub-view opens by default in the Agents tab. Do not demote Triage.
- **Coverage thresholds must not drop.** Adding a test file is required; it must meaningfully test the component.
- **No hardcoded hex colours.** Every colour must use a `--mc-*` CSS variable.

---

## 6. BOUNDARIES (what you may touch)

**May create:**
- `apps/cockpit/client/src/components/MeshView/MeshView.jsx`
- `apps/cockpit/client/src/components/MeshView/MeshView.css`
- `apps/cockpit/client/src/components/MeshView/index.js`
- `apps/cockpit/client/src/tests/components/MeshView.test.jsx`

**May modify (targeted edits only):**
- `apps/cockpit/client/src/App.jsx` — CORE_TABS array, render block, import

**Must not touch:**
- `packages/contracts/`
- `packages/harness/`
- `apps/cockpit/server/`
- Any existing client component
- `CLAUDE.md`, `GOALS_MESH_V1.md`

---

## 7. IMPLEMENTATION PLAN

#### Step 0 — Baseline
```bash
npm run test:cockpit
# Must pass. If not, stop.
git add -A && git commit -m "chore: snapshot before MeshView"
```

#### Step 1 — Scaffold MeshView
Create the three files (MeshView.jsx, MeshView.css, index.js) with a minimal component that renders an `<svg role="img" aria-label="Agent topology mesh">` and a `<div data-panel>`. No layout logic yet — just the shell.

Add to `App.jsx` (Edits 1 + 2). Verify the tab appears and the empty SVG renders without errors.

```bash
npm --prefix apps/cockpit test:client
git add -A && git commit -m "feat(mesh): scaffold MeshView tab — empty canvas"
```

#### Step 2 — Layout + static nodes
Implement `layoutNodes()` and render nodes (circles, diamond for Dispatch, labels, cost badges).
No animation yet. Verify correct node count renders.

```bash
npm --prefix apps/cockpit test:client
git add -A && git commit -m "feat(mesh): radial tier layout with static nodes"
```

#### Step 3 — Edges + packet animation
Add edge lines. Add the RAF packet animation loop. Cap packets at 12.

```bash
npm --prefix apps/cockpit test:client
git add -A && git commit -m "feat(mesh): edges and packet animation"
```

#### Step 4 — Detail panel
Implement the slide-in panel, Escape key handler, and `onSelectSession` callback.

```bash
npm --prefix apps/cockpit test:client
git add -A && git commit -m "feat(mesh): detail panel with session info and triage link"
```

#### Step 5 — Tests + polish
Write `MeshView.test.jsx` with all required assertions. Add status bar. Verify theme switching works (no hardcoded colours). Run full suite.

```bash
npm run test:cockpit
# Must pass all suites
```

Smoke test the UI manually (see §2). Then commit:
```bash
git add -A && git commit -m "feat(mesh): tests, status bar, theme-safe — MeshView complete"
```

---

## 8. ITERATION POLICY

1. One step at a time. Commit only on green tests.
2. If a step fails twice: revert and try a simpler implementation (e.g. if force-directed layout breaks, fall back to the simple radial tier).
3. If tests break due to missing mock (ResizeObserver, requestAnimationFrame): add minimal vitest mocks at the top of the test file — do not stub inside the component.
4. If the `Network` icon isn't in lucide-react: use `Cpu`, `Share2`, or `Radio` — check availability with: `grep -r "export.*Network" node_modules/lucide-react/dist/ | head -3`
5. Write `BLOCKER.md` and stop if any step fails 3 times.

---

## 9. STOPPING CONDITIONS

**Done when:**
- `npm run test:cockpit` exits 0
- Mesh tab visible and functional in browser
- Detail panel opens/closes correctly
- No hardcoded colours
- `git log --oneline -6` shows all 5 feature commits

**Write `MESH_V1_SUMMARY.md` containing:**
- Status (COMPLETE / PARTIAL / BLOCKED)
- Commit hash
- Test count
- Any deviations from spec and why
- Screenshot path (if you used Playwright to capture one)
