import { Router } from 'express'
import { addClient, removeClient } from '../watcher.js'

export const router = Router()

router.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Send a heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write('event: heartbeat\ndata: {}\n\n')
    } catch {
      clearInterval(heartbeat)
      removeClient(res)
    }
  }, 30000)

  res.on('close', () => {
    clearInterval(heartbeat)
    removeClient(res)
  })
  addClient(res)
})
