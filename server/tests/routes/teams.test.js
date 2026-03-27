vi.mock('../../parsers/teams.js', () => ({
  getAllTeams: vi.fn().mockReturnValue([]),
}))

import express from 'express'
import request from 'supertest'
import { getAllTeams } from '../../parsers/teams.js'
import { router } from '../../routes/teams.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /', () => {
  it('returns empty array when no teams exist', async () => {
    getAllTeams.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })

  it('returns teams from parser', async () => {
    const teams = [
      { name: 'team-a', inboxes: {} },
      { name: 'team-b', inboxes: { agent1: [{ id: 1 }] } },
    ]
    getAllTeams.mockReturnValue(teams)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(teams)
    expect(res.body).toHaveLength(2)
  })

  it('delegates to getAllTeams parser', async () => {
    getAllTeams.mockReturnValue([])
    await request(app).get('/')
    expect(getAllTeams).toHaveBeenCalledTimes(1)
  })
})
