vi.mock('fs', () => {
  const promises = { access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn(), unlink: vi.fn() }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      writeFileSync: vi.fn(), mkdirSync: vi.fn(), promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    writeFileSync: vi.fn(), mkdirSync: vi.fn(), promises,
  }
})
vi.mock('../../parsers/teams.js', () => ({ getAllTeams: vi.fn().mockReturnValue([]) }))

import express from 'express'
import request from 'supertest'
import fs from 'fs'
import { getAllTeams } from '../../parsers/teams.js'
import { router } from '../../routes/teams.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => vi.resetAllMocks())

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
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).post('/no-team/inbox').send({ content: 'hello' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/team not found/i)
  })

  it('creates dashboard.json if it does not exist and returns 201', async () => {
    // team dir exists, inboxes dir exists, dashboard.json does not
    fs.existsSync.mockImplementation(p => !p.includes('dashboard.json'))
    fs.readdirSync.mockReturnValue([])
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'hello world' })
    expect(res.status).toBe(201)
    expect(typeof res.body.id).toBe('string')
    expect(res.body.id.length).toBeGreaterThan(0)
    expect(res.body.content).toBe('hello world')
    expect(res.body.sender).toBe('user')
    expect(res.body.read).toBe(false)
    expect(res.body.archived).toBe(false)
    expect(fs.writeFileSync).toHaveBeenCalled()
  })

  it('appends to existing dashboard.json', async () => {
    const existing = [{ id: 'old-id', content: 'old', sender: 'agent', timestamp: 't', read: true, archived: false }]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(existing))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'new message' })
    expect(res.status).toBe(201)

    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1])
    expect(written).toHaveLength(2)
    expect(written[1].content).toBe('new message')
  })

  it('uses custom sender when provided', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('[]')
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).post('/my-team/inbox').send({ content: 'hi', sender: 'claude' })
    expect(res.body.sender).toBe('claude')
  })
})

// ─── PATCH /:name/inbox/:messageId ──────────────────────────────────────────

describe('PATCH /:name/inbox/:messageId', () => {
  it('400 when neither read nor archived is provided', async () => {
    const res = await request(app).patch('/my-team/inbox/some-id').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/read or archived is required/i)
  })

  it('404 when team does not exist', async () => {
    fs.existsSync.mockReturnValue(false)
    const res = await request(app).patch('/no-team/inbox/some-id').send({ read: true })
    expect(res.status).toBe(404)
  })

  it('404 when message id is not found in any inbox file', async () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['agent.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([{ id: 'other-id', content: 'x', read: false, archived: false }]))

    const res = await request(app).patch('/my-team/inbox/missing-id').send({ read: true })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/message not found/i)
  })

  it('marks message as read and returns updated message', async () => {
    const msg = { id: 'msg-123', content: 'hello', sender: 'agent', timestamp: 't', read: false, archived: false }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['agent.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([msg]))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).patch('/my-team/inbox/msg-123').send({ read: true })
    expect(res.status).toBe(200)
    expect(res.body.read).toBe(true)
    expect(res.body.id).toBe('msg-123')
  })

  it('archives a message', async () => {
    const msg = { id: 'msg-456', content: 'hi', sender: 'user', timestamp: 't', read: false, archived: false }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['dashboard.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify([msg]))
    fs.writeFileSync.mockImplementation(() => {})

    const res = await request(app).patch('/my-team/inbox/msg-456').send({ archived: true })
    expect(res.status).toBe(200)
    expect(res.body.archived).toBe(true)
  })
})
