// Phase I3 — GET /api/graph: the knowledge graph, served from the derived SQLite
// node/edge cache (lib/db/knowledge-graph.js). Read-only. `node` is required —
// the response is that node's 2-hop neighbourhood as { node, nodes, edges },
// powering the GraphPanel's force-layout mini-graph in session detail.
import { Router } from 'express'
import { isDbUnavailable } from '../lib/db/connection.js'
import { getNeighbourhood } from '../lib/db/knowledge-graph.js'

const router = Router()

/**
 * @openapi
 * /api/graph:
 *   get:
 *     summary: The 2-hop knowledge-graph neighbourhood of a node.
 *     description: >
 *       Returns the nodes and edges within two hops of the given node id, derived
 *       (no-LLM) from every session's tool calls — session→file (touched),
 *       session→task (spawned), session→commit (produced). Node ids are
 *       prefixed by kind, e.g. `session:<id>`, `file:<path>`. Served from the
 *       derived SQLite cache; returns 503 with a recovery hint while unavailable.
 *     tags: [Graph]
 *     parameters:
 *       - in: query
 *         name: node
 *         required: true
 *         schema: { type: string }
 *         description: The node id to centre the neighbourhood on (e.g. `session:<id>` or `file:<path>`).
 *     responses:
 *       200:
 *         description: The neighbourhood as { node, nodes, edges }. Unknown node → empty nodes/edges.
 *       400:
 *         description: The required `node` query parameter is missing.
 *       503:
 *         description: The SQLite cache is unavailable; the body's `hint` explains the delete-and-restart recovery.
 */
router.get('/', (req, res) => {
  if (isDbUnavailable()) {
    return res.status(503).json({
      error: 'Knowledge graph unavailable',
      hint:
        'The SQLite cache (apps/cockpit/server/data/cockpit.db) could not be opened. ' +
        'It is a derived cache — delete the cockpit.db file (and its -wal/-shm siblings) ' +
        'and restart the server to rebuild it from ~/.claude.',
    })
  }

  const node = typeof req.query.node === 'string' ? req.query.node.trim() : ''
  if (!node) {
    return res.status(400).json({ error: 'The `node` query parameter is required.' })
  }

  const { nodes, edges } = getNeighbourhood(node)
  res.json({ node, nodes, edges })
})

export { router }
