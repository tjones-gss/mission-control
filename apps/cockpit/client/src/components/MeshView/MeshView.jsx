import { useState, useRef, useMemo, useEffect } from 'react'
import { projectLabel } from '../../utils/session.js'
import './MeshView.css'

const DISPATCH_ID = '__dispatch'

// Per-status colours (spec §3.5). Colours are --mc-* token names so the view
// tracks the active theme; fill is the same colour mixed to 15% opacity. V2
// note: node *radius* and *opacity* are no longer driven by status — they come
// from the activity tier (see TIER_RADIUS/TIER_OPACITY). Status only colours.
const NODE_STYLE = {
  running: { color: 'var(--mc-ok)', stroke: 2 },
  idle: { color: 'var(--mc-fg-4)', stroke: 1.5 },
  done: { color: 'var(--mc-fg-5)', stroke: 1.5 },
  error: { color: 'var(--mc-danger)', stroke: 1.5 },
}
const DISPATCH_COLOR = 'var(--mc-accent)'

// V2 activity tiers (spec §1.2 / §3). A session's recency — not its status —
// sets its visual weight: active nodes dominate, recent-idle recede, old
// collapse to faint dots. The orchestrator hub keeps its own (larger) sizing.
const SESSION_ACTIVE_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

// Live /api/sessions carries `lastModified` (mtimeMs); the spec/test shape uses
// lastActivityAt/updatedAt/createdAt. Read whichever exists, newest-intent first.
const activityOf = (s) => s.lastActivityAt ?? s.updatedAt ?? s.lastModified ?? s.createdAt ?? null

function sessionTier(session, now = Date.now()) {
  if (session.isActive) return 'active'
  const ts = activityOf(session)
  if (ts == null) return 'old'
  const age = now - new Date(ts).getTime()
  if (Number.isNaN(age) || age >= SESSION_ACTIVE_WINDOW_MS) return 'old'
  return 'recent'
}

const TIER_RADIUS = { active: 28, recent: 16, old: 6 }
const TIER_OPACITY = { active: 1.0, recent: 0.7, old: 0.3 }
// Innermost → outermost radial rings (spec §3). Active pulls toward centre.
const TIER_RING = { active: 120, recent: 220, old: 320 }

const fillFor = (color) => `color-mix(in srgb, ${color} 15%, transparent)`

// Defensive readers (spec §3.3) — bridge the spec/test shape (id, projectLabel,
// status, totalCost, toolCount) and the live /api/sessions shape (sessionId,
// cwd/slug/displayName, isActive, estimatedCost, toolUseCounts) so the view works
// with both. Always fall back; never assume a field exists.
const idOf = (s) => s.id ?? s.sessionId
const nameOf = (s) => s.projectLabel ?? s.name ?? s.displayName ?? projectLabel(s)
const statusOf = (s) => s.status ?? (s.isActive ? 'running' : 'idle')
const costOf = (s) => s.totalCost ?? s.cost ?? s.estimatedCost?.totalCost ?? 0
const toolsOf = (s) =>
  s.toolCount ?? (s.toolUseCounts ? Object.values(s.toolUseCounts).reduce((a, b) => a + b, 0) : 0)
const modelOf = (s) => s.model ?? s.modelId ?? null
// No per-call history ships in the session summary (no backend change allowed),
// so the drawer's "recent tool calls" surfaces the available proxy: the busiest
// tools from toolUseCounts, capped at 5 (spec §1.3).
const recentToolsOf = (s) =>
  Object.entries(s.toolUseCounts ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)

// Deterministic 3-tier radial layout (spec §3). Computed once per
// [sessionsVersion, filterMode, W, H] change — no force-directed simulation.
// Tiers are by activity recency: active (inner) → recent (middle) → old (outer).
// Empty tiers simply place nothing; rings never reserve space they don't use.
function layoutNodes(sessions, W, H, now = Date.now()) {
  const cx = W / 2
  const cy = H / 2
  const tiers = { active: [], recent: [], old: [] }
  sessions.forEach((s) => tiers[sessionTier(s, now)].push(s))

  const hasActive = tiers.active.length > 0
  const placed = [{ id: DISPATCH_ID, x: cx, y: cy, hubRadius: hasActive ? 36 : 26 }]

  ;['active', 'recent', 'old'].forEach((tier) => {
    const nodes = tiers[tier]
    const r = TIER_RING[tier]
    nodes.forEach((s, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
      placed.push({
        ...s,
        id: idOf(s), // live sessions key on sessionId; guarantee a stable id
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        activityTier: tier,
      })
    })
  })

  return placed
}

function truncate(label, max = 16) {
  if (label.length <= max) return label
  return label.slice(0, max - 1) + '…'
}

const lerp = (a, b, t) => a + (b - a) * t

// Edge opacity by source-node status (spec §3.6).
const EDGE_OPACITY = { running: 0.5, idle: 0.25, done: 0.1, error: 0.25 }

const MAX_PACKETS = 12

// Status → chip/label colour for the detail panel and node accents (spec §3.8).
const STATUS_COLOR = {
  running: 'var(--mc-ok)',
  error: 'var(--mc-danger)',
  idle: 'var(--mc-fg-4)',
  done: 'var(--mc-fg-5)',
}

function MeshNode({ node, onSelect }) {
  const isDispatch = node.id === DISPATCH_ID
  const tier = node.activityTier
  const color = isDispatch
    ? DISPATCH_COLOR
    : (NODE_STYLE[statusOf(node)]?.color ?? NODE_STYLE.idle.color)
  const stroke = isDispatch ? 2 : (NODE_STYLE[statusOf(node)]?.stroke ?? 1.5)
  const radius = isDispatch ? (node.hubRadius ?? 26) : TIER_RADIUS[tier]
  const opacity = isDispatch ? 1.0 : TIER_OPACITY[tier]
  // Active nodes (and the hub) pulse to read as "live"; quieter tiers stay still.
  const pulse = isDispatch || tier === 'active'
  const label = isDispatch ? 'Dispatch' : nameOf(node)
  const cost = isDispatch ? 0 : costOf(node)

  // The hub is a destination, not a session — clicking it opens nothing.
  const handleSelect = (e) => {
    e.stopPropagation()
    if (!isDispatch) onSelect(node)
  }

  // Diamond for the hub, circle for everything else.
  const shape = isDispatch ? (
    <polygon
      points={`${node.x},${node.y - radius} ${node.x + radius},${node.y} ${node.x},${node.y + radius} ${node.x - radius},${node.y}`}
      fill={fillFor(color)}
      stroke={color}
      strokeWidth={stroke}
    />
  ) : (
    <circle
      cx={node.x}
      cy={node.y}
      r={radius}
      fill={fillFor(color)}
      stroke={color}
      strokeWidth={stroke}
    />
  )

  return (
    <g
      data-node={node.id}
      className={`mesh-node${isDispatch ? '' : ` mesh-node--${tier}`}`}
      aria-label={label}
      tabIndex={0}
      opacity={opacity}
      style={{ cursor: 'pointer' }}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleSelect(e)
      }}
    >
      {pulse && (
        <circle
          className="mesh-pulse"
          cx={node.x}
          cy={node.y}
          r={radius + 8}
          fill="none"
          stroke={color}
        />
      )}
      {shape}
      <text className="mesh-label" x={node.x} y={node.y + radius + 13} textAnchor="middle">
        {truncate(label)}
      </text>
      {cost > 0 && (
        <text className="mesh-cost" x={node.x} y={node.y + radius + 25} textAnchor="middle">
          ${cost.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// MeshView — live SVG topology of every session orbiting a central Dispatch hub.
// Pure client view: consumes the already-fetched `sessions` array via props and
// re-layouts when `sessionsVersion` changes. No new API surface (spec §3.2, §5).
export function MeshView({ sessions = [], sessionsVersion, onSelectSession, lastToolCall = null }) {
  // useApi yields `null` before /api/sessions resolves; the default param only
  // covers `undefined`, so normalise here to keep layout/counts crash-safe.
  const safeSessions = Array.isArray(sessions) ? sessions : []
  const [selected, setSelected] = useState(null)
  // Recency filter (spec §1.1): default to "active" — only sessions touched in
  // the last 24h. "all" reveals the full history. Client-side only.
  const [filterMode, setFilterMode] = useState('active')
  const containerRef = useRef(null)
  // jsdom (and first paint) reports 0×0; fall back to sane defaults so the
  // layout always has room to place nodes.
  const [dims, setDims] = useState({ w: 800, h: 600 })

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect && rect.width > 0 && rect.height > 0) {
        setDims({ w: rect.width, h: rect.height })
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // "active" mode hides old (≥24h) sessions; "all" shows everything (spec §1.1).
  const visibleSessions = useMemo(
    () =>
      filterMode === 'active' ? safeSessions.filter((s) => sessionTier(s) !== 'old') : safeSessions,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionsVersion, safeSessions, filterMode],
  )

  const nodes = useMemo(
    () => layoutNodes(visibleSessions, dims.w, dims.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionsVersion, visibleSessions, dims.w, dims.h],
  )

  const hub = nodes.find((n) => n.id === DISPATCH_ID)
  const edges = nodes.filter((n) => n.id !== DISPATCH_ID)
  const runningNodes = nodes.filter((n) => statusOf(n) === 'running')
  // Filtered view with nothing to show → friendly nudge (spec §1.1).
  const emptyActive = filterMode === 'active' && visibleSessions.length === 0

  const counts = useMemo(() => {
    const c = { running: 0, idle: 0, done: 0, total: 0 }
    safeSessions.forEach((s) => {
      const st = statusOf(s)
      if (st === 'running') c.running += 1
      else if (st === 'done' || st === 'error') c.done += 1
      else c.idle += 1
      c.total += costOf(s)
    })
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeSessions])

  // Escape closes the detail panel (spec §3.8).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') setSelected(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // Animated packets flow from running sessions toward Dispatch, giving a live
  // "traffic" read without any extra API data (spec §3.7). Capped at 12 to keep
  // the RAF loop cheap. Re-registers when the layout changes.
  const [packets, setPackets] = useState([])

  // V3 hook instrumentation: once a real tool_call has been seen, switch off the
  // simulated random packets so the mesh shows ONLY real traffic. Until then
  // (no hook bridge installed) the simulated fallback runs exactly as before.
  const realModeRef = useRef(false)
  const lastToolTsRef = useRef(null)
  useEffect(() => {
    if (!lastToolCall || lastToolCall.ts === lastToolTsRef.current) return
    lastToolTsRef.current = lastToolCall.ts
    const src = nodes.find((n) => n.id === lastToolCall.sessionId)
    if (!src || !hub) return // event for a session not on the mesh — ignore
    realModeRef.current = true
    setPackets((prev) => {
      const next = prev.length < MAX_PACKETS ? prev.slice() : prev.slice(1)
      next.push({
        id: `tc-${lastToolCall.ts}-${lastToolCall.sessionId}`,
        fromX: src.x,
        fromY: src.y,
        toX: hub.x,
        toY: hub.y,
        t: 0,
        speed: 0.006,
        col: 'var(--mc-accent)',
        real: true,
      })
      return next
    })
  }, [lastToolCall, nodes, hub])

  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return
    let raf
    const step = () => {
      setPackets((prev) => {
        const next = prev.map((p) => ({ ...p, t: p.t + p.speed })).filter((p) => p.t < 1)
        if (
          !realModeRef.current &&
          next.length < MAX_PACKETS &&
          Math.random() < 0.04 &&
          runningNodes.length &&
          hub
        ) {
          const src = runningNodes[Math.floor(Math.random() * runningNodes.length)]
          next.push({
            id: Math.random().toString(36).slice(2),
            fromX: src.x,
            fromY: src.y,
            toX: hub.x,
            toY: hub.y,
            t: 0,
            speed: 0.006 + Math.random() * 0.004,
            col: 'var(--mc-ok)',
          })
        }
        // Nothing on screen and nothing spawned: keep the same reference so React
        // bails out of the re-render instead of churning 60fps on an idle mesh.
        if (next.length === 0 && prev.length === 0) return prev
        return next
      })
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [nodes]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="mesh-root" ref={containerRef}>
      <div className="mesh-toolbar">
        <div className="mesh-toggle" role="group" aria-label="Session recency filter">
          <button
            type="button"
            className={`mesh-toggle-btn${filterMode === 'active' ? ' active' : ''}`}
            aria-pressed={filterMode === 'active'}
            onClick={() => setFilterMode('active')}
          >
            Active
          </button>
          <button
            type="button"
            className={`mesh-toggle-btn${filterMode === 'all' ? ' active' : ''}`}
            aria-pressed={filterMode === 'all'}
            onClick={() => setFilterMode('all')}
          >
            All
          </button>
        </div>
      </div>
      {emptyActive && (
        <div className="mesh-empty">
          No active sessions in the last 24h — switch to All to see history
        </div>
      )}
      <svg
        className="mesh-canvas"
        role="img"
        aria-label="Agent topology mesh"
        viewBox={`0 0 ${dims.w} ${dims.h}`}
        preserveAspectRatio="xMidYMid meet"
        onClick={() => setSelected(null)}
      >
        {hub &&
          edges.map((node) => (
            <line
              key={`edge-${node.id}`}
              x1={node.x}
              y1={node.y}
              x2={hub.x}
              y2={hub.y}
              stroke="var(--mc-border-2)"
              strokeWidth={statusOf(node) === 'running' ? 1.5 : 1}
              opacity={EDGE_OPACITY[statusOf(node)] ?? 0.25}
            />
          ))}
        {packets.map((p) => (
          <circle
            key={p.id}
            data-packet
            {...(p.real ? { 'data-packet-real': '' } : {})}
            cx={lerp(p.fromX, p.toX, p.t)}
            cy={lerp(p.fromY, p.toY, p.t)}
            r={2.5}
            fill={p.col}
            opacity={0.8}
          />
        ))}
        {nodes.map((node) => (
          <MeshNode key={node.id} node={node} onSelect={setSelected} />
        ))}
      </svg>
      <div data-panel className={`mesh-panel${selected ? ' open' : ''}`}>
        {selected && (
          <div className="mesh-panel-body">
            <div className="mesh-panel-name">{nameOf(selected)}</div>
            <span
              className="mesh-chip"
              style={{
                color: STATUS_COLOR[statusOf(selected)] ?? 'var(--mc-fg-4)',
                borderColor: STATUS_COLOR[statusOf(selected)] ?? 'var(--mc-fg-4)',
              }}
            >
              {statusOf(selected)}
            </span>
            <dl className="mesh-panel-stats">
              {modelOf(selected) && (
                <>
                  <dt>Model</dt>
                  <dd>{modelOf(selected)}</dd>
                </>
              )}
              <dt>Cost</dt>
              <dd>${costOf(selected).toFixed(2)}</dd>
              <dt>Tool calls</dt>
              <dd>{toolsOf(selected)}</dd>
            </dl>
            {recentToolsOf(selected).length > 0 && (
              <div className="mesh-panel-tools">
                <div className="mesh-panel-tools-head">Recent tools</div>
                <ul>
                  {recentToolsOf(selected).map(([tool, n]) => (
                    <li key={tool}>
                      <span>{tool}</span>
                      <span className="mesh-panel-tools-count">{n}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <hr className="mesh-divider" />
            <button
              type="button"
              className="mesh-btn mesh-btn-primary"
              onClick={() => {
                onSelectSession?.(selected.id)
                setSelected(null)
              }}
            >
              Open in Triage
            </button>
            <button type="button" className="mesh-btn" onClick={() => setSelected(null)}>
              ✕ Close
            </button>
          </div>
        )}
      </div>
      <div className="mesh-statusbar">
        <span className="mesh-stat">
          <span className="mesh-dot" style={{ background: 'var(--mc-ok)' }} />
          {counts.running} running
        </span>
        <span className="mesh-sep">·</span>
        <span className="mesh-stat">
          <span className="mesh-dot" style={{ background: 'var(--mc-fg-4)' }} />
          {counts.idle} idle
        </span>
        <span className="mesh-sep">·</span>
        <span className="mesh-stat">
          <span className="mesh-dot" style={{ background: 'var(--mc-fg-5)' }} />
          {counts.done} done
        </span>
        <span className="mesh-sep">·</span>
        <span className="mesh-stat">total ${counts.total.toFixed(2)}</span>
      </div>
    </div>
  )
}
