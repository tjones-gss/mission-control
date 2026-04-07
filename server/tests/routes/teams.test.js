vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    readdir: vi.fn(),
    rename: vi.fn(),
  }
  return {
    default: { promises },
    promises,
  }
})
vi.mock('../../parsers/teams.js', () => ({ getAllTeams: vi.fn().mockReturnValue([]) }))
vi.mock('../../utils/validate.js', async (importOriginal) => importOriginal())

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import { getAllTeams } from '../../parsers/teams.js'
import { router } from '../../routes/teams.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
  fsp.access.mockResolvedValue(undefined)
  fsp.mkdir.mockResolvedValue(undefined)
  fsp.readdir.mockResolvedValue([])
  fsp.readFile.mockResolvedValue('[]')
  fsp.writeFile.mockResolvedValue(undefined)
  fsp.rename.mockResolvedValue(undefined)
})

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns all teams', async () => {
    getAllTeams.mockReturnValue([{ name: 'my-team' }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ name: 'my-team' }])
  })
})

// ─── POST /:name/inbox ───────────────────────────────────────────────────────

describe('POST /:name/inbox', () => {
  it('400 when team name is invalid', async () => {
    const res = await request(app).post('/bad team!!/inbox').send({ content: 'hi' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid team name/i)
  })

  it('400 when content is missing', async () => {
    const res = await request(app).post('/my-team/inbox').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/content is required/i)
  })

  it('400 when content is empty string', async () => {
    const res = await request(app).post('/my-team/inbox').send({ content: '  ' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/content is required/i)
  })

  it('404 when team directory does not exist', async () => {
    fsp.access.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await request(app).post('/no-team/inbox').send({ content: 'hello' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/team not found/i)
  })

  it('creates message and returns 201', async () => {
    fsp.readFile.mockRejectedValueOnce(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const res = await request(app).post('/my-team/inbox').send({ content: 'hello world' })
    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe('string')
    expect(res.body.id.length).toBeGreaterThan(0)
    expect(res.body.content).toBe('hello world')
    expect(res.body.sender).toBe('user')
    expect(res.body.read).toBe(false)
    expect(res.body.archived).toBe(false)
    expect(fsp.writeFile).toHaveBeenCalledTimes(1)
    expect(fsp.rename).toHaveBeenCalledTimes(1)
  })

  it('appends to existing messages', async () => {
    const existing = [
      {
        id: 'old-id',
        content: 'old',
        sender: 'agent',
        timestamp: 't',
        read: true,
        archived: false,
      },
    ]
    fsp.readFile.mockResolvedValueOnce(JSON.stringify(existing))

    const res = await request(app).post('/my-team/inbox').send({ content: 'new message' })
    expect(res.status).toBe(201)

    const written = JSON.parse(fsp.writeFile.mock.calls[0][1])
    expect(written).toHaveLength(2)
    expect(written[1].content).toBe('new message')
  })

  it('uses custom sender when provided', async () => {
    const res = await request(app).post('/my-team/inbox').send({ content: 'hi', sender: 'claude' })
    expect(res.body.sender).toBe('claude')
  })

  it('uses atomic write (write + rename)', async () => {
    const res = await request(app).post('/my-team/inbox').send({ content: 'test' })
    expect(res.status).toBe(201)
    // Should write to a tmp file, then rename
    const writePath = fsp.writeFile.mock.calls[0][0]
    expect(writePath).toContain('.tmp.')
    expect(fsp.rename).toHaveBeenCalledWith(writePath, expect.stringContaining('dashboard.json'))
  })
})

// ─── PATCH /:name/inbox/:messageId ──────────────────────────────────────────

describe('PATCH /:name/inbox/:messageId', () => {
  it('400 when team name is invalid', async () => {
    const res = await request(app).patch('/bad team/inbox/msg-1').send({ read: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid team name/i)
  })

  it('400 when message ID is invalid', async () => {
    const res = await request(app).patch('/my-team/inbox/bad id!!').send({ read: true })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid message id/i)
  })

  it('400 when neither read nor archived is provided', async () => {
    const res = await request(app).patch('/my-team/inbox/some-id').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/read or archived is required/i)
  })

  it('404 when team does not exist', async () => {
    fsp.access.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const res = await request(app).patch('/no-team/inbox/some-id').send({ read: true })
    expect(res.status).toBe(404)
  })

  it('404 when message id is not found', async () => {
    fsp.readdir.mockResolvedValue(['agent.json'])
    fsp.readFile.mockResolvedValue(
      JSON.stringify([{ id: 'other-id', content: 'x', read: false, archived: false }]),
    )

    const res = await request(app).patch('/my-team/inbox/missing-id').send({ read: true })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/message not found/i)
  })

  it('marks message as read and returns updated message', async () => {
    const msg = {
      id: 'msg-123',
      content: 'hello',
      sender: 'agent',
      timestamp: 't',
      read: false,
      archived: false,
    }
    fsp.readdir.mockResolvedValue(['agent.json'])
    fsp.readFile.mockResolvedValue(JSON.stringify([msg]))

    const res = await request(app).patch('/my-team/inbox/msg-123').send({ read: true })
    expect(res.status).toBe(200)
    expect(res.body.read).toBe(true)
    expect(res.body.id).toBe('msg-123')
    expect(fsp.rename).toHaveBeenCalledTimes(1)
  })

  it('archives a message', async () => {
    const msg = {
      id: 'msg-456',
      content: 'hi',
      sender: 'user',
      timestamp: 't',
      read: false,
      archived: false,
    }
    fsp.readdir.mockResolvedValue(['dashboard.json'])
    fsp.readFile.mockResolvedValue(JSON.stringify([msg]))

    const res = await request(app).patch('/my-team/inbox/msg-456').send({ archived: true })
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)
  })
})
