import { Router } from 'express'
import { getTasksForSession, getAllTaskSessions } from '../parsers/tasks.js'

export const router = Router()

router.get('/', (req, res) => {
  res.json(getAllTaskSessions())
})

router.get('/:sessionId', (req, res) => {
  res.json(getTasksForSession(req.params.sessionId))
})
