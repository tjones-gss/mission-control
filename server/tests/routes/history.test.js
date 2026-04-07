vi.mock('../../parsers/history.js', () => ({
  getHistory: vi.fn().mockReturnValue([]),
  getHistoryStats: vi.fn().mockReturnValue({
    total: 0,
    topCommand: null,
    topProject: null,
    today: 0,
    dailyActivity: [],
  }),
}))

import express from 'express'
import request from 'supertest'
import { getHistory, getHistoryStats } from '../../parsers/history.js'
import { router } from '../../routes/history.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => vi.resetAllMocks())

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('calls getHistory with default limit=100, offset=0', async () => {
    getHistory.mockReturnValue([{ display: 'a', timestamp: 1000 }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(getHistory).toHaveBeenCalledWith(100, 0, {
      project: undefined,
      from: undefined,
      to: undefined,
    })
    expect(res.body).toEqual([{ display: 'a', timestamp: 1000 }])
  })

  it('passes limit and offset query params', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?limit=50&offset=100')
    expect(getHistory).toHaveBeenCalledWith(50, 100, expect.anything())
  })

  it('passes project filter', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?project=/my/project')
    expect(getHistory).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ project: '/my/project' }),
    )
  })

  it('parses from and to as integers', async () => {
    getHistory.mockReturnValue([])
    await request(app).get('/?from=1000&to=5000')
    expect(getHistory).toHaveBeenCalledWith(
      expect.any(Number),
      expect.any(Number),
      expect.objectContaining({ from: 1000, to: 5000 }),
    )
  })
})

// ─── GET /stats ──────────────────────────────────────────────────────────────

describe('GET /stats', () => {
  it('returns stats from getHistoryStats()', async () => {
    const mockStats = {
      total: 42,
      topCommand: 'git status',
      topProject: '/p',
      today: 5,
      dailyActivity: [],
    }
    getHistoryStats.mockReturnValue(mockStats)
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockStats)
  })

  it('returns zeroed stats when history is empty', async () => {
    getHistoryStats.mockReturnValue({
      total: 0,
      topCommand: null,
      topProject: null,
      today: 0,
      dailyActivity: [],
    })
    const res = await request(app).get('/stats')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
  })
})
