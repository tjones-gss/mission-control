import { Router } from 'express'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'

export const router = Router()

router.get('/', (req, res) => {
  res.json(getAllSessions())
})

router.get('/:sessionId', (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

router.get('/:sessionId/messages', (req, res) => {
  const result = getSessionMessages(req.params.sessionId)
  if (!result) return res.status(404).json({ error: 'Session not found' })
  res.json(result)
})

router.get('/:sessionId/intelligence', async (req, res) => {
  const { sessionId } = req.params

  const cached = getCached(sessionId)
  if (cached) return res.json({ ...cached.result, analyzedAt: cached.timestamp })

  const inFlight = getInFlight(sessionId)
  if (inFlight) {
    try {
      const result = await inFlight
      return res.json({ ...result, analyzedAt: Date.now() })
    } catch (err) {
      return res.status(503).json({
        error: 'analysis_failed',
        detail: err.message,
        stderr: err.stderrOutput || null,
      })
    }
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'not found' })

  try {
    const result = await runAnalysis(sessionId, session)
    res.json({ ...result, analyzedAt: Date.now() })
  } catch (err) {
    res.status(503).json({
      error: 'analysis_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  }
})
