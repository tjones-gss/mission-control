import { Router } from 'express'
import { getAdoptCandidates, isAdoptableTarget } from '../parsers/harness.js'
import { adoptRails } from '../lib/rails-installer.js'
import { logger } from '../lib/logger.js'

export const router = Router()

// ──────────────────────────────────────────────────────────────────────────────
// Concurrency guard (mirrors routes/harness.js): a double-click must not run two
// adopters into the same project. Keys are released in a finally so they can't
// leak. In-memory is the right scope — the server is the single writer.
// ──────────────────────────────────────────────────────────────────────────────
const inFlight = new Set()

function acquire(key) {
  if (inFlight.has(key)) return false
  inFlight.add(key)
  return true
}

function release(key) {
  inFlight.delete(key)
}

// Test-only: clear the in-flight registry between cases.
export function __resetInFlight() {
  inFlight.clear()
}

// ──────────────────────────────────────────────────────────────────────────────
// GET /api/rails/adopt-candidates
// Session cwds that are real dirs without a Claude adapter yet (the "needs rails"
// set). Powers the in-cockpit "Add rails" picker.
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/rails/adopt-candidates:
 *   get:
 *     summary: Session cwds that are real dirs without a Claude adapter yet (the "needs rails" set).
 *     tags: [Rails]
 *     responses:
 *       200:
 *         description: Candidate project paths for one-click rails adoption.
 */
router.get('/adopt-candidates', (_req, res) => {
  let candidates = []
  try {
    candidates = getAdoptCandidates()
  } catch {
    candidates = []
  }
  res.json({ candidates: Array.isArray(candidates) ? candidates : [] })
})

// ──────────────────────────────────────────────────────────────────────────────
// POST /api/rails/adopt
// One-click in-cockpit rails adoption. Validates the target against the session-cwd
// whitelist (never write to an arbitrary path), then copies the pure-Node Claude
// adapter in DIRECTLY (no python, no bash, no Claude session). The watcher then
// sees the new .claude/ and the client refetches.
// ──────────────────────────────────────────────────────────────────────────────
/**
 * @openapi
 * /api/rails/adopt:
 *   post:
 *     summary: One-click in-cockpit rails adoption (copies the Node Claude adapter into a whitelisted project).
 *     tags: [Rails]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [projectPath]
 *             properties:
 *               projectPath:
 *                 type: string
 *     responses:
 *       200:
 *         description: Rails adopted.
 *       400:
 *         description: Invalid or non-whitelisted target.
 *       409:
 *         description: An adoption is already in flight for this project.
 */
router.post('/adopt', (req, res) => {
  const { projectPath } = req.body || {}

  if (typeof projectPath !== 'string' || !projectPath) {
    return res.status(400).json({ error: 'invalid_target' })
  }

  // Whitelist membership BEFORE any write — only the user's own session cwds.
  if (!isAdoptableTarget(projectPath)) {
    return res.status(403).json({ error: 'path_not_allowed' })
  }

  const lockKey = `adopt:${projectPath}`
  if (!acquire(lockKey)) {
    return res.status(409).json({ error: 'in_progress' })
  }

  try {
    const result = adoptRails(projectPath)

    if (result && result.ok && result.alreadyPresent) {
      return res.status(409).json({ ok: false, error: 'already_present' })
    }
    if (result && result.ok) {
      return res.status(201).json(result)
    }
    logger.warn({ projectPath, detail: result && result.error }, 'rails_adopt_failed')
    return res.status(502).json(result || { ok: false, error: 'adopt_failed' })
  } finally {
    release(lockKey)
  }
})
