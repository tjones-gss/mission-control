import { describe, it, expect } from 'vitest'
import request from 'supertest'

// The buildApp()/createApp factory is the single app builder S6's /api/docs work
// rebases onto (Phase 4 / D-audit-otel owns it). Importing it must be socket-free:
// the auto-listen in index.js is guarded behind an "is entry module" check, so this
// import does NOT bind a port.
import { buildApp, createApp } from '../index.js'

describe('index buildApp() factory', () => {
  it('exports buildApp and a createApp alias that is the same builder', () => {
    expect(typeof buildApp).toBe('function')
    expect(createApp).toBe(buildApp)
  })

  it('builds a configured express app WITHOUT binding a socket', async () => {
    const app = buildApp()
    expect(typeof app).toBe('function') // an express app is a request handler fn
    // It has a working health route mounted via the shared builder.
    const res = await request(app).get('/api/health')
    expect(res.status).toBeLessThan(500)
  })

  it('mounts the JSON 404 for an unmatched /api/* path (the shared builder wired it)', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/this-route-does-not-exist')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('NOT_FOUND')
  })

  it('each buildApp() call returns an independent app instance', () => {
    expect(buildApp()).not.toBe(buildApp())
  })
})
