import { Router } from 'express'
import { getHooksConfig } from '../parsers/hooks.js'

const router = Router()

router.get('/', (req, res) => {
  try {
    const hooks = getHooksConfig()
    res.json(hooks)
  } catch (err) {
    res.status(500).json({ error: 'Failed to read hooks config' })
  }
})

export { router }
