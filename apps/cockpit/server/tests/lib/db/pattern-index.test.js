// ADR-0008 / Phase I2 — lib/db/pattern-index.js
//
// Real node:sqlite in a temp dir, mirroring the usage-index test harness.
// Covers: deterministic (no-LLM) pattern extraction from a session's tool-use
// sequence, the idempotent whole-session reindex inside the upsertSession
// transaction (re-running a session never double-counts), cross-session
// aggregation (count = distinct sessions), and the query/session filters.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, withTransaction } from '../../../lib/db/connection.js'
import {
  extractPatterns,
  reindexSessionPatterns,
  searchPatterns,
} from '../../../lib/db/pattern-index.js'

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patterns-'))
  openDb(path.join(tmpDir, 'cockpit.db'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

// One assistant record carrying tool_use blocks.
function toolTurn(...blocks) {
  return {
    type: 'assistant',
    isSidechain: false,
    message: {
      role: 'assistant',
      content: blocks.map((b) => ({ type: 'tool_use', name: b.name, input: b.input || {} })),
    },
  }
}

describe('extractPatterns (pure, no LLM)', () => {
  it('extracts a command habit from a Bash call, keyed by the leading verb', () => {
    const patterns = extractPatterns([toolTurn({ name: 'Bash', input: { command: 'git status' } })])
    const cmd = patterns.find((p) => p.kind === 'command')
    expect(cmd).toBeTruthy()
    expect(cmd.trigger).toBe('git')
  })

  it('dedupes a repeated command within one session', () => {
    const patterns = extractPatterns([
      toolTurn({ name: 'Bash', input: { command: 'git status' } }),
      toolTurn({ name: 'Bash', input: { command: 'git diff' } }),
    ])
    expect(patterns.filter((p) => p.kind === 'command' && p.trigger === 'git').length).toBe(1)
  })

  it('extracts an edit→test workflow when a test command follows an edit', () => {
    const patterns = extractPatterns([
      toolTurn({ name: 'Edit', input: { file_path: '/a.js' } }),
      toolTurn({ name: 'Bash', input: { command: 'npm run test' } }),
    ])
    expect(patterns.find((p) => p.kind === 'workflow')).toBeTruthy()
  })

  it('does NOT emit the edit→test workflow when there is no edit', () => {
    const patterns = extractPatterns([toolTurn({ name: 'Bash', input: { command: 'vitest run' } })])
    expect(patterns.find((p) => p.kind === 'workflow')).toBeFalsy()
  })

  it('returns nothing for a session with no tool calls', () => {
    expect(extractPatterns([{ type: 'user', message: { content: 'hi' } }])).toEqual([])
  })
})

describe('reindexSessionPatterns + searchPatterns (real db)', () => {
  const editThenTest = [
    toolTurn({ name: 'Edit', input: { file_path: '/a.js' } }),
    toolTurn({ name: 'Bash', input: { command: 'npm run test' } }),
  ]

  function reindex(sessionId, records, lastSeen = 1_700_000_000_000) {
    withTransaction((tx) => reindexSessionPatterns(tx, sessionId, records, lastSeen))
  }

  it('indexes a session pattern, count=1 with the session in example ids', () => {
    reindex('s1', editThenTest)
    const results = searchPatterns('')
    const wf = results.find((r) => r.kind === 'workflow')
    expect(wf).toBeTruthy()
    expect(wf.count).toBe(1)
    expect(wf.example_session_ids).toContain('s1')
    expect(typeof wf.last_seen).toBe('number')
  })

  it('is idempotent — reindexing the same session does not double-count', () => {
    reindex('s1', editThenTest)
    reindex('s1', editThenTest)
    const wf = searchPatterns('').find((r) => r.kind === 'workflow')
    expect(wf.count).toBe(1)
  })

  it('aggregates the same pattern across two sessions (count=2)', () => {
    reindex('s1', editThenTest)
    reindex('s2', editThenTest)
    const wf = searchPatterns('').find((r) => r.kind === 'workflow')
    expect(wf.count).toBe(2)
    expect(wf.example_session_ids).toEqual(expect.arrayContaining(['s1', 's2']))
  })

  it('filters by query string over trigger/response/kind', () => {
    reindex('s1', [toolTurn({ name: 'Bash', input: { command: 'git push' } })])
    reindex('s2', [toolTurn({ name: 'Bash', input: { command: 'docker build .' } })])
    const git = searchPatterns('git')
    expect(git.length).toBe(1)
    expect(git[0].trigger).toBe('git')
  })

  it('filters to a single session with the session option', () => {
    reindex('s1', [toolTurn({ name: 'Bash', input: { command: 'git push' } })])
    reindex('s2', [toolTurn({ name: 'Bash', input: { command: 'docker build .' } })])
    const forS2 = searchPatterns('', { session: 's2' })
    expect(forS2.every((r) => r.example_session_ids.includes('s2'))).toBe(true)
    expect(forS2.find((r) => r.trigger === 'git')).toBeFalsy()
  })

  it('returns [] when the db is unavailable (degraded mode)', () => {
    closeDb()
    // Nest the db path UNDER an existing file: mkdir of the parent fails on
    // both win/posix, openDb exhausts its retry, and getDb() returns null.
    const asFile = path.join(tmpDir, 'block')
    fs.writeFileSync(asFile, 'x')
    openDb(path.join(asFile, 'cockpit.db'))
    expect(searchPatterns('')).toEqual([])
  })
})
