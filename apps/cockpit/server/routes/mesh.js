import { Router } from 'express'
import { getMeshNodes } from '../parsers/meshtastic.js'

const router = Router()

router.get('/nodes', (req, res) => {
  try {
    res.json(getMeshNodes())
  } catch {
    res.status(500).json({ error: 'Failed to read mesh nodes' })
  }
})

export { router }
