vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn(), promises },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), statSync: vi.fn(), promises,
  }
})
vi.mock('../../parsers/plans.js', () => ({
  getAllPlans: vi.fn().mockReturnValue([]),
  getPlanByFilename: vi.fn().mockReturnValue(null),
}))

import express from 'express'
import request from 'supertest'
import { getAllPlans, getPlanByFilename } from '../../parsers/plans.js'
import { router } from '../../routes/plans.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns plan list from getAllPlans()', async () => {
    const mockData = [
      { filename: 'plan-a.md', name: 'Plan A', lastModified: 5000 },
      { filename: 'plan-b.md', name: 'Plan B', lastModified: 3000 },
    ]
    getAllPlans.mockReturnValue(mockData)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockData)
  })
})

// ─── GET /:filename ─────────────────────────────────────────────────────────

describe('GET /:filename', () => {
  it('returns plan content when found', async () => {
    const mockPlan = {
      filename: 'deploy.md',
      name: 'Deploy Plan',
      content: '# Deploy Plan\n\nStep 1.',
      lastModified: 4000,
    }
    getPlanByFilename.mockReturnValue(mockPlan)
    const res = await request(app).get('/deploy.md')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(mockPlan)
  })

  it('returns 404 when plan not found', async () => {
    getPlanByFilename.mockReturnValue(null)
    const res = await request(app).get('/missing.md')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/plan not found/i)
  })
})
