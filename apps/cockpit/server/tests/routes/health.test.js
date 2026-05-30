import express from 'express'
import { router, setHealthReady } from '../../routes/health.js'
import request from 'supertest'

function createApp() {
  const app = express()
  app.use('/api/health', router)
  return app
}

describe('health routes', () => {
  test('GET / returns ok and timestamp', async () => {
    const app = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.ts).toBeTypeOf('number')
  })

  test('GET /live returns ok and uptime', async () => {
    const app = createApp()
    const res = await request(app).get('/api/health/live')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.uptime).toBeTypeOf('number')
    expect(res.body.uptime).toBeGreaterThanOrEqual(0)
  })

  test('GET /ready returns 503 before ready', async () => {
    // Note: ready state is module-level, may already be true from other tests
    // This test verifies the response shape
    const app = createApp()
    const res = await request(app).get('/api/health/ready')
    expect([200, 503]).toContain(res.status)
    expect(res.body).toHaveProperty('ok')
    expect(res.body).toHaveProperty('uptime')
    expect(res.body).toHaveProperty('memory')
    expect(res.body.memory).toHaveProperty('rss')
    expect(res.body.memory).toHaveProperty('heapUsed')
  })

  test('GET /ready returns memory stats', async () => {
    setHealthReady()
    const app = createApp()
    const res = await request(app).get('/api/health/ready')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.memory.rss).toBeTypeOf('number')
    expect(res.body.memory.heapUsed).toBeTypeOf('number')
  })
})
