import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock ONLY the whitelist source (parsers/harness.js). The installer + fs are
// REAL, against a tmp dir — this is the L2 "one-click rails adoption" integration
// proof: a POST yields the real .claude tree wired to the Node hooks.
vi.mock('../../parsers/harness.js', () => ({
  getAdoptCandidates: vi.fn(() => []),
  isAdoptableTarget: vi.fn(() => false),
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import express from 'express'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getAdoptCandidates, isAdoptableTarget } from '../../parsers/harness.js'
import { router, __resetInFlight } from '../../routes/rails.js'

const app = express()
app.use(express.json())
app.use('/', router)

let tmp
beforeEach(() => {
  vi.clearAllMocks()
  __resetInFlight()
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rails-route-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('GET /adopt-candidates', () => {
  it('returns the candidate array', async () => {
    getAdoptCandidates.mockReturnValue(['C:/a', 'C:/b'])
    const res = await request(app).get('/adopt-candidates')
    expect(res.status).toBe(200)
    expect(res.body.candidates).toEqual(['C:/a', 'C:/b'])
  })

  it('tolerates a parser failure with an empty array', async () => {
    getAdoptCandidates.mockImplementation(() => {
      throw new Error('boom')
    })
    const res = await request(app).get('/adopt-candidates')
    expect(res.status).toBe(200)
    expect(res.body.candidates).toEqual([])
  })
})

describe('POST /adopt', () => {
  it('adopts rails into a whitelisted dir (201) and lands the Node hooks', async () => {
    isAdoptableTarget.mockReturnValue(true)
    const res = await request(app).post('/adopt').send({ projectPath: tmp })

    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.hooks).toBe('node')
    expect(fs.existsSync(path.join(tmp, '.claude', 'hooks', 'block-danger.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(true)
    const settings = fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8')
    expect(settings).toContain('block-danger.mjs')
    expect(settings).not.toContain('block-danger.sh')
  })

  it('rejects a non-whitelisted path with 403', async () => {
    isAdoptableTarget.mockReturnValue(false)
    const res = await request(app).post('/adopt').send({ projectPath: 'C:/not/allowed' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('path_not_allowed')
  })

  it('rejects a missing projectPath with 400', async () => {
    const res = await request(app).post('/adopt').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_target')
  })

  it('returns 409 already_present on re-adopt', async () => {
    isAdoptableTarget.mockReturnValue(true)
    const first = await request(app).post('/adopt').send({ projectPath: tmp })
    expect(first.status).toBe(201)
    const second = await request(app).post('/adopt').send({ projectPath: tmp })
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('already_present')
  })
})
