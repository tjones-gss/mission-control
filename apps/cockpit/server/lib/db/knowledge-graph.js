// Phase I3 — knowledge graph (derived read-cache).
//
// Connects sessions, files, tasks, and commits into a graph so the UI can ask
// "everything that touched auth.js" or "which sessions led to this commit". Like
// the message/usage/pattern indexers, a whole-session reindex runs inside the
// upsertSession transaction (DELETE this session's edges, then re-insert), so it
// is idempotent and the graph rebuilds from scratch when cockpit.db is deleted.
// No LLM is consulted (UNIVERSAL CONSTRAINT #4) — nodes and edges are a pure
// function of the transcript's tool calls.
//
// The schema (lib/db/connection.js) supports the full kind/relation vocabulary
// from the spec (decision/outcome nodes, decided/blocked relations); this
// deterministic pass populates the subset derivable without an LLM:
//   session --touched--> file      (Edit/Write/MultiEdit/NotebookEdit)
//   session --spawned--> task      (Task tool calls)
//   session --produced-> commit    (git commit bash commands)
import { getDb } from './connection.js'

// Tools whose target file the session "touched". Mirrors pattern-index's set.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// `git commit` (not `git status`/`git commit-graph`); -m / -am message capture.
const GIT_COMMIT_RE = /\bgit\s+commit\b/
const COMMIT_MSG_RE = /-a?m\s+(["'])([\s\S]*?)\1/

function filePathOf(input) {
  return input?.file_path || input?.notebook_path || null
}

// Walk the transcript's tool_use blocks in order and derive nodes + edges.
// Returns { nodes: [{id,kind,label,meta}], edges: [{from_id,to_id,rel}] }.
// meta is a JSON string (opaque blob); edges are deduped by (to_id,rel) per
// session so editing a file twice yields a single touched edge.
export function extractGraph(sessionId, records, summary) {
  const sessionId_ = `session:${sessionId}`
  const nodes = new Map()
  nodes.set(sessionId_, {
    id: sessionId_,
    kind: 'session',
    label: summary?.slug || sessionId,
    meta: JSON.stringify(summary?.cwd ? { cwd: summary.cwd } : {}),
  })

  const edgeKeys = new Set()
  const edges = []
  const addEdge = (to_id, rel) => {
    const key = `${to_id}|${rel}`
    if (edgeKeys.has(key)) return
    edgeKeys.add(key)
    edges.push({ from_id: sessionId_, to_id, rel })
  }

  let taskN = 0
  let commitN = 0
  for (const r of records || []) {
    if (r?.type !== 'assistant' || !Array.isArray(r.message?.content)) continue
    for (const block of r.message.content) {
      if (block?.type !== 'tool_use') continue
      if (EDIT_TOOLS.has(block.name)) {
        const fp = filePathOf(block.input)
        if (fp) {
          const id = `file:${fp}`
          if (!nodes.has(id)) nodes.set(id, { id, kind: 'file', label: fp, meta: '{}' })
          addEdge(id, 'touched')
        }
      } else if (block.name === 'Task') {
        const id = `task:${sessionId}:${taskN++}`
        const label = block.input?.subagent_type || block.input?.description || 'subagent'
        nodes.set(id, { id, kind: 'task', label, meta: '{}' })
        addEdge(id, 'spawned')
      } else if (block.name === 'Bash' && GIT_COMMIT_RE.test(block.input?.command || '')) {
        const m = COMMIT_MSG_RE.exec(block.input.command)
        const label = (m ? m[2].split('\n')[0].trim() : 'commit') || 'commit'
        const id = `commit:${sessionId}:${commitN++}`
        nodes.set(id, { id, kind: 'commit', label, meta: '{}' })
        addEdge(id, 'produced')
      }
    }
  }

  return { nodes: [...nodes.values()], edges }
}

// Whole-session reindex on the CALLER's db handle (joins the upsertSession
// transaction). Idempotent: this session's edges are removed first, then the
// extracted nodes/edges re-inserted. Nodes are shared (ON CONFLICT updates
// label/meta) so a file node survives across the sessions that touch it; orphan
// nodes left when a session stops touching a file are harmless (and gone on a
// full rebuild). src_session tags each edge with the asserting session.
export function reindexSessionGraph(db, sessionId, records, summary) {
  db.prepare('DELETE FROM edges WHERE src_session = ?').run(sessionId)
  const { nodes, edges } = extractGraph(sessionId, records, summary)
  const upsertNode = db.prepare(
    `INSERT INTO nodes (id, kind, label, meta) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET label = excluded.label, meta = excluded.meta`,
  )
  for (const n of nodes) upsertNode.run(n.id, n.kind, n.label, n.meta)
  const ts =
    typeof summary?.lastModified === 'number' && Number.isFinite(summary.lastModified)
      ? summary.lastModified
      : 0
  const insertEdge = db.prepare(
    `INSERT OR REPLACE INTO edges (src_session, from_id, to_id, rel, ts) VALUES (?, ?, ?, ?, ?)`,
  )
  for (const e of edges) insertEdge.run(sessionId, e.from_id, e.to_id, e.rel, ts)
}

// The 2-hop neighbourhood of a node as { nodes, edges }. Traversal is
// undirected (an edge is followed from either endpoint) so the neighbourhood of
// a file reaches every session that touched it and, at the second hop, the other
// files/tasks/commits those sessions produced. Empty/degraded → empty graph.
export function getNeighbourhood(nodeId, { hops = 2 } = {}) {
  const db = getDb()
  if (!db) return { nodes: [], edges: [] }
  try {
    const nodeIds = new Set([nodeId])
    let frontier = [nodeId]
    const edgeByKey = new Map()
    for (let h = 0; h < hops && frontier.length; h++) {
      const ph = frontier.map(() => '?').join(',')
      const rows = db
        .prepare(
          `SELECT DISTINCT from_id, to_id, rel FROM edges
           WHERE from_id IN (${ph}) OR to_id IN (${ph})`,
        )
        .all(...frontier, ...frontier)
      const next = []
      for (const r of rows) {
        edgeByKey.set(`${r.from_id}|${r.to_id}|${r.rel}`, r)
        for (const side of [r.from_id, r.to_id]) {
          if (!nodeIds.has(side)) {
            nodeIds.add(side)
            next.push(side)
          }
        }
      }
      frontier = next
    }
    const ph = [...nodeIds].map(() => '?').join(',')
    const nodes = db
      .prepare(`SELECT id, kind, label, meta FROM nodes WHERE id IN (${ph})`)
      .all(...nodeIds)
    return { nodes, edges: [...edgeByKey.values()] }
  } catch {
    return { nodes: [], edges: [] }
  }
}
