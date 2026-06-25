import { useEffect, useRef, useState, useCallback } from 'react'
import { NODE_TYPES, nodeType, makeNode, serializeToFleetSpec } from './NodeTypes.js'
import './PipelineCanvas.css'

// Pipeline canvas — a drag-drop SVG composer that lives as a MODE inside Runs
// (never a sibling tab). It places/connects the seven node types, persists the
// canvas to /api/pipelines, and "Run Pipeline" serialises the canvas to the
// EXISTING /api/fleet batch shape ({ goal, children, policy }). No new runner.
//
// runtimeStatus maps nodeId -> 'active' | 'done' | 'failed' so a parent can paint
// live run state onto the canvas; absent statuses render neutral.

const NODE_W = 132
const NODE_H = 52

function nodeCenter(n) {
  return { cx: n.x + NODE_W / 2, cy: n.y + NODE_H / 2 }
}

export function PipelineCanvas({
  runtimeStatus = {},
  initialNodes = null,
  initialEdges = null,
  onRun,
}) {
  const [nodes, setNodes] = useState(() => initialNodes || [])
  const [edges, setEdges] = useState(() => initialEdges || [])
  const [name, setName] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [connectFrom, setConnectFrom] = useState(null)
  const [saved, setSaved] = useState([])
  const [status, setStatus] = useState(null) // { kind: 'ok'|'err'|'busy', text }
  const drag = useRef(null)

  // Load saved pipelines for the Load picker.
  useEffect(() => {
    let alive = true
    fetch('/api/pipelines')
      .then((r) => (r.ok ? r.json() : { pipelines: [] }))
      .then((d) => alive && setSaved(Array.isArray(d.pipelines) ? d.pipelines : []))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const addNode = useCallback((type) => {
    setNodes((prev) => {
      // Cascade new nodes so they don't stack exactly on top of each other.
      const offset = 24 + prev.length * 28
      return [...prev, makeNode(type, 60 + offset, 60 + (offset % 140))]
    })
  }, [])

  const deleteNode = useCallback((id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    setEdges((prev) => prev.filter((e) => e.from !== id && e.to !== id))
    setSelectedId((cur) => (cur === id ? null : cur))
  }, [])

  const onNodePointerDown = (e, n) => {
    e.stopPropagation()
    setSelectedId(n.id)
    drag.current = { id: n.id, startX: e.clientX, startY: e.clientY, origX: n.x, origY: n.y }
  }

  const onCanvasPointerMove = (e) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    setNodes((prev) =>
      prev.map((n) => (n.id === d.id ? { ...n, x: d.origX + dx, y: d.origY + dy } : n)),
    )
  }

  const onCanvasPointerUp = () => {
    drag.current = null
  }

  // Edge creation: click a node's output handle to start, click a target node body.
  const startConnect = (e, id) => {
    e.stopPropagation()
    setConnectFrom(id)
  }

  const completeConnect = (id) => {
    if (!connectFrom || connectFrom === id) {
      setConnectFrom(null)
      return
    }
    setEdges((prev) => {
      const exists = prev.some((x) => x.from === connectFrom && x.to === id)
      return exists ? prev : [...prev, { from: connectFrom, to: id }]
    })
    setConnectFrom(null)
  }

  const updateConfig = (id, key, value) => {
    setNodes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, config: { ...n.config, [key]: value } } : n)),
    )
  }

  const agentCount = nodes.filter((n) => n.type === 'agent').length

  async function runPipeline() {
    const spec = serializeToFleetSpec(nodes, edges, name || 'Untitled pipeline')
    setStatus({ kind: 'busy', text: 'Submitting run…' })
    try {
      const res = await fetch('/api/fleet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(spec),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.detail || `HTTP ${res.status}`)
      }
      setStatus({ kind: 'ok', text: `Run started${data.id ? ` (${data.id})` : ''}` })
      onRun?.(data)
    } catch (err) {
      setStatus({ kind: 'err', text: err.message })
    }
  }

  async function savePipeline() {
    setStatus({ kind: 'busy', text: 'Saving…' })
    try {
      const res = await fetch('/api/pipelines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name || 'Untitled pipeline', nodes, edges }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.detail || `HTTP ${res.status}`)
      }
      setStatus({ kind: 'ok', text: 'Saved' })
      // Refresh the Load list so the new pipeline shows up.
      setSaved((prev) => {
        const next = prev.filter((p) => p.id !== data.pipeline?.id)
        return data.pipeline ? [...next, data.pipeline] : prev
      })
    } catch (err) {
      setStatus({ kind: 'err', text: err.message })
    }
  }

  function loadPipeline(id) {
    if (!id) return
    const p = saved.find((x) => x.id === id)
    if (!p) return
    setName(p.name || '')
    setNodes(Array.isArray(p.nodes) ? p.nodes : [])
    setEdges(Array.isArray(p.edges) ? p.edges : [])
    setSelectedId(null)
  }

  const selected = nodes.find((n) => n.id === selectedId) || null

  return (
    <div className="pc-root">
      {/* Toolbar */}
      <div className="pc-toolbar">
        <input
          className="pc-name"
          aria-label="Pipeline name"
          placeholder="Pipeline name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          className="pc-load"
          aria-label="Load pipeline"
          value=""
          onChange={(e) => loadPipeline(e.target.value)}
        >
          <option value="">Load…</option>
          {saved.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>
        <div className="pc-spacer" />
        {status && <span className={`pc-status pc-status-${status.kind}`}>{status.text}</span>}
        <button className="pc-btn" onClick={savePipeline}>
          Save
        </button>
        <button
          className="pc-btn pc-btn-primary"
          onClick={runPipeline}
          disabled={agentCount === 0}
          title={agentCount === 0 ? 'Add an Agent node to run' : 'Run this pipeline'}
        >
          Run Pipeline
        </button>
      </div>

      <div className="pc-body">
        {/* Palette */}
        <div className="pc-palette" role="toolbar" aria-label="Node palette">
          {NODE_TYPES.map((t) => (
            <button
              key={t.id}
              data-palette-type={t.id}
              className="pc-palette-item"
              onClick={() => addNode(t.id)}
            >
              <span className="pc-glyph" aria-hidden>
                {t.glyph}
              </span>
              {t.label}
            </button>
          ))}
        </div>

        {/* Canvas */}
        <div className="pc-canvas-wrap">
          <svg
            className="pc-canvas"
            data-pipeline-canvas
            role="img"
            aria-label="Pipeline canvas"
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            onClick={() => {
              setSelectedId(null)
              setConnectFrom(null)
            }}
          >
            {/* Edges */}
            {edges.map((e, i) => {
              const from = nodes.find((n) => n.id === e.from)
              const to = nodes.find((n) => n.id === e.to)
              if (!from || !to) return null
              const a = nodeCenter(from)
              const b = nodeCenter(to)
              return (
                <line
                  key={`${e.from}-${e.to}-${i}`}
                  className="pc-edge"
                  data-edge
                  x1={a.cx}
                  y1={a.cy}
                  x2={b.cx}
                  y2={b.cy}
                />
              )
            })}

            {/* Nodes */}
            {nodes.map((n) => {
              const def = nodeType(n.type)
              const st = runtimeStatus[n.id]
              return (
                <g
                  key={n.id}
                  data-node
                  data-node-id={n.id}
                  data-node-type={n.type}
                  {...(st ? { 'data-status': st } : {})}
                  className={`pc-node pc-node-${n.type}${st ? ` pc-node-${st}` : ''}${
                    selectedId === n.id ? ' pc-node-selected' : ''
                  }`}
                  transform={`translate(${n.x}, ${n.y})`}
                  onPointerDown={(e) => onNodePointerDown(e, n)}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (connectFrom) completeConnect(n.id)
                  }}
                >
                  <rect className="pc-node-box" width={NODE_W} height={NODE_H} rx={8} />
                  <text className="pc-node-glyph" x={14} y={NODE_H / 2 + 5}>
                    {def?.glyph}
                  </text>
                  <text className="pc-node-label" x={36} y={NODE_H / 2 - 4}>
                    {def?.label}
                  </text>
                  <text className="pc-node-sub" x={36} y={NODE_H / 2 + 13}>
                    {n.config?.goal || n.config?.skill || n.config?.expr || ''}
                  </text>
                  {/* Output handle — click to begin an edge */}
                  <circle
                    className="pc-handle"
                    cx={NODE_W}
                    cy={NODE_H / 2}
                    r={6}
                    onPointerDown={(e) => startConnect(e, n.id)}
                  />
                </g>
              )
            })}
          </svg>

          {nodes.length === 0 && (
            <div className="pc-empty" data-testid="pipeline-empty-prompt">
              <p className="pc-empty-title">Build a pipeline</p>
              <p className="pc-empty-sub">
                Click a node type in the palette to drop it on the canvas. Connect nodes by clicking
                a node&apos;s output dot, then the next node. Hit <b>Run Pipeline</b> to launch it
                as a Fleet run.
              </p>
            </div>
          )}
        </div>

        {/* Inspector for the selected node */}
        {selected && (
          <div className="pc-inspector">
            <div className="pc-inspector-head">
              <span>{nodeType(selected.type)?.label}</span>
              <button className="pc-btn pc-btn-danger" onClick={() => deleteNode(selected.id)}>
                Delete
              </button>
            </div>
            {selected.type === 'agent' && (
              <>
                <label className="pc-field">
                  Goal
                  <textarea
                    value={selected.config.goal || ''}
                    onChange={(e) => updateConfig(selected.id, 'goal', e.target.value)}
                  />
                </label>
                <label className="pc-field">
                  Working dir
                  <input
                    value={selected.config.cwd || ''}
                    placeholder="Project root (a known harness root)"
                    onChange={(e) => updateConfig(selected.id, 'cwd', e.target.value)}
                  />
                </label>
              </>
            )}
            {selected.type === 'skill' && (
              <label className="pc-field">
                Skill
                <input
                  value={selected.config.skill || ''}
                  onChange={(e) => updateConfig(selected.id, 'skill', e.target.value)}
                />
              </label>
            )}
            {selected.type === 'condition' && (
              <label className="pc-field">
                Expression
                <input
                  value={selected.config.expr || ''}
                  onChange={(e) => updateConfig(selected.id, 'expr', e.target.value)}
                />
              </label>
            )}
            {selected.type === 'human' && (
              <label className="pc-field">
                Prompt
                <input
                  value={selected.config.prompt || ''}
                  onChange={(e) => updateConfig(selected.id, 'prompt', e.target.value)}
                />
              </label>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
