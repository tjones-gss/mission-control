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
vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn().mockResolvedValue({ stdout: '{"result":"ok"}', stderr: '', exitCode: 0 }),
}))

import express from 'express'
import request from 'supertest'
import { getAllSessions, getSessionById } from '../../parsers/sessions.js'
import { getSessionMessages } from '../../parsers/messages.js'
import { runClaude } from '../../claude-cli.js'
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

// ─── POST /:sessionId/message ───────────────────────────────────────────────

describe('POST /:sessionId/message', () => {
  it('400 when message is missing', async () => {
    const res = await request(app).post('/abc123/message').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message is required/i)
  })

  it('400 when message is empty string', async () => {
    const res = await request(app).post('/abc123/message').send({ message: '   ' })
    expect(res.status).toBe(400)
  })

  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(404)
  })

  it('200 when message sent successfully', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    runClaude.mockResolvedValue({ stdout: '{"result":"done"}', stderr: '', exitCode: 0 })
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(runClaude).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['--resume', 'abc123', '-p', 'hello']),
    }))
  })

  it('503 when CLI fails', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    runClaude.mockRejectedValue(new Error('CLI crashed'))
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('send_failed')
  })
})

// ─── POST /:sessionId/skill ─────────────────────────────────────────────────

describe('POST /:sessionId/skill', () => {
  it('400 when skill is missing', async () => {
    const res = await request(app).post('/abc123/skill').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/skill is required/i)
  })

  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(404)
  })

  it('200 when skill invoked successfully', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    runClaude.mockResolvedValue({ stdout: '{"result":"committed"}', stderr: '', exitCode: 0 })
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(runClaude).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['-p', '/commit']),
    }))
  })

  it('sends skill with args', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    runClaude.mockResolvedValue({ stdout: '{}', stderr: '', exitCode: 0 })
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit', args: '-m "fix"' })
    expect(res.status).toBe(200)
    expect(runClaude).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['-p', '/commit -m "fix"']),
    }))
  })
})

// ─── POST /new ──────────────────────────────────────────────────────────────

describe('POST /new', () => {
  it('400 when prompt is missing', async () => {
    const res = await request(app).post('/new').send({ cwd: '/tmp' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt is required/i)
  })

  it('400 when cwd is missing', async () => {
    const res = await request(app).post('/new').send({ prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cwd is required/i)
  })

  it('201 when session created successfully', async () => {
    runClaude.mockResolvedValue({ stdout: '{"session":"new123"}', stderr: '', exitCode: 0 })
    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(runClaude).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(['-p', 'hello', '--output-format', 'json']),
      cwd: '/tmp',
    }))
  })

  it('503 when CLI fails', async () => {
    runClaude.mockRejectedValue(new Error('spawn failed'))
    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('session_create_failed')
  })
})
