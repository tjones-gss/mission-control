// Phase I2 — GET /api/patterns
//
// Supertest over the REAL buildApp() with a temp-file db (no route-level mocks):
// patterns mined from a session's tool calls, query + session filters, and the
// 503-with-hint degraded contract.
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

// A session that edits a file and then runs the test suite, plus a git command.
function writeSessionJsonl(
  sessionId,
  commands,
  { project = 'C--proj', cwd = 'C:/work/proj' } = {},
) {
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
        content: [
          { type: 'tool_use', name: 'Edit', input: { file_path: '/a.js' } },
          ...commands.map((command) => ({ type: 'tool_use', name: 'Bash', input: { command } })),
        ],
      },
    },
  ]
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-patterns-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
  app = buildApp()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('GET /api/patterns', () => {
  it('returns aggregated patterns mined from a session, no query', async () => {
    upsertSession(writeSessionJsonl('sess-1', ['git status', 'npm run test']))
    const res = await request(app).get('/api/patterns')
    expect(res.status).toBe(200)
    expect(res.body.count).toBeGreaterThanOrEqual(1)
    const kinds = res.body.results.map((r) => r.kind)
    expect(kinds).toContain('workflow') // edit→test
    expect(kinds).toContain('command') // git
    const git = res.body.results.find((r) => r.trigger === 'git')
    expect(git.example_session_ids).toContain('sess-1')
  })

  it('filters results by the q parameter', async () => {
    upsertSession(writeSessionJsonl('sess-1', ['git status', 'docker build .']))
    const res = await request(app).get('/api/patterns').query({ q: 'git' })
    expect(res.status).toBe(200)
    expect(res.body.query).toBe('git')
    expect(res.body.results.every((r) => /git/i.test(`${r.trigger} ${r.response} ${r.kind}`))).toBe(
      true,
    )
    expect(res.body.results.find((r) => r.trigger === 'docker')).toBeFalsy()
  })

  it('restricts to one session with the session parameter', async () => {
    upsertSession(writeSessionJsonl('sess-1', ['git status'], { project: 'C--a', cwd: 'C:/a' }))
    upsertSession(writeSessionJsonl('sess-2', ['docker build .'], { project: 'C--b', cwd: 'C:/b' }))
    const res = await request(app).get('/api/patterns').query({ session: 'sess-2' })
    expect(res.status).toBe(200)
    expect(res.body.results.find((r) => r.trigger === 'git')).toBeFalsy()
    expect(res.body.results.find((r) => r.trigger === 'docker')).toBeTruthy()
  })

  it('503s with a recovery hint when the db is unavailable', async () => {
    closeDb()
    const asFile = path.join(tmpDir, 'block')
    fs.writeFileSync(asFile, 'x')
    openDb(path.join(asFile, 'cockpit.db'))
    const res = await request(app).get('/api/patterns')
    expect(res.status).toBe(503)
    expect(res.body.hint).toMatch(/cockpit\.db/)
  })
})
