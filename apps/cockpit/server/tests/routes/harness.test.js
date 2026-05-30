import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../parsers/harness.js', () => ({
  getHarnessProjects: vi.fn().mockReturnValue([]),
  getHarnessProjectByPath: vi.fn().mockReturnValue(null),
}))

import express from 'express'
import request from 'supertest'
import { getHarnessProjects, getHarnessProjectByPath } from '../../parsers/harness.js'
import { router } from '../../routes/harness.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /', () => {
  it('returns 200 with a projects array', async () => {
    getHarnessProjects.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.projects)).toBe(true)
  })

  it('wraps the parser output under { projects }', async () => {
    const projects = [{ projectPath: 'C:/x', available: true }]
    getHarnessProjects.mockReturnValue(projects)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ projects })
  })
})

describe('GET /:projectKey', () => {
  it('404 when the path is not a known harness root (whitelist miss)', async () => {
    getHarnessProjectByPath.mockReturnValue(null)
    const res = await request(app).get(`/${encodeURIComponent('C:/unknown')}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('200 with the detail object when the parser hits', async () => {
    const detail = { projectPath: 'C:/x', projectLabel: 'x', project: { mode: 'idea-to-mvp' } }
    getHarnessProjectByPath.mockReturnValue(detail)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(detail)
  })

  it('200 passing through an available:false detail (available:false is a valid contract result)', async () => {
    // The parser found a known root but the CLI was unreachable. Per contract
    // this is a successful response carrying available:false — NOT a 4xx.
    const detail = {
      available: false,
      error: 'harness unavailable: python/python3 not found or harness script missing',
      projectPath: 'C:/x',
      projectLabel: 'x',
    }
    getHarnessProjectByPath.mockReturnValue(detail)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(detail)
  })
})
