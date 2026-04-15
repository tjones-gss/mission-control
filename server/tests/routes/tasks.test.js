vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    unlink: vi.fn(),
    // rename is required by lib/atomic-write.js (writeFile-then-rename pattern).
    // Without it the route blows up with 'fs.rename is not a function' inside
    // atomicWrite, surfacing as a 500 in every test that exercises a write path.
    rename: vi.fn(),
  }
  return {
    default: { promises },
    promises,
  }
})
vi.mock('../../utils/validate.js', async (importOriginal) => importOriginal())
vi.mock('../../parsers/tasks.js', () => ({
  getAllTaskSessions: vi.fn().mockReturnValue([]),
  getTasksForSession: vi.fn().mockReturnValue([]),
}))

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import { getAllTaskSessions, getTasksForSession } from '../../parsers/tasks.js'
import { router } from '../../routes/tasks.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
  // Default: async operations resolve successfully
  fsp.mkdir.mockResolvedValue(undefined)
  fsp.readdir.mockResolvedValue([])
  fsp.writeFile.mockResolvedValue(undefined)
  fsp.access.mockResolvedValue(undefined)
  fsp.unlink.mockResolvedValue(undefined)
  fsp.rename.mockResolvedValue(undefined)
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
    expect(res.body.error).toMatch(/invalid session/i)
  })

  it('201 creates a new task with auto-incremented id', async () => {
    fsp.readdir.mockResolvedValue([]) // no existing tasks

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
    expect(fsp.mkdir).toHaveBeenCalledTimes(1)
    expect(fsp.writeFile).toHaveBeenCalledTimes(1)
  })

  it('auto-increments id beyond existing tasks', async () => {
    fsp.readdir.mockResolvedValue(['1.json', '2.json', '3.json'])

    const res = await request(app).post('/mysession').send({ subject: 'New task' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe('4')
  })

  it('task defaults to pending status when not provided', async () => {
    fsp.readdir.mockResolvedValue([])

    // POST now requires `subject` (the route returns 400 without it). Pass
    // a subject so the test exercises the status defaulting path it cares about.
    const res = await request(app).post('/mysession').send({ subject: 'New task' })
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
    // PUT is now read-modify-write: it reads the existing task FIRST so a
    // partial PUT doesn't wipe untouched fields. Mock readFile (not access)
    // to return ENOENT for the missing-file case.
    fsp.readFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await request(app).put('/mysession/99').send({ subject: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/task not found/i)
  })

  it('200 with updated task', async () => {
    // Existing task on disk that PUT will read, merge, and rewrite.
    fsp.readFile.mockResolvedValue(
      JSON.stringify({
        id: '1',
        subject: 'Old subject',
        description: 'Old desc',
        activeForm: '',
        status: 'pending',
        owner: '',
        blocks: [],
        blockedBy: [],
      }),
    )

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
    // Read-modify-write does ONE writeFile (atomic-write writes a temp file
    // then renames it onto the destination).
    expect(fsp.writeFile).toHaveBeenCalledTimes(1)
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
    fsp.unlink.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await request(app).delete('/mysession/99')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/task not found/i)
  })

  it('200 ok when task deleted', async () => {
    fsp.unlink.mockResolvedValue(undefined)
    const res = await request(app).delete('/mysession/1')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
  })
})
