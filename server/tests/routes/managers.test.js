import { describe, it, expect, vi } from 'vitest'

vi.mock('../../parsers/sessions.js', () => ({
  getAllSessions: vi.fn(() => [
    {
      sessionId: 'a',
      cwd: 'C:\\projects\\repo-a',
      isActive: true,
      needsInput: false,
      lastModified: Date.now(),
      lastText: 'hi',
      model: 'claude-sonnet-4-6',
      permissionMode: 'default',
      estimatedCost: { totalCost: 1 },
    },
    {
      sessionId: 'b',
      cwd: 'C:\\projects\\repo-b',
      isActive: false,
      needsInput: false,
      lastModified: Date.now() - 60_000,
      lastText: 'hi',
      model: 'claude-sonnet-4-6',
      permissionMode: 'default',
      estimatedCost: { totalCost: 2 },
    },
  ]),
}))

import express from 'express'
import request from 'supertest'
import { router } from '../../routes/managers.js'

function createApp() {
  const app = express()
  app.use('/api/managers', router)
  return app
}

describe('managers route', () => {
  it('GET /api/managers returns the manager grouping', async () => {
    const app = createApp()
    const res = await request(app).get('/api/managers')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('managers')
    expect(res.body).toHaveProperty('standalone')
    expect(Array.isArray(res.body.managers)).toBe(true)
    expect(res.body.managers).toHaveLength(1)
    expect(res.body.managers[0].childCount).toBe(2)
    expect(res.body.managers[0].slug).toBe('projects')
  })

  it('child rows include sessionId and slug', async () => {
    const app = createApp()
    const res = await request(app).get('/api/managers')
    const m = res.body.managers[0]
    expect(m.children).toHaveLength(2)
    expect(m.children[0]).toHaveProperty('sessionId')
    expect(m.children[0]).toHaveProperty('slug')
  })
})
