import { Router } from 'express'
import { getAllPlans, getPlanByFilename } from '../parsers/plans.js'

export const router = Router()

router.get('/', (req, res) => res.json(getAllPlans()))

router.get('/:filename', (req, res) => {
  const { filename } = req.params
  const plan = getPlanByFilename(filename)
  if (!plan) return res.status(404).json({ error: 'Plan not found.' })
  res.json(plan)
})
