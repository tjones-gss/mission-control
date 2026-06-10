// ADR-0008 Phase 6 — lib/db/intelligence-store.js
//
// The durable backing for intelligence/cache.js: one row per session in the
// intelligence table (analyzed_at + messageCount/subagentCount staleness
// snapshot + result_json), surviving restarts, plus a doc_type='summary' row
// in the messages index so analyses are searchable. Degraded mode falls back
// to an in-memory Map (the pre-Phase-6 behavior — functional, just amnesiac).
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, getDb } from '../../../lib/db/connection.js'
import {
  saveIntelligence,
  getIntelligence,
  _resetMemFallbackForTests,
} from '../../../lib/db/intelligence-store.js'
import { searchMessages } from '../../../lib/db/message-index.js'
import { upsertSession } from '../../../lib/db/session-index.js'

let tmpDir
let dbPath

const RESULT = {
  goal: 'refactor the warp drive scheduler',
  progress: 'about halfway through the dilithium tests',
  flags: ['budget burning fast'],
  subagents: 'none',
  recommendation: 'review the antimatter budget',
}

function writeSessionJsonl(sessionId, text, { project = 'C--proj', cwd = 'C:/work/proj' } = {}) {
  const dir = path.join(tmpDir, 'projects', project)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const record = {
    type: 'user',
    timestamp: '2026-06-01T00:00:00Z',
    cwd,
    isSidechain: false,
    message: { role: 'user', content: text },
  }
  fs.writeFileSync(filePath, JSON.stringify(record) + '\n')
  return filePath
}

function summaryRows(sessionId) {
  return getDb()
    .prepare(`SELECT * FROM messages WHERE session_id = ? AND doc_type = 'summary'`)
    .all(sessionId)
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-intel-test-'))
  dbPath = path.join(tmpDir, 'cockpit.db')
  openDb(dbPath)
  _resetMemFallbackForTests()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('saveIntelligence() / getIntelligence()', () => {
  it('round-trips the result with a timestamp', () => {
    const before = Date.now()
    const entry = saveIntelligence('sess-1', RESULT)
    expect(entry.result).toEqual(RESULT)
    const got = getIntelligence('sess-1')
    expect(got.result).toEqual(RESULT)
    expect(got.timestamp).toBeGreaterThanOrEqual(before)
  })

  it('returns null for an unknown session', () => {
    expect(getIntelligence('never-analyzed')).toBeNull()
  })

  it('persists the messageCount/subagentCount staleness snapshot', () => {
    saveIntelligence('sess-snap', RESULT, { messageCount: 42, subagentCount: 3 })
    const got = getIntelligence('sess-snap')
    expect(got.messageCount).toBe(42)
    expect(got.subagentCount).toBe(3)
  })

  it('stores null snapshot fields when no snapshot is given (API-stable setCached path)', () => {
    saveIntelligence('sess-nosnap', RESULT)
    const got = getIntelligence('sess-nosnap')
    expect(got.messageCount).toBeNull()
    expect(got.subagentCount).toBeNull()
  })

  it('survives a restart (closeDb + reopen on the same file)', () => {
    saveIntelligence('sess-restart', RESULT, { messageCount: 7, subagentCount: 0 })
    closeDb()
    openDb(dbPath)
    const got = getIntelligence('sess-restart')
    expect(got.result).toEqual(RESULT)
    expect(got.messageCount).toBe(7)
  })

  it('replaces the previous analysis on re-save (one row per session)', () => {
    saveIntelligence('sess-re', RESULT)
    saveIntelligence('sess-re', { ...RESULT, goal: 'a brand new goal' })
    expect(getIntelligence('sess-re').result.goal).toBe('a brand new goal')
    const rows = getDb()
      .prepare('SELECT count(*) AS n FROM intelligence WHERE session_id = ?')
      .get('sess-re')
    expect(rows.n).toBe(1)
  })
})

describe('summary docs in the search index', () => {
  it('writes a doc_type=summary row searchable via the types filter', () => {
    saveIntelligence('sess-sum', RESULT)
    const hits = searchMessages({ q: 'warp drive', types: ['summary'] })
    expect(hits).toHaveLength(1)
    expect(hits[0].sessionId).toBe('sess-sum')
    expect(hits[0].docType).toBe('summary')
    expect(hits[0].snippet).toContain('<mark>')
  })

  it('replaces (not appends) the summary row on re-analysis', () => {
    saveIntelligence('sess-sum2', RESULT)
    saveIntelligence('sess-sum2', { ...RESULT, goal: 'an updated direction' })
    expect(summaryRows('sess-sum2')).toHaveLength(1)
    expect(searchMessages({ q: 'updated direction', types: ['summary'] })).toHaveLength(1)
  })

  it('carries the session cwd so the project filter applies to summaries', () => {
    upsertSession(writeSessionJsonl('sess-cwd', 'hello there', { cwd: 'C:/work/epicenter' }))
    saveIntelligence('sess-cwd', RESULT)
    const hits = searchMessages({ q: 'warp', project: 'epicenter' })
    expect(hits.some((h) => h.docType === 'summary' && h.sessionId === 'sess-cwd')).toBe(true)
  })

  it('summary rows survive a session re-upsert (message reindex is doc_type-scoped)', () => {
    const filePath = writeSessionJsonl('sess-keep', 'ordinary message content')
    upsertSession(filePath)
    saveIntelligence('sess-keep', RESULT)
    upsertSession(filePath) // watcher change event → whole-session message reindex
    expect(summaryRows('sess-keep')).toHaveLength(1)
  })

  it('skips the summary row (but still persists) for a result with no text', () => {
    saveIntelligence('sess-empty', { goal: '', progress: '', flags: [] })
    expect(summaryRows('sess-empty')).toHaveLength(0)
    expect(getIntelligence('sess-empty')).not.toBeNull()
  })
})

describe('degraded mode (in-memory fallback)', () => {
  it('save/get still work when the db is unavailable', () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    saveIntelligence('sess-degraded', RESULT)
    expect(getIntelligence('sess-degraded').result).toEqual(RESULT)
  })
})
