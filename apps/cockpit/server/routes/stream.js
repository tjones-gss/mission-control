import { Router } from 'express'
import { addClient, removeClient } from '../watcher.js'
import { initClient } from '../sse.js'

export const router = Router()

router.get('/', (req, res) => {
  initClient(res)
  res.on('close', () => removeClient(res))
  addClient(res)
})
