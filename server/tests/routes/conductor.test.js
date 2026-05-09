vi.mock('../../parsers/conductor.js', () => ({
  getConductorRuns: vi.fn().mockReturnValue([]),
  getConductorRunById: vi.fn().mockReturnValue(null),
  readRunFile: vi.fn().mockReturnValue(null),
}))

import express from 'express'
import request from 'supertest'
import { getConductorRuns, getConductorRunById, readRunFile } from '../../parsers/conductor.js'
import { router } from '../../routes/conductor.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /', () => {
  it('returns the parser output as JSON', async () => {
    const runs = [{ adr: '0011', phase: 'build', projectPath: 'C:/x', isPaused: false }]
    getConductorRuns.mockReturnValue(runs)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(runs)
  })
})

describe('GET /:projectKey/:adr', () => {
  it('400 on malformed ADR', async () => {
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/abcd`)
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_adr')
  })

  it('404 when parser returns null (whitelist miss)', async () => {
    getConductorRunById.mockReturnValue(null)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/0011`)
    expect(res.status).toBe(404)
  })

  it('200 with the run when parser hits', async () => {
    const run = { adr: '0011', phase: 'escalated', isPaused: true }
    getConductorRunById.mockReturnValue(run)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/0011`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(run)
  })
})

describe('GET /:projectKey/:adr/:kind', () => {
  it('404 on unknown kind', async () => {
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/0011/garbage`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('unknown_kind')
  })

  it('400 on malformed ADR', async () => {
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/abcd/journal`)
    expect(res.status).toBe(400)
  })

  it('404 when readRunFile returns null', async () => {
    readRunFile.mockReturnValue(null)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/0011/journal`)
    expect(res.status).toBe(404)
  })

  it('200 text/plain when readRunFile hits', async () => {
    readRunFile.mockReturnValue('# Journal\nhello')
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}/0011/journal`)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('# Journal\nhello')
  })
})
