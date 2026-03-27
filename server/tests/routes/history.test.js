vi.mock('../../parsers/history.js', () => ({
  getHistory: vi.fn().mockReturnValue([]),
}))

import express from 'express'
import request from 'supertest'
import { getHistory } from '../../parsers/history.js'
import { router } from '../../routes/history.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /', () => {
  it('returns empty array when no history', async () => {
    getHistory.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns history entries', async () => {
    const entries = [
      { command: 'git status', timestamp: '2025-01-01T00:00:00Z' },
      { command: 'npm test', timestamp: '2025-01-01T01:00:00Z' },
    ]
    getHistory.mockReturnValue(entries)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(entries)
  })

  it('passes default limit of 100 when no query param', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/')
    expect(getHistory).toHaveBeenCalledWith(100)
  })

  it('passes custom limit from query param', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?limit=50')
    expect(getHistory).toHaveBeenCalledWith(50)
  })

  it('defaults to 100 for non-numeric limit', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?limit=abc')
    expect(getHistory).toHaveBeenCalledWith(100)
  })
})
