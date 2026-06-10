// ADR-0008 Phase 5 — GET /api/stats/usage
//
// Supertest over the REAL buildApp() with a temp-file db (no route-level
// mocks): SQL aggregation grouped by day/project/model, pricing from
// utils/cost.js, parameter validation, and the 503-with-hint degraded
// contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildApp } from '../../index.js'
import { openDb, closeDb } from '../../lib/db/connection.js'
import { upsertSession } from '../../lib/db/session-index.js'

let tmpDir
let projectsDir
let app

function writeSessionJsonl(
  sessionId,
  { project = 'C--proj', cwd = 'C:/work/proj', model = 'claude-sonnet-4-6', usage = {} } = {},
) {
  const dir = path.join(projectsDir, project)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const records = [
    {
      type: 'user',
      timestamp: '2026-06-01T00:00:00Z',
      cwd,
      isSidechain: false,
      message: { role: 'user', content: `work for ${sessionId}` },
    },
    {
      type: 'assistant',
      timestamp: '2026-06-01T00:00:05Z',
      isSidechain: false,
      message: {
        role: 'assistant',
        model,
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 200,
          cache_creation_input_tokens: 100,
          ...usage,
        },
        content: [{ type: 'text', text: 'done' }],
      },
    },
  ]
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-stats-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
  app = buildApp()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/stats/usage', () => {
  it('defaults to groupBy=day and returns rows with tokens, cost, and cache hit rate', async () => {
    upsertSession(writeSessionJsonl('sess-day'))
    const res = await request(app).get('/api/stats/usage')
    expect(res.status).toBe(200)
    expect(res.body.groupBy).toBe('day')
    expect(res.body.rows).toHaveLength(1)
    const row = res.body.rows[0]
    expect(row.key).toBe('2026-06-01')
    expect(row.input).toBe(1000)
    expect(row.output).toBe(500)
    expect(row.cacheRead).toBe(200)
    expect(row.cacheWrite).toBe(100)
    expect(typeof row.cost).toBe('number')
    expect(typeof row.cacheHitRate).toBe('number')
    expect(res.body.totals.input).toBe(1000)
  })

  it('groups by project', async () => {
    upsertSession(writeSessionJsonl('sess-pa', { cwd: 'C:/work/alpha' }))
    upsertSession(writeSessionJsonl('sess-pb', { project: 'C--beta', cwd: 'C:/work/beta' }))
    const res = await request(app).get('/api/stats/usage').query({ groupBy: 'project' })
    expect(res.status).toBe(200)
    expect(res.body.groupBy).toBe('project')
    expect(res.body.rows.map((r) => r.key).sort()).toEqual(['C:/work/alpha', 'C:/work/beta'])
  })

  it('groups by model family', async () => {
    upsertSession(writeSessionJsonl('sess-ma', { model: 'claude-sonnet-4-6' }))
    upsertSession(writeSessionJsonl('sess-mb', { project: 'C--beta', model: 'claude-opus-4-5' }))
    const res = await request(app).get('/api/stats/usage').query({ groupBy: 'model' })
    expect(res.status).toBe(200)
    expect(res.body.rows.map((r) => r.key).sort()).toEqual(['opus', 'sonnet'])
  })

  it('400s on an invalid groupBy', async () => {
    const res = await request(app).get('/api/stats/usage').query({ groupBy: 'vibes' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/groupBy/i)
  })

  it('503s with a clear hint when the db is unavailable', async () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db')) // forces dbUnavailable
    const res = await request(app).get('/api/stats/usage')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/unavailable/i)
    expect(res.body.hint).toMatch(/cockpit\.db/i)
  })

  it('is documented in the served OpenAPI spec', async () => {
    const res = await request(app).get('/api/docs.json')
    expect(res.status).toBe(200)
    expect(res.body.paths).toHaveProperty('/api/stats/usage')
  })
})
