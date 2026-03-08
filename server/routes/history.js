import { Router } from 'express'
import { getHistory } from '../parsers/history.js'

export const router = Router()

router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 100
  res.json(getHistory(limit))
})
