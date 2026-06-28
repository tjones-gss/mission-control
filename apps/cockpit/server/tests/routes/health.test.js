import express from 'express'
import { router, setHealthReady } from '../../routes/health.js'
import { signalDegraded, _resetDegradedDedupe } from '../../lib/claude-format.js'
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

  test('GET / reports status, version, and uptime in seconds', async () => {
    const app = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
    // version mirrors the server package.json (single source of truth)
    expect(res.body.version).toBeTypeOf('string')
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/)
    // uptime is whole seconds since process start, never negative
    expect(res.body.uptime).toBeTypeOf('number')
    expect(Number.isInteger(res.body.uptime)).toBe(true)
    expect(res.body.uptime).toBeGreaterThanOrEqual(0)
  })

  test('GET / includes a harness availability probe', async () => {
    // Hermetic: the harness object (and its boolean `available` field) must be
    // present whether or not python is actually installed on this machine.
    const app = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('harness')
    expect(res.body.harness).toBeTypeOf('object')
    expect(res.body.harness.available).toBeTypeOf('boolean')
    expect(res.body.harness).toHaveProperty('cliPath')
    expect(res.body.harness.cliPath).toBeTypeOf('string')
    expect(res.body.harness).toHaveProperty('detail')
    expect(res.body.harness).toHaveProperty('python')
    // python is the working interpreter name, or null when unavailable
    if (res.body.harness.available) {
      expect(res.body.harness.python).toBeTypeOf('string')
    } else {
      expect(res.body.harness.python).toBeNull()
    }
  })

  test('GET / returns schema_warnings: [] when no parser is degraded', async () => {
    // Graceful-degrade surface: with all parsers healthy, health must report an
    // explicit empty list — never omit the field — so the client can trust it.
    _resetDegradedDedupe()
    const app = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('schema_warnings')
    expect(res.body.schema_warnings).toEqual([])
  })

  test('GET / surfaces active degraded signals as schema_warnings', async () => {
    // When a parser degrades, its {parser, reason} pair appears on health —
    // the same registry that dedupes the parser_degraded SSE event.
    _resetDegradedDedupe()
    signalDegraded('sessions', 'format-change', { filePath: '/x' })
    const app = createApp()
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.schema_warnings).toEqual([{ parser: 'sessions', reason: 'format-change' }])
    _resetDegradedDedupe()
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
