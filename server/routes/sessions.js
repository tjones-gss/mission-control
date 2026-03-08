import { Router } from 'express'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'

export const router = Router()

router.get('/', (req, res) => {
  res.json(getAllSessions())
})

router.get('/:sessionId', (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})
