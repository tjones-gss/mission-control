// Phase I2 — GET /api/patterns: cross-session pattern intelligence, served from
// the derived SQLite pattern index (lib/db/pattern-index.js). Read-only. Unlike
// /api/search, `q` is optional — an empty query returns every aggregated
// pattern (newest/most-common first); `session` restricts to patterns a given
// session contributed to (powers the "Patterns in this session" panel).
import { Router } from 'express'
import { isDbUnavailable } from '../lib/db/connection.js'
import { searchPatterns } from '../lib/db/pattern-index.js'

const router = Router()

/**
 * @openapi
 * /api/patterns:
 *   get:
 *     summary: Aggregated cross-session behavioural patterns.
 *     description: >
 *       Deterministic (no-LLM) habits mined from every session's tool calls and
 *       aggregated by signature — e.g. a command run across many sessions, or an
 *       edit→test verify habit. Served from the derived SQLite cache; returns
 *       503 with a recovery hint while the cache is unavailable.
 *     tags: [Patterns]
 *     parameters:
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Optional case-insensitive substring filter over trigger/response/kind.
 *       - in: query
 *         name: session
 *         schema: { type: string }
 *         description: Restrict to patterns the given session contributed to.
 *     responses:
 *       200:
 *         description: Aggregated patterns with cross-session count, recency, and example session ids.
 *       503:
 *         description: The SQLite cache is unavailable; the body's `hint` explains the delete-and-restart recovery.
 */
router.get('/', (req, res) => {
  if (isDbUnavailable()) {
    return res.status(503).json({
      error: 'Pattern index unavailable',
      hint:
        'The SQLite cache (apps/cockpit/server/data/cockpit.db) could not be opened. ' +
        'It is a derived cache — delete the cockpit.db file (and its -wal/-shm siblings) ' +
        'and restart the server to rebuild it from ~/.claude.',
    })
  }

  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  const session = typeof req.query.session === 'string' ? req.query.session : undefined
  const results = searchPatterns(q, { session })
  res.json({ query: q, count: results.length, results })
})

export { router }
