// Pipeline node-type definitions + the canvas→Fleet serializer.
//
// The canvas is a richer DAG than Fleet's flat fan-out, so serialization is a
// deliberate, lossy mapping for V2: agent nodes become the children to spawn,
// their goals are folded into one goal brief, and a Human node flips the
// approval policy. The DAG topology (edges, conditions, fan-out/merge) is
// preserved in the saved canvas JSON (server/data/pipelines) but is advisory
// context for the run, not a new execution engine. No new runner — the existing
// fleet-runner enforces the hard child caps.

// Each type: id (stable), label (palette + node), glyph (single char for the SVG
// node badge — kept ascii so no font dependency), and defaultConfig.
export const NODE_TYPES = [
  { id: 'trigger', label: 'Trigger', glyph: '⏱', defaultConfig: { kind: 'manual' } },
  { id: 'agent', label: 'Agent', glyph: '◆', defaultConfig: { goal: '', cwd: '' } },
  { id: 'skill', label: 'Skill', glyph: '✦', defaultConfig: { skill: '' } },
  { id: 'condition', label: 'Condition', glyph: '?', defaultConfig: { expr: '' } },
  { id: 'fanout', label: 'Fan-out', glyph: '⋔', defaultConfig: {} },
  { id: 'merge', label: 'Merge', glyph: '⋈', defaultConfig: {} },
  { id: 'human', label: 'Human', glyph: '✋', defaultConfig: { prompt: 'Approve?' } },
]

const BY_ID = new Map(NODE_TYPES.map((t) => [t.id, t]))

export function nodeType(id) {
  return BY_ID.get(id) || null
}

let seq = 0

// Create a node of `type` at (x, y) with a fresh id and a deep copy of the type
// default config. A monotonic counter keeps ids unique without relying on
// Date.now()/Math.random() collisions inside a tight loop.
export function makeNode(type, x, y) {
  const def = BY_ID.get(type)
  if (!def) throw new Error(`unknown node type: ${type}`)
  seq += 1
  return {
    id: `n${seq}-${type}`,
    type,
    x,
    y,
    config: JSON.parse(JSON.stringify(def.defaultConfig)),
  }
}

// Serialize the canvas to the existing POST /api/fleet body shape:
//   { goal, children, policy }
// - children: one entry per agent node, each { cwd, prompt } — the exact shape
//   startFleetRun/validateFleetRequest expects (fleet-runner enforces the hard
//   cap and the cwd whitelist/git-repo preconditions). An agent node with no
//   cwd is sent with an empty cwd so the server rejects it with a clear
//   "child N is missing cwd" message rather than failing silently.
// - goal: pipeline name + each agent node's goal, so the run carries the
//   pipeline intent even though Fleet itself is a flat fan-out.
// - policy.requireApproval: true iff a Human (oversight gate) node is present.
export function serializeToFleetSpec(nodes, edges, name) {
  const agents = nodes.filter((n) => n.type === 'agent')
  const hasHuman = nodes.some((n) => n.type === 'human')

  const lines = [name]
  agents.forEach((a, i) => {
    const goal = (a.config && a.config.goal) || '(no goal set)'
    lines.push(`${i + 1}. ${goal}`)
  })

  const children = agents.map((a) => ({
    cwd: ((a.config && a.config.cwd) || '').trim(),
    prompt: ((a.config && a.config.goal) || '').trim() || name,
  }))

  return {
    goal: lines.join('\n'),
    children,
    policy: { requireApproval: hasHuman },
  }
}
