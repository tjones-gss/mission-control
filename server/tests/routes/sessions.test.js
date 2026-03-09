vi.mock('../../parsers/sessions.js', () => ({
  getAllSessions: vi.fn().mockReturnValue([]),
  getSessionById: vi.fn().mockReturnValue(null),
}))
vi.mock('../../parsers/messages.js', () => ({
  getSessionMessages: vi.fn().mockReturnValue(null),
}))
vi.mock('../../intelligence/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  getInFlight: vi.fn().mockReturnValue(null),
}))
vi.mock('../../intelligence/triggers.js', () => ({
  runAnalysis: vi.fn().mockResolvedValue({ summary: 'ok' }),
}))

import express from 'express'
import request from 'supertest'
import { getAllSessions, getSessionById } from '../../parsers/sessions.js'
import { getSessionMessages } from '../../parsers/messages.js'
import { router } from '../../routes/sessions.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns getAllSessions() result', async () => {
    const sessions = [{ id: 'abc', messages: [] }]
    getAllSessions.mockReturnValue(sessions)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(sessions)
  })

  it('returns empty array when no sessions', async () => {
    getAllSessions.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

// ─── GET /:sessionId ─────────────────────────────────────────────────────────

describe('GET /:sessionId', () => {
  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).get('/nonexistent-session')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/session not found/i)
  })

  it('200 with session data when found', async () => {
    const session = { id: 'abc123', messages: [], active: false }
    getSessionById.mockReturnValue(session)
    const res = await request(app).get('/abc123')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(session)
  })
})

// ─── GET /:sessionId/messages ─────────────────────────────────────────────────

describe('GET /:sessionId/messages', () => {
  it('404 when session not found', async () => {
    getSessionMessages.mockReturnValue(null)
    const res = await request(app).get('/nonexistent-session/messages')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/session not found/i)
  })

  it('200 with messages when found', async () => {
    const messages = [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hi!' }]
    getSessionMessages.mockReturnValue(messages)
    const res = await request(app).get('/abc123/messages')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(messages)
  })
})
