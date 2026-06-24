import { useState, useRef, useMemo, useEffect } from 'react'
import './MeshView.css'

const DISPATCH_ID = '__dispatch'

// Per-status visual treatment (spec §3.5). Colours are --mc-* token names so the
// view tracks the active theme; fill is the same colour mixed to 15% opacity.
const NODE_STYLE = {
  running: { color: 'var(--mc-ok)', radius: 20, opacity: 1.0, stroke: 2, pulse: true },
  idle: { color: 'var(--mc-fg-4)', radius: 16, opacity: 0.65, stroke: 1.5, pulse: false },
  done: { color: 'var(--mc-fg-5)', radius: 13, opacity: 0.25, stroke: 1.5, pulse: false },
  error: { color: 'var(--mc-danger)', radius: 16, opacity: 1.0, stroke: 1.5, pulse: false },
}
const DISPATCH_STYLE = { color: 'var(--mc-accent)', radius: 26, opacity: 1.0, stroke: 2, pulse: true }

const fillFor = (color) => `color-mix(in srgb, ${color} 15%, transparent)`

// Defensive readers (spec §3.3) — the live shape varies, so always fall back.
const nameOf = (s) => s.projectLabel ?? s.name ?? 'Session'
const statusOf = (s) => s.status ?? 'idle'
const costOf = (s) => s.totalCost ?? s.cost ?? 0
const toolsOf = (s) => s.toolCount ?? 0

// Deterministic 3-tier radial layout (spec §3.4). Computed once per
// [sessionsVersion, W, H] change — no force-directed simulation.
function layoutNodes(sessions, W, H) {
  const cx = W / 2
  const cy = H / 2
  const tiers = { running: [], idle: [], done: [], error: [] }
  sessions.forEach((s) => (tiers[statusOf(s)] ?? tiers.idle).push(s))

  const base = Math.min(W, H)
  const radii = { running: base * 0.32, idle: base * 0.56, done: base * 0.76 }

  const placed = [{ id: DISPATCH_ID, x: cx, y: cy, tier: 0 }]

  ;['running', 'idle', 'done'].forEach((tier) => {
    const nodes = [
      ...(tiers[tier] ?? []),
      ...(tier === 'done' ? (tiers.error ?? []) : []),
    ]
    const r = radii[tier]
    nodes.forEach((s, i) => {
      const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2
      placed.push({
        ...s,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        tier: ['running', 'idle', 'done'].indexOf(tier) + 1,
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
  const style = isDispatch ? DISPATCH_STYLE : NODE_STYLE[statusOf(node)] ?? NODE_STYLE.idle
  const { color, radius, opacity, stroke, pulse } = style
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
      <text
        className="mesh-label"
        x={node.x}
        y={node.y + radius + 13}
        textAnchor="middle"
      >
        {truncate(label)}
      </text>
      {cost > 0 && (
        <text
          className="mesh-cost"
          x={node.x}
          y={node.y + radius + 25}
          textAnchor="middle"
        >
          ${cost.toFixed(2)}
        </text>
      )}
    </g>
  )
}

// MeshView — live SVG topology of every session orbiting a central Dispatch hub.
// Pure client view: consumes the already-fetched `sessions` array via props and
// re-layouts when `sessionsVersion` changes. No new API surface (spec §3.2, §5).
export function MeshView({ sessions = [], sessionsVersion, onSelectSession }) {
  const [selected, setSelected] = useState(null)
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

  const nodes = useMemo(
    () => layoutNodes(sessions, dims.w, dims.h),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionsVersion, sessions, dims.w, dims.h]
  )

  const hub = nodes.find((n) => n.id === DISPATCH_ID)
  const edges = nodes.filter((n) => n.id !== DISPATCH_ID)
  const runningNodes = nodes.filter((n) => statusOf(n) === 'running')

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
  useEffect(() => {
    if (typeof requestAnimationFrame === 'undefined') return
    let raf
    const step = () => {
      setPackets((prev) => {
        const next = prev.map((p) => ({ ...p, t: p.t + p.speed })).filter((p) => p.t < 1)
        if (next.length < MAX_PACKETS && Math.random() < 0.04 && runningNodes.length && hub) {
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
              <dt>Cost</dt>
              <dd>${costOf(selected).toFixed(2)}</dd>
              <dt>Tool calls</dt>
              <dd>{toolsOf(selected)}</dd>
            </dl>
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
            <button
              type="button"
              className="mesh-btn"
              onClick={() => setSelected(null)}
            >
              ✕ Close
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
