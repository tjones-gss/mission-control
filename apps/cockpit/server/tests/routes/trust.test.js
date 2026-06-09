import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory trust-store mock (same shape as pty-session.test.js).
const trusted = new Set()
vi.mock('../../lib/trust-store.js', () => ({
  isCwdTrusted: (cwd) => trusted.has(cwd),
  trustCwd: vi.fn((cwd) => {
    if (!cwd || typeof cwd !== 'string') return false
    trusted.add(cwd)
    return true
  }),
  untrustCwd: vi.fn((cwd) => trusted.delete(cwd) || true),
  listTrustedCwds: () => [...trusted],
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import express from 'express'
import request from 'supertest'
import path from 'node:path'
import { trustCwd, untrustCwd } from '../../lib/trust-store.js'
import { logger } from '../../lib/logger.js'
import { router } from '../../routes/trust.js'

const app = express()
app.use(express.json())
app.use('/', router)

// Absolute on BOTH platforms (validateCwd uses path.isAbsolute, which is
// platform-dependent): path.resolve yields C:\... on Windows and /... on Linux CI.
const CWD = path.resolve('/work/trusted-proj')

beforeEach(() => {
  vi.clearAllMocks()
  trusted.clear()
})

describe('GET /', () => {
  it('returns the trusted list', async () => {
    trusted.add(CWD)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.trusted).toEqual([CWD])
  })
})

describe('POST /', () => {
  it('grants trust for a valid absolute cwd and logs it', async () => {
    const res = await request(app).post('/').send({ cwd: CWD })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.trusted).toContain(CWD)
    expect(trustCwd).toHaveBeenCalledWith(CWD)
    expect(logger.warn).toHaveBeenCalledWith({ detail: CWD }, 'trust_granted')
  })

  it('rejects a relative cwd with 400 and does not trust it', async () => {
    const res = await request(app).post('/').send({ cwd: 'relative/path' })
    expect(res.status).toBe(400)
    expect(trustCwd).not.toHaveBeenCalled()
  })

  it("rejects a cwd with a '..' segment", async () => {
    const res = await request(app).post('/').send({ cwd: 'C:/a/../b' })
    expect(res.status).toBe(400)
    expect(trustCwd).not.toHaveBeenCalled()
  })

  it('rejects a missing cwd with 400', async () => {
    const res = await request(app).post('/').send({})
    expect(res.status).toBe(400)
    expect(trustCwd).not.toHaveBeenCalled()
  })
})

describe('DELETE /', () => {
  it('revokes trust for a valid cwd and logs it', async () => {
    trusted.add(CWD)
    const res = await request(app).delete('/').send({ cwd: CWD })
    expect(res.status).toBe(200)
    expect(res.body.trusted).not.toContain(CWD)
    expect(untrustCwd).toHaveBeenCalledWith(CWD)
    expect(logger.warn).toHaveBeenCalledWith({ detail: CWD }, 'trust_revoked')
  })

  it('rejects an invalid cwd with 400', async () => {
    const res = await request(app).delete('/').send({ cwd: '' })
    expect(res.status).toBe(400)
    expect(untrustCwd).not.toHaveBeenCalled()
  })
})
