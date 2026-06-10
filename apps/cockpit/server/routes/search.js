// ADR-0008 Phase 2 — GET /api/search: full-text search over everything the
// agents have ever said or done, served from the SQLite message index
// (lib/db/message-index.js). Read-only; the cockpit never writes to ~/.claude.
import { Router } from 'express'
import { isDbUnavailable } from '../lib/db/connection.js'
import { searchMessages, MAX_LIMIT } from '../lib/db/message-index.js'

const router = Router()

// Accept either an ms epoch or anything Date.parse understands (ISO dates).
// Returns NaN for unparseable input so the caller can 400 it.
function parseTimeParam(value) {
  if (value === undefined) return undefined
  const asNumber = Number(value)
  if (Number.isFinite(asNumber)) return asNumber
  return Date.parse(value)
}

/**
 * @openapi
 * /api/search:
 *   get:
 *     summary: Full-text search across all indexed session messages.
 *     description: >
 *       FTS5 (porter-stemmed) match over user/assistant text, thinking, and
 *       tool-input summaries, joined to the session index. Results are ordered
 *       by BM25 relevance, then recency. Served from the derived SQLite cache;
 *       returns 503 with a recovery hint while the cache is unavailable.
 *     tags: [Search]
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: The search phrase (plain words; FTS operators are escaped).
 *       - in: query
 *         name: project
 *         schema: { type: string }
 *         description: Case-insensitive substring filter on the session cwd.
 *       - in: query
 *         name: from
 *         schema: { type: string }
 *         description: Only sessions modified at/after this time (ms epoch or ISO date).
 *       - in: query
 *         name: to
 *         schema: { type: string }
 *         description: Only sessions modified at/before this time (ms epoch or ISO date).
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20, maximum: 100 }
 *         description: Max hits to return (clamped to 100).
 *     responses:
 *       200:
 *         description: Matching message hits with `<mark>` snippet highlights and session metadata for deep-linking.
 *       400:
 *         description: Missing/blank q, or unparseable from/to/limit.
 *       503:
 *         description: The SQLite cache is unavailable; the body's `hint` explains the delete-and-restart recovery.
 */
router.get('/', (req, res) => {
  if (isDbUnavailable()) {
    return res.status(503).json({
      error: 'Search index unavailable',
      hint:
        'The SQLite cache (apps/cockpit/server/data/cockpit.db) could not be opened. ' +
        'It is a derived cache — delete the cockpit.db file (and its -wal/-shm siblings) ' +
        'and restart the server to rebuild it from ~/.claude.',
    })
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) {
    return res.status(400).json({ error: 'Missing required query parameter: q' })
  }

  const from = parseTimeParam(req.query.from)
  const to = parseTimeParam(req.query.to)
  if ((from !== undefined && Number.isNaN(from)) || (to !== undefined && Number.isNaN(to))) {
    return res
      .status(400)
      .json({ error: 'from/to must be a millisecond epoch or a parseable date string' })
  }

  let limit
  if (req.query.limit !== undefined) {
    limit = Number(req.query.limit)
    if (!Number.isFinite(limit)) {
      return res.status(400).json({ error: `limit must be a number (1-${MAX_LIMIT})` })
    }
  }

  const project = typeof req.query.project === 'string' ? req.query.project : undefined
  const results = searchMessages({ q, project, from, to, limit })
  res.json({ query: q, count: results.length, results })
})

export { router }
