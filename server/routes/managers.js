import { Router } from 'express'
import { getManagers } from '../parsers/managers.js'

export const router = Router()

router.get('/', (req, res) => {
  const result = getManagers()
  res.json(result)
})
