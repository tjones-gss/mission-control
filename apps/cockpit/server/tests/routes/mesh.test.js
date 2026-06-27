import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import request from 'supertest'

// The route is a thin pass-through over the parser (mirrors routes/hooks.js), so
// we mock the parser and assert the HTTP contract: 200 + the parser's shape.
vi.mock('../../parsers/meshtastic.js', () => ({
  getMeshNodes: vi.fn(),
}))
import { getMeshNodes } from '../../parsers/meshtastic.js'
import { router } from '../../routes/mesh.js'

function createApp() {
  const app = express()
  app.use('/api/mesh', router)
  return app
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('mesh routes', () => {
  it('GET /nodes returns 200 with the parsed nodes payload', async () => {
    getMeshNodes.mockReturnValue({
      nodes: [{ nodeId: 'n1', shortName: 'BASE', snr: 11, lastHeard: 1, battery: 90, hopLimit: 0 }],
      degraded: false,
    })
    const res = await request(createApp()).get('/api/mesh/nodes')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.nodes)).toBe(true)
    expect(res.body.nodes[0].nodeId).toBe('n1')
    expect(res.body.degraded).toBe(false)
  })

  it('GET /nodes returns 200 with degraded marker when no data is present', async () => {
    getMeshNodes.mockReturnValue({ nodes: [], degraded: true })
    const res = await request(createApp()).get('/api/mesh/nodes')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ nodes: [], degraded: true })
  })

  it('GET /nodes returns 500 if the parser throws', async () => {
    getMeshNodes.mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await request(createApp()).get('/api/mesh/nodes')
    expect(res.status).toBe(500)
    expect(res.body).toHaveProperty('error')
  })
})
