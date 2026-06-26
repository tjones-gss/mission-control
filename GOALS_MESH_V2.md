# GOALS_MESH_V2 — MeshView Clarity Pass

**One-line goal:** Make MeshView immediately readable by filtering noise, encoding activity into visual weight, and eliminating panel competition.

**Success criteria:** Opening the Mesh tab with 20+ historical sessions shows only the 2-4 active/recent ones by default, active nodes are visually dominant, and the layout doesn't compete with itself.

---

## §1 Outcome — Three Deliverables

### 1.1 Recency Filter
- MeshView shows only sessions active within the last **24 hours** by default
- A toggle control ("Active · All") in the MeshView header switches between filtered and full view
- "Active" = `isActive === true` OR `lastActivity` timestamp within 24h
- Filter is client-side only — no backend changes, no new API calls
- When filtered view is empty (no recent sessions), show a friendly empty state: "No active sessions in the last 24h — switch to All to see history"

### 1.2 Activity-Tiered Node Sizing
Replace the current uniform node radius with three tiers based on session state:

| Tier | Condition | Node radius | Opacity | Label |
|------|-----------|-------------|---------|-------|
| Active | `isActive === true` | 28px | 1.0 | Always visible |
| Recent-idle | `isActive === false` AND lastActivity < 24h | 16px | 0.7 | On hover |
| Old | lastActivity ≥ 24h (visible in "All" mode only) | 6px | 0.3 | Hidden |

- Active nodes pull toward center in the radial layout (inner tier)
- Recent-idle nodes occupy the middle tier
- Old nodes collapse to the outer arc as small dots
- The orchestrator/center node (Dispatch) keeps its diamond shape, scales to 36px when sessions are active

### 1.3 Right Log Panel → Node-Detail Drawer
When the Mesh tab is active, the right event log panel is replaced by a **node-detail drawer** that slides in from the right when a node is clicked:

- Default state (no node selected): right panel is hidden, canvas gets full width
- Node clicked: detail drawer slides in (same width as current right panel), showing:
  - Session name, status, model, cost
  - Last 5 tool calls from the session
  - "Open in Triage" link (calls `onSelectSession`)
  - Close button (X) to dismiss
- The existing slide-in detail panel (already built in V1) is the foundation — adapt it to this drawer pattern rather than rebuilding

If hiding the right log panel is architecturally complex (it's rendered by App.jsx, not MeshView), an acceptable fallback is: MeshView renders its own full-width canvas area with an internal right drawer, and the App-level log panel is suppressed via CSS when `activeTab === 'mesh'`. Add a `data-tab="mesh"` attribute to the App container when Mesh is active and use a CSS rule in `MeshView.css` to handle it.

---

## §2 Verification

The existing test suite must pass. Add tests for:

**Filter tests** (`MeshView.test.jsx`):
- `renders only active/recent sessions when filter is "active"` — pass 5 sessions (2 active, 1 recent-idle, 2 old), confirm only 3 nodes rendered
- `shows all sessions when filter is "all"` — same input, confirm 5 nodes rendered
- `shows empty state when no recent sessions` — pass 3 old sessions with filter "active", confirm empty state message rendered
- `toggle switches between active and all views`

**Node sizing tests**:
- `active session node has radius 28` — check SVG `r` attribute or CSS class
- `old session node has radius 6`
- `active sessions render in inner tier positions`

**Drawer tests**:
- `clicking a node opens the detail drawer`
- `drawer shows session name and status`
- `closing the drawer hides it`
- `drawer is hidden when no node is selected`

---

## §3 Technical Specification

### Session age calculation
```javascript
const SESSION_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

function sessionTier(session) {
  if (session.isActive) return 'active'
  const lastActivity = session.lastActivityAt ?? session.updatedAt ?? session.createdAt
  const age = Date.now() - new Date(lastActivity).getTime()
  if (age < SESSION_ACTIVE_WINDOW_MS) return 'recent'
  return 'old'
}

const NODE_RADIUS = { active: 28, recent: 16, old: 6 }
const NODE_OPACITY = { active: 1.0, recent: 0.7, old: 0.3 }
```

### Radial tier assignment
- `active` sessions → innermost radial tier (r = 120px from center)
- `recent` sessions → middle tier (r = 220px)
- `old` sessions → outer tier (r = 320px) — only rendered in "All" mode

If a tier has 0 sessions, collapse it (don't leave empty rings).

### Filter state
```javascript
const [filterMode, setFilterMode] = useState('active') // 'active' | 'all'

const visibleSessions = filterMode === 'active'
  ? sessions.filter(s => sessionTier(s) !== 'old')
  : sessions
```

### Toggle UI
A small pill toggle in the MeshView header bar (top-left of canvas area):
```
[ Active ▸ ] [ All ]
```
Use `--mc-*` tokens. Match the existing header style in `MeshView.jsx`.

---

## §4 Implementation Plan

1. Add `sessionTier()` utility and `NODE_RADIUS`/`NODE_OPACITY` maps to `MeshView.jsx`
2. Add `filterMode` state and `visibleSessions` derived value
3. Wire `sessionTier()` into the radial placement logic (3 tiers instead of 1)
4. Wire node `r` attribute and `opacity` to tier
5. Add the toggle pill to the header
6. Add empty state render
7. Implement the node-detail drawer (adapt the existing V1 slide-in panel)
8. Suppress App-level right log when Mesh tab is active (CSS gate or prop)
9. Write tests
10. Verify full test suite passes: `npm run test:cockpit`

---

## §5 Constraints

- **No backend changes.** All filtering is client-side on the `sessions` prop already passed to MeshView.
- **No new top-level tabs.** This is a MeshView-internal change only.
- **No new dependencies.** Use existing SVG, CSS, and React patterns from V1.
- **`--mc-*` tokens only.** No hardcoded colors.
- **Surgical.** Touch only `MeshView.jsx`, `MeshView.css`, `MeshView.test.jsx`, and App.jsx (CSS gate only — no logic changes to App.jsx).
- **Commit only on green.** `npm run test:cockpit` must pass before committing.

---

## §6 Boundaries

**In scope:**
- Recency filter with toggle
- Activity-tiered node sizing and radial placement
- Node-detail drawer (adapted from V1 slide-in panel)
- Right log suppression when Mesh tab is active
- Tests for all new behavior

**Out of scope:**
- Archiving `~/.claude` session files (separate operational task, not a code change)
- Changes to the Triage/left sidebar
- Changes to any tab other than Mesh
- Backend session filtering or new API endpoints
- Redesigning the overall app layout

---

## §7 Stopping Conditions

Stop and commit when:
- All three deliverables are implemented
- New tests pass
- Full `npm run test:cockpit` passes (server + client)
- `npm run lint` is clean
- Working tree is clean

If context runs low mid-implementation, commit whatever is complete and green, update this file with a `## Progress` section noting where you stopped.
