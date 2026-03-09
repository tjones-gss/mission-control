vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(),
      promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    mkdirSync: vi.fn(), writeFileSync: vi.fn(), unlinkSync: vi.fn(),
    promises,
  }
})
vi.mock('../../parsers/tasks.js', () => ({
  getAllTaskSessions: vi.fn().mockReturnValue([]),
  getTasksForSession: vi.fn().mockReturnValue([]),
}))

import express from 'express'
import request from 'supertest'
import fs from 'fs'
import { getAllTaskSessions, getTasksForSession } from '../../parsers/tasks.js'
import { router } from '../../routes/tasks.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns getAllTaskSessions() result', async () => {
    const sessions = [{ sessionId: 'abc', tasks: [] }]
    getAllTaskSessions.mockReturnValue(sessions)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(sessions)
  })
})

// ─── GET /:sessionId ─────────────────────────────────────────────────────────

describe('GET /:sessionId', () => {
  it('returns getTasksForSession() result', async () => {
    const tasks = [{ id: '1', subject: 'Fix bug', status: 'pending' }]
    getTasksForSession.mockReturnValue(tasks)
    const res = await request(app).get('/session-abc')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(tasks)
  })
})

// ─── POST /:sessionId ────────────────────────────────────────────────────────

describe('POST /:sessionId', () => {
  it('400 when sessionId is invalid', async () => {
    const res = await request(app).post('/bad session id').send({ subject: 'Test' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid sessionId/i)
  })

  it('201 creates a new task with auto-incremented id', async () => {
    fs.existsSync.mockReturnValue(false) // session dir does not exist
    fs.mkdirSync.mockReturnValue(undefined)
    fs.readdirSync.mockReturnValue([]) // no existing tasks
    fs.writeFileSync.mockReturnValue(undefined)

    const res = await request(app).post('/mysession').send({
      subject: 'Write tests',
      description: 'Write route tests',
      status: 'in_progress',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: '1',
      subject: 'Write tests',
      description: 'Write route tests',
      status: 'in_progress',
    })
  })

  it('auto-increments id beyond existing tasks', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['1.json', '2.json', '3.json'])
    fs.writeFileSync.mockReturnValue(undefined)

    const res = await request(app).post('/mysession').send({ subject: 'New task' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('4')
  })

  it('task defaults to pending status when not provided', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    fs.writeFileSync.mockReturnValue(undefined)

    const res = await request(app).post('/mysession').send({})
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')
  })
})

// ─── PUT /:sessionId/:taskId ──────────────────────────────────────────────────

describe('PUT /:sessionId/:taskId', () => {
  it('400 when sessionId is invalid', async () => {
    const res = await request(app).put('/bad session/1').send({ subject: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid sessionId or taskId/i)
  })

  it('400 when taskId is invalid', async () => {
    const res = await request(app).put('/mysession/bad task').send({ subject: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid sessionId or taskId/i)
  })

  it('404 when task not found', async () => {
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).put('/mysession/99').send({ subject: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/task not found/i)
  })

  it('200 with updated task', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.writeFileSync.mockReturnValue(undefined)

    const res = await request(app).put('/mysession/1').send({
      subject: 'Updated task',
      status: 'completed',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: '1',
      subject: 'Updated task',
      status: 'completed',
    })
  })
})

// ─── DELETE /:sessionId/:taskId ───────────────────────────────────────────────

describe('DELETE /:sessionId/:taskId', () => {
  it('400 when sessionId is invalid', async () => {
    const res = await request(app).delete('/bad session/1')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid sessionId or taskId/i)
  })

  it('400 when taskId is invalid', async () => {
    const res = await request(app).delete('/mysession/bad task')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid sessionId or taskId/i)
  })

  it('404 when task not found', async () => {
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).delete('/mysession/99')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/task not found/i)
  })

  it('200 ok when task deleted', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.unlinkSync.mockReturnValue(undefined)
    const res = await request(app).delete('/mysession/1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
