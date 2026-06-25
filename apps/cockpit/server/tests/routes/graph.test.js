// Phase I3 — GET /api/graph
//
// Supertest over the REAL buildApp() with a temp-file db (no route-level mocks):
// the 2-hop neighbourhood of a node, the file-centric cross-session query, and
// the 503-with-hint degraded contract.
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

function writeSessionJsonl(sessionId, files, { project = 'C--proj', cwd = 'C:/work/proj' } = {}) {
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
      message: { role: 'user', content: 'do the thing' },
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
        content: files.map((fp) => ({ type: 'tool_use', name: 'Edit', input: { file_path: fp } })),
      },
    },
  ]
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-graph-route-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
  app = buildApp()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/graph', () => {
  it('returns the neighbourhood of a session node with its touched file edges', async () => {
    upsertSession(writeSessionJsonl('sess-1', ['/repo/auth.js', '/repo/auth.test.js']))
    const res = await request(app).get('/api/graph').query({ node: 'session:sess-1' })
    expect(res.status).toBe(200)
    expect(res.body.node).toBe('session:sess-1')
    const fileIds = res.body.nodes.filter((n) => n.kind === 'file').map((n) => n.id)
    expect(fileIds.sort()).toEqual(['file:/repo/auth.js', 'file:/repo/auth.test.js'])
    expect(res.body.edges.filter((e) => e.rel === 'touched')).toHaveLength(2)
  })

  it('reaches every session that touched a file via the file node', async () => {
    upsertSession(writeSessionJsonl('sess-1', ['/repo/auth.js'], { project: 'C--a', cwd: 'C:/a' }))
    upsertSession(writeSessionJsonl('sess-2', ['/repo/auth.js'], { project: 'C--b', cwd: 'C:/b' }))
    const res = await request(app).get('/api/graph').query({ node: 'file:/repo/auth.js' })
    expect(res.status).toBe(200)
    const sessionIds = res.body.nodes.filter((n) => n.kind === 'session').map((n) => n.id)
    expect(sessionIds.sort()).toEqual(['session:sess-1', 'session:sess-2'])
  })

  it('returns an empty graph for an unknown node', async () => {
    const res = await request(app).get('/api/graph').query({ node: 'session:nope' })
    expect(res.status).toBe(200)
    expect(res.body.nodes).toEqual([])
    expect(res.body.edges).toEqual([])
  })

  it('400s when the node parameter is missing', async () => {
    const res = await request(app).get('/api/graph')
    expect(res.status).toBe(400)
  })

  it('503s with a recovery hint when the db is unavailable', async () => {
    closeDb()
    const asFile = path.join(tmpDir, 'block')
    fs.writeFileSync(asFile, 'x')
    openDb(path.join(asFile, 'cockpit.db'))
    const res = await request(app).get('/api/graph').query({ node: 'session:sess-1' })
    expect(res.status).toBe(503)
    expect(res.body.hint).toMatch(/cockpit\.db/)
  })
})
