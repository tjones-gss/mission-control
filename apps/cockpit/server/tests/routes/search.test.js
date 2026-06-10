// ADR-0008 Phase 2 — GET /api/search
//
// Supertest over the REAL buildApp() with a temp-file db (no route-level
// mocks): FTS hits joined to sessions, snippet highlights, parameter
// validation, and the 503-with-hint degraded contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { buildApp } from '../../index.js'
import { openDb, closeDb } from '../../lib/db/connection.js'
import { upsertSession } from '../../lib/db/session-index.js'
import { indexMemoryFile } from '../../lib/db/memory-index.js'
import { saveIntelligence } from '../../lib/db/intelligence-store.js'

let tmpDir
let projectsDir
let app

function writeSessionJsonl(sessionId, text, { project = 'C--proj', cwd = 'C:/work/proj' } = {}) {
  const dir = path.join(projectsDir, project)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const records = [
    {
      type: 'user',
      timestamp: '2026-06-01T00:00:00Z',
      cwd,
      slug: `slug-${sessionId}`,
      isSidechain: false,
      message: { role: 'user', content: text },
    },
    {
      type: 'assistant',
      timestamp: '2026-06-01T00:00:05Z',
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: `acknowledged: ${text}` }],
      },
    },
  ]
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-search-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
  app = buildApp()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/search', () => {
  it('returns FTS hits joined to session metadata, with snippet highlights', async () => {
    upsertSession(writeSessionJsonl('sess-hit', 'the flux capacitor needs recalibration'))
    const res = await request(app).get('/api/search').query({ q: 'capacitor' })
    expect(res.status).toBe(200)
    expect(res.body.query).toBe('capacitor')
    expect(res.body.count).toBeGreaterThanOrEqual(1)
    const hit = res.body.results[0]
    expect(hit.sessionId).toBe('sess-hit')
    expect(hit.snippet).toContain('<mark>')
    expect(hit.cwd).toBe('C:/work/proj')
    expect(hit.slug).toBe('slug-sess-hit')
    expect(typeof hit.lastModified).toBe('number')
  })

  it('matches with porter stemming', async () => {
    upsertSession(writeSessionJsonl('sess-stem', 'we are refactoring the watcher'))
    const res = await request(app).get('/api/search').query({ q: 'refactor' })
    expect(res.status).toBe(200)
    expect(res.body.results.some((h) => h.sessionId === 'sess-stem')).toBe(true)
  })

  it('filters by project', async () => {
    upsertSession(writeSessionJsonl('sess-pa', 'shared keyword here', { cwd: 'C:/work/alpha' }))
    upsertSession(
      writeSessionJsonl('sess-pb', 'shared keyword here', {
        project: 'C--beta',
        cwd: 'C:/work/beta',
      }),
    )
    const res = await request(app).get('/api/search').query({ q: 'keyword', project: 'alpha' })
    expect(res.status).toBe(200)
    expect(res.body.results.map((h) => h.sessionId)).toEqual(['sess-pa', 'sess-pa'])
  })

  it('filters by from/to and accepts ISO dates', async () => {
    upsertSession(writeSessionJsonl('sess-time', 'temporal anomaly detected'))
    const future = await request(app)
      .get('/api/search')
      .query({ q: 'anomaly', from: '2099-01-01T00:00:00Z' })
    expect(future.status).toBe(200)
    expect(future.body.results).toEqual([])
    const past = await request(app)
      .get('/api/search')
      .query({ q: 'anomaly', to: '2000-01-01T00:00:00Z' })
    expect(past.body.results).toEqual([])
  })

  it('respects limit and caps it at 100', async () => {
    upsertSession(writeSessionJsonl('sess-lim', 'limit limit limit'))
    const res = await request(app).get('/api/search').query({ q: 'limit', limit: '1' })
    expect(res.status).toBe(200)
    expect(res.body.results).toHaveLength(1)
    const capped = await request(app).get('/api/search').query({ q: 'limit', limit: '99999' })
    expect(capped.status).toBe(200) // clamped, not rejected
  })

  it('400s on a missing or blank q', async () => {
    const missing = await request(app).get('/api/search')
    expect(missing.status).toBe(400)
    const blank = await request(app).get('/api/search').query({ q: '   ' })
    expect(blank.status).toBe(400)
  })

  it('400s on an unparseable from/to/limit', async () => {
    const badFrom = await request(app).get('/api/search').query({ q: 'x', from: 'not-a-date' })
    expect(badFrom.status).toBe(400)
    const badLimit = await request(app).get('/api/search').query({ q: 'x', limit: 'soon' })
    expect(badLimit.status).toBe(400)
  })

  it('survives FTS syntax characters in q', async () => {
    upsertSession(writeSessionJsonl('sess-syn', 'parenthetical content'))
    const res = await request(app).get('/api/search').query({ q: '"unbalanced (AND NOT' })
    expect(res.status).toBe(200)
  })

  // Phase 6 — knowledge surfacing: the type filter over doc_type.
  describe('type filter', () => {
    function writeMemoryFile(name, content) {
      const dir = path.join(projectsDir, 'C--proj', 'memory')
      fs.mkdirSync(dir, { recursive: true })
      const filePath = path.join(dir, name)
      fs.writeFileSync(filePath, content)
      return filePath
    }

    function seedKnowledge() {
      upsertSession(writeSessionJsonl('sess-k', 'the kraken lives in the message'))
      indexMemoryFile(writeMemoryFile('kraken.md', 'the kraken lives in a memory file'))
      saveIntelligence('sess-k', {
        goal: 'tame the kraken in this summary',
        progress: 'ongoing',
        flags: [],
        subagents: 'none',
        recommendation: null,
      })
    }

    it('defaults to all doc types', async () => {
      seedKnowledge()
      const res = await request(app).get('/api/search').query({ q: 'kraken' })
      expect(res.status).toBe(200)
      const kinds = new Set(res.body.results.map((h) => h.docType))
      expect(kinds).toEqual(new Set(['message', 'memory', 'summary']))
      const all = await request(app).get('/api/search').query({ q: 'kraken', type: 'all' })
      expect(new Set(all.body.results.map((h) => h.docType))).toEqual(kinds)
    })

    it('narrows to one doc type', async () => {
      seedKnowledge()
      const res = await request(app).get('/api/search').query({ q: 'kraken', type: 'memory' })
      expect(res.status).toBe(200)
      expect(res.body.results.map((h) => h.docType)).toEqual(['memory'])
      expect(res.body.results[0].slug).toBe('kraken.md')
    })

    it('accepts a comma-separated list', async () => {
      seedKnowledge()
      const res = await request(app)
        .get('/api/search')
        .query({ q: 'kraken', type: 'memory,summary' })
      expect(res.status).toBe(200)
      expect(new Set(res.body.results.map((h) => h.docType))).toEqual(
        new Set(['memory', 'summary']),
      )
    })

    it('400s on an unknown type', async () => {
      const res = await request(app).get('/api/search').query({ q: 'kraken', type: 'sonnet' })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/type/i)
    })
  })

  it('503s with a clear hint when the db is unavailable', async () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db')) // forces dbUnavailable
    const res = await request(app).get('/api/search').query({ q: 'anything' })
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/unavailable/i)
    expect(res.body.hint).toMatch(/cockpit\.db/i)
  })

  it('is documented in the served OpenAPI spec', async () => {
    const res = await request(app).get('/api/docs.json')
    expect(res.status).toBe(200)
    expect(res.body.paths).toHaveProperty('/api/search')
  })
})
