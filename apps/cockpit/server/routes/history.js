import { Router } from 'express'
import { getHistory, getHistoryStats } from '../parsers/history.js'

export const router = Router()

router.get('/stats', (req, res) => {
  res.json(getHistoryStats())
})

router.get('/', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 100, 1), 1000)
  const offset = Math.max(parseInt(req.query.offset) || 0, 0)
  const { project, from, to } = req.query
  res.json(
    getHistory(limit, offset, {
      project,
      from: from != null ? parseInt(from) : undefined,
      to: to != null ? parseInt(to) : undefined,
    }),
  )
})
