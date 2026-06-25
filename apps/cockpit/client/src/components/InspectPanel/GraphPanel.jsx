import { useMemo } from 'react'
import { useApi } from '../../hooks/useApi.js'
import './GraphPanel.css'

// Phase I3 — the knowledge graph in session detail. Renders the 2-hop
// neighbourhood of this session's node (GET /api/graph) as a small radial
// mini-graph: the session in the centre, every file it touched / task it
// spawned / commit it produced on a ring around it. Read-only, --mc-* only.

// Kind → CSS modifier (colour token lives in GraphPanel.css). Unknown kinds
// fall back to the neutral 'other' class.
const KIND_CLASS = {
  session: 'k-session',
  file: 'k-file',
  commit: 'k-commit',
  task: 'k-task',
  decision: 'k-decision',
  outcome: 'k-outcome',
}

const VIEW = 320
const CENTER = VIEW / 2
const RING = 118

// A compact display label: files show their basename, everything else its label
// truncated. The full id is always in the <title> for hover.
function displayLabel(node) {
  if (node.kind === 'file') {
    const base = node.label.split(/[\\/]/).pop()
    return base || node.label
  }
  const label = node.label || node.id
  return label.length > 18 ? label.slice(0, 17) + '…' : label
}

function layout(nodes, centerId) {
  const center = nodes.find((n) => n.id === centerId) || nodes[0]
  const others = nodes.filter((n) => n !== center)
  const positioned = []
  if (center) positioned.push({ node: center, x: CENTER, y: CENTER })
  others.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2
    positioned.push({
      node,
      x: CENTER + RING * Math.cos(angle),
      y: CENTER + RING * Math.sin(angle),
    })
  })
  return positioned
}

export function GraphPanel({ sessionId, graphVersion = 0 }) {
  const centerId = `session:${sessionId}`
  const url = sessionId ? `/api/graph?node=${encodeURIComponent(centerId)}` : null
  const { data, loading, error } = useApi(url, [graphVersion])

  const placed = useMemo(() => {
    if (!data?.nodes?.length) return []
    return layout(data.nodes, data.node || centerId)
  }, [data, centerId])

  const posById = useMemo(() => {
    const m = new Map()
    for (const p of placed) m.set(p.node.id, p)
    return m
  }, [placed])

  if (loading) {
    return <div className="graph-panel graph-panel--msg">Loading graph…</div>
  }
  if (error) {
    return (
      <div className="graph-panel graph-panel--msg">
        Graph unavailable. The derived cache may be rebuilding — try again shortly.
      </div>
    )
  }
  if (!placed.length) {
    return (
      <div className="graph-panel graph-panel--msg">
        No graph yet. The graph fills in as this session touches files, spawns subagents, and makes
        commits.
      </div>
    )
  }

  return (
    <div className="graph-panel">
      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        className="graph-svg"
        role="img"
        aria-label="Knowledge graph"
      >
        {(data.edges || []).map((e, i) => {
          const a = posById.get(e.from_id)
          const b = posById.get(e.to_id)
          if (!a || !b) return null
          return (
            <line
              key={`e${i}`}
              data-testid="graph-edge"
              data-rel={e.rel}
              className="graph-edge"
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
            >
              <title>{e.rel}</title>
            </line>
          )
        })}
        {placed.map(({ node, x, y }) => (
          <g
            key={node.id}
            data-testid="graph-node"
            data-kind={node.kind}
            className={`graph-node ${KIND_CLASS[node.kind] || 'k-other'}`}
            transform={`translate(${x}, ${y})`}
          >
            <circle r={node.id === (data.node || centerId) ? 13 : 9} />
            <text className="graph-node-label" y={node.id === (data.node || centerId) ? 28 : 22}>
              {displayLabel(node)}
            </text>
            <title>{node.id}</title>
          </g>
        ))}
      </svg>
    </div>
  )
}
