import { Router } from 'express'
import { getUserConfig } from '../parsers/config.js'

export const router = Router()

router.get('/', (_req, res) => {
  res.json(getUserConfig())
})
