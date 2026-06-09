import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createRequire } from 'node:module'

// Importing the factory is socket-free (auto-listen is guarded behind the
// is-entry-module check), so this exercises the REAL mounted /api/docs surface
// the same way a browser would reach it — through buildApp().
import { buildApp } from '../../index.js'

const require = createRequire(import.meta.url)
const serverPkg = require('../../package.json')

describe('OpenAPI docs surface (mounted via buildApp)', () => {
  it('serves the swagger-ui HTML at GET /api/docs', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/docs/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toMatch(/swagger-ui/i)
  })

  it('serves a valid OpenAPI 3 document at GET /api/docs.json', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/docs.json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.body.openapi).toMatch(/^3\./)
    expect(res.body.info.title).toBe('Mission Control Cockpit API')
  })

  it('reports info.version equal to the server package version (0.4.0)', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/docs.json')
    expect(res.body.info.version).toBe(serverPkg.version)
    expect(res.body.info.version).toBe('0.4.0')
  })

  it('exposes the CORE paths in the served spec', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/docs.json')
    expect(res.body.paths).toBeTypeOf('object')
    // A representative slice of the CORE surface annotated this step.
    expect(res.body.paths).toHaveProperty('/api/health')
    expect(res.body.paths).toHaveProperty('/api/fleet')
    expect(res.body.paths).toHaveProperty('/api/sessions/{sessionId}/tool-approval')
  })

  it('is reachable WITHOUT an Origin header (a GET docs route is not Origin-pinned)', async () => {
    const app = buildApp()
    // No .set('Origin', ...) — a plain GET, as a fresh browser tab issues.
    const html = await request(app).get('/api/docs/')
    const json = await request(app).get('/api/docs.json')
    expect(html.status).toBe(200)
    expect(json.status).toBe(200)
  })

  it('mounts BEFORE the /api 404 catch-all (docs.json is not shadowed)', async () => {
    const app = buildApp()
    const res = await request(app).get('/api/docs.json')
    // If the 404 catch-all shadowed it, this would be 404 + NOT_FOUND.
    expect(res.status).toBe(200)
    expect(res.body.code).not.toBe('NOT_FOUND')
  })
})
