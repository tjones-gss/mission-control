import { Router } from 'express'

const router = Router()
const startTime = Date.now()
let ready = false

export function setHealthReady() {
  ready = true
}

router.get('/', (req, res) => {
  res.json({ ok: true, ts: Date.now() })
})

router.get('/live', (req, res) => {
  res.json({ ok: true, uptime: Date.now() - startTime })
})

router.get('/ready', (req, res) => {
  const mem = process.memoryUsage()
  const status = ready ? 200 : 503
  res.status(status).json({
    ok: ready,
    uptime: Date.now() - startTime,
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
  })
})

export { router }
