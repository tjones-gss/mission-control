// ADR-0008 Phase 5 — GET /api/stats/usage: token/cost analytics aggregated
// from the SQLite usage_daily rollups (lib/db/usage-index.js), priced at read
// time with the utils/cost.js tables. Read-only; the cockpit never writes to
// ~/.claude.
import { Router } from 'express'
import { isDbUnavailable } from '../lib/db/connection.js'
import { getUsageStats, GROUP_BYS } from '../lib/db/usage-index.js'

const router = Router()

/**
 * @openapi
 * /api/stats/usage:
 *   get:
 *     summary: Token usage and cost analytics, grouped by project, day, or model.
 *     description: >
 *       Pure SQL aggregation over the per-session daily token rollups in the
 *       derived SQLite cache, priced with the cockpit's model pricing tables.
 *       Each row carries token sums (input/output/cacheRead/cacheWrite),
 *       estimated USD cost, and cache-hit-rate; totals span all rows.
 *       Returns 503 with a recovery hint while the cache is unavailable.
 *     tags: [Stats]
 *     parameters:
 *       - in: query
 *         name: groupBy
 *         schema: { type: string, enum: [project, day, model], default: day }
 *         description: Aggregation axis — session cwd, UTC day, or model family.
 *     responses:
 *       200:
 *         description: "`{ groupBy, rows, totals }` — days ascending, projects/models by cost descending."
 *       400:
 *         description: groupBy is not one of project, day, model.
 *       503:
 *         description: The SQLite cache is unavailable; the body's `hint` explains the delete-and-restart recovery.
 */
router.get('/usage', (req, res) => {
  if (isDbUnavailable()) {
    return res.status(503).json({
      error: 'Usage stats unavailable',
      hint:
        'The SQLite cache (apps/cockpit/server/data/cockpit.db) could not be opened. ' +
        'It is a derived cache — delete the cockpit.db file (and its -wal/-shm siblings) ' +
        'and restart the server to rebuild it from ~/.claude.',
    })
  }

  const groupBy = req.query.groupBy === undefined ? 'day' : String(req.query.groupBy)
  if (!GROUP_BYS.includes(groupBy)) {
    return res.status(400).json({ error: `groupBy must be one of: ${GROUP_BYS.join(', ')}` })
  }

  res.json(getUsageStats({ groupBy }))
})

export { router }
