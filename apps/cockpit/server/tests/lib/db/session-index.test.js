// ADR-0008 Phase 1 — lib/db/session-index.js
//
// Real node:sqlite in a temp dir + real fixture JSONL files in a temp
// projects tree. Covers: upsert/list/get parity with parseSessionRecord,
// the read-time recompute of isActive/needsInput (the #1 staleness trap —
// clock-mocked), unlink removal, and the chunked (mtime,size)-diff rebuild.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, getDb } from '../../../lib/db/connection.js'
import {
  upsertSession,
  removeSession,
  listSessions,
  getSession,
  rebuildAll,
  isIndexReady,
  _resetIndexReadyForTests,
} from '../../../lib/db/session-index.js'
import { parseSessionRecord } from '../../../parsers/sessions.js'

let tmpDir
let projectsDir

const FIVE_MIN = 5 * 60 * 1000
const FOUR_HOURS = 4 * 60 * 60 * 1000

function makeSessionJsonl(sessionId, { project = 'C--proj', stopReason = 'end_turn' } = {}) {
  const dir = path.join(projectsDir, project)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  const records = [
    {
      type: 'user',
      uuid: 'u1',
      timestamp: '2026-06-01T00:00:00Z',
      cwd: 'C:/work/proj',
      slug: 'fix-the-bug',
      version: '2.0.0',
      gitBranch: 'main',
      isSidechain: false,
      message: { role: 'user', content: 'hello agent' },
    },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-06-01T00:00:05Z',
      isSidechain: false,
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-6',
        stop_reason: stopReason,
        usage: { input_tokens: 10, output_tokens: 20 },
        content: [{ type: 'text', text: 'done thinking, here is the answer' }],
      },
    },
  ]
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-idx-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
  _resetIndexReadyForTests()
})

afterEach(() => {
  vi.useRealTimers()
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('upsertSession() / getSession() parity', () => {
  it('stores the verbatim parseSessionRecord summary (everything except the time fields)', () => {
    const filePath = makeSessionJsonl('sess-parity')
    expect(upsertSession(filePath)).toBe(true)

    const expected = parseSessionRecord(filePath).summary
    const stored = getSession('sess-parity')
    expect(stored).toBeTruthy()
    // isActive/needsInput are recomputed at read time; everything else must be
    // byte-identical to the parser output.
    const { isActive: _a, needsInput: _n, ...expectedRest } = expected
    const { isActive: _a2, needsInput: _n2, ...storedRest } = stored
    expect(storedRest).toEqual(expectedRest)
    // Key order is part of "byte-identical" for JSON.stringify consumers.
    expect(Object.keys(stored)).toEqual(Object.keys(expected))
  })

  it('updates the existing row on re-upsert instead of duplicating', () => {
    const filePath = makeSessionJsonl('sess-dup')
    upsertSession(filePath)
    upsertSession(filePath)
    expect(listSessions().filter((s) => s.sessionId === 'sess-dup')).toHaveLength(1)
  })

  it('removes a stale row when the file vanished before the upsert ran', () => {
    const filePath = makeSessionJsonl('sess-vanish')
    upsertSession(filePath)
    fs.rmSync(filePath)
    expect(upsertSession(filePath)).toBe(false)
    expect(getSession('sess-vanish')).toBe(null)
  })

  // Phantom-session guard: subagent transcripts (projects/<proj>/<sessionId>/
  // subagents/agent-*.jsonl) contain type user/assistant records, so the parser
  // alone cannot reject them. upsertSession must refuse them by path — they are
  // not top-level sessions, and indexing one puts a fake 'agent-...' row in
  // listSessions() that TriageView would render.
  it('refuses to index a nested subagent transcript even though it parses as a session', () => {
    const subagentsDir = path.join(projectsDir, 'C--proj', 'sess-parent', 'subagents')
    fs.mkdirSync(subagentsDir, { recursive: true })
    const filePath = path.join(subagentsDir, 'agent-a2303837c0b84f287.jsonl')
    const records = [
      {
        type: 'user',
        uuid: 'u1',
        timestamp: '2026-06-01T00:00:00Z',
        cwd: 'C:/work/proj',
        isSidechain: false,
        message: { role: 'user', content: 'subagent prompt' },
      },
      {
        type: 'assistant',
        uuid: 'a1',
        timestamp: '2026-06-01T00:00:05Z',
        isSidechain: false,
        message: {
          role: 'assistant',
          model: 'claude-sonnet-4-6',
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
          content: [{ type: 'text', text: 'subagent answer' }],
        },
      },
    ]
    fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
    // Sanity: the parser DOES accept this content — the guard must be by path.
    expect(parseSessionRecord(filePath)).toBeTruthy()

    expect(upsertSession(filePath)).toBe(false)
    expect(getSession('agent-a2303837c0b84f287')).toBe(null)
    expect(listSessions()).toEqual([])
  })

  it('returns false and indexes nothing for a metadata-only (non-conversation) file', () => {
    const dir = path.join(projectsDir, 'C--proj')
    fs.mkdirSync(dir, { recursive: true })
    const filePath = path.join(dir, 'meta-only.jsonl')
    fs.writeFileSync(filePath, JSON.stringify({ type: 'ai-title', title: 'x' }) + '\n')
    expect(upsertSession(filePath)).toBe(false)
    expect(getSession('meta-only')).toBe(null)
  })
})

describe('read-time recompute of isActive/needsInput (clock-mocked)', () => {
  it('never serves the stored time fields — they are functions of Date.now()', () => {
    const t0 = new Date('2026-06-10T12:00:00Z').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(t0)

    const filePath = makeSessionJsonl('sess-clock', { stopReason: 'end_turn' })
    fs.utimesSync(filePath, new Date(t0), new Date(t0)) // mtime = "now"
    upsertSession(filePath)

    // Freshly modified → active, not waiting.
    let s = getSession('sess-clock')
    expect(s.isActive).toBe(true)
    expect(s.needsInput).toBe(false)

    // 10 minutes later, NO new write: the stored JSON still says isActive=true,
    // but the read must say inactive + needs input (last turn was end_turn).
    vi.setSystemTime(t0 + 10 * 60 * 1000)
    s = getSession('sess-clock')
    expect(s.isActive).toBe(false)
    expect(s.needsInput).toBe(true)

    // Past the 4-hour abandoned window: calm, no longer "needs you".
    vi.setSystemTime(t0 + FOUR_HOURS + FIVE_MIN)
    s = getSession('sess-clock')
    expect(s.isActive).toBe(false)
    expect(s.needsInput).toBe(false)
  })

  it('does not flag needsInput when the last main-thread turn was not end_turn', () => {
    const t0 = new Date('2026-06-10T12:00:00Z').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(t0)
    const filePath = makeSessionJsonl('sess-toolturn', { stopReason: 'tool_use' })
    fs.utimesSync(filePath, new Date(t0), new Date(t0))
    upsertSession(filePath)

    vi.setSystemTime(t0 + 10 * 60 * 1000)
    const s = getSession('sess-toolturn')
    expect(s.isActive).toBe(false)
    expect(s.needsInput).toBe(false)
  })

  it('listSessions() recomputes the time fields too, and sorts by lastModified desc', () => {
    const t0 = new Date('2026-06-10T12:00:00Z').getTime()
    vi.useFakeTimers()
    vi.setSystemTime(t0)

    const older = makeSessionJsonl('sess-older')
    fs.utimesSync(older, new Date(t0 - FOUR_HOURS), new Date(t0 - FOUR_HOURS))
    const newer = makeSessionJsonl('sess-newer')
    fs.utimesSync(newer, new Date(t0), new Date(t0))
    upsertSession(older)
    upsertSession(newer)

    const list = listSessions()
    expect(list.map((s) => s.sessionId)).toEqual(['sess-newer', 'sess-older'])
    expect(list[0].isActive).toBe(true)
    expect(list[1].isActive).toBe(false)
    expect(list[1].needsInput).toBe(false) // outside the abandoned window
  })
})

describe('removeSession()', () => {
  it('deletes the row (the watcher unlink path)', () => {
    const filePath = makeSessionJsonl('sess-gone')
    upsertSession(filePath)
    expect(removeSession('sess-gone')).toBe(true)
    expect(getSession('sess-gone')).toBe(null)
    expect(listSessions()).toEqual([])
  })

  it('returns false for an unknown sessionId', () => {
    expect(removeSession('never-existed')).toBe(false)
  })
})

describe('rebuildAll()', () => {
  it('indexes every session file under the projects dir and flips isIndexReady', async () => {
    makeSessionJsonl('sess-r1', { project: 'C--alpha' })
    makeSessionJsonl('sess-r2', { project: 'C--beta' })
    expect(isIndexReady()).toBe(false)

    const result = await rebuildAll({ projectsDir })
    expect(result.scanned).toBe(2)
    expect(isIndexReady()).toBe(true)
    expect(
      listSessions()
        .map((s) => s.sessionId)
        .sort(),
    ).toEqual(['sess-r1', 'sess-r2'])
  })

  it('skips unchanged files via the (mtime,size) fingerprint and reparses diffs', async () => {
    const a = makeSessionJsonl('sess-skip')
    const b = makeSessionJsonl('sess-changed')
    await rebuildAll({ projectsDir })

    // Touch b with new content (size+mtime change); leave a untouched.
    fs.appendFileSync(
      b,
      JSON.stringify({
        type: 'user',
        isSidechain: false,
        message: { role: 'user', content: 'follow-up' },
      }) + '\n',
    )
    const second = await rebuildAll({ projectsDir })
    expect(second.updated).toBe(1)
    expect(getSession('sess-changed').messageCount).toBe(3)
    expect(getSession('sess-skip').messageCount).toBe(2)
    expect(fs.existsSync(a)).toBe(true)
  })

  it('reaps rows whose backing file no longer exists', async () => {
    const doomed = makeSessionJsonl('sess-doomed')
    makeSessionJsonl('sess-kept')
    await rebuildAll({ projectsDir })
    expect(listSessions()).toHaveLength(2)

    fs.rmSync(doomed)
    const result = await rebuildAll({ projectsDir })
    expect(result.removed).toBe(1)
    expect(getSession('sess-doomed')).toBe(null)
    expect(getSession('sess-kept')).toBeTruthy()
  })

  // Healing: a db written by older code may hold phantom subagent rows. Their
  // backing files still exist, so the file-gone reap never removes them —
  // rebuildAll must also reap rows whose path is a subagent transcript.
  it('reaps phantom subagent rows even though their backing file still exists', async () => {
    makeSessionJsonl('sess-legit')
    const subagentsDir = path.join(projectsDir, 'C--proj', 'sess-legit', 'subagents')
    fs.mkdirSync(subagentsDir, { recursive: true })
    const phantomPath = path.join(subagentsDir, 'agent-phantom.jsonl')
    fs.writeFileSync(phantomPath, JSON.stringify({ type: 'user', message: {} }) + '\n')
    // Plant the phantom row directly, simulating an index built by older code.
    getDb()
      .prepare(
        `INSERT INTO sessions (
           session_id, file_path, cwd, model, last_modified,
           last_main_end_turn, file_mtime, file_size, summary_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'agent-phantom',
        phantomPath,
        null,
        null,
        Date.now(),
        0,
        0,
        0,
        '{"sessionId":"agent-phantom"}',
      )
    expect(getSession('agent-phantom')).toBeTruthy()

    const result = await rebuildAll({ projectsDir })
    expect(result.removed).toBe(1)
    expect(getSession('agent-phantom')).toBe(null)
    expect(getSession('sess-legit')).toBeTruthy()
    expect(fs.existsSync(phantomPath)).toBe(true) // the reap never touches ~/.claude
  })

  it('tolerates a missing projects dir (fresh machine) without throwing', async () => {
    const result = await rebuildAll({ projectsDir: path.join(tmpDir, 'does-not-exist') })
    expect(result.scanned).toBe(0)
    expect(isIndexReady()).toBe(true)
  })
})

describe('degraded mode', () => {
  it('all operations are safe no-ops when the db is unavailable', () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db')) // forces dbUnavailable
    const filePath = makeSessionJsonl('sess-degraded')
    expect(upsertSession(filePath)).toBe(false)
    expect(removeSession('sess-degraded')).toBe(false)
    expect(listSessions()).toEqual([])
    expect(getSession('sess-degraded')).toBe(null)
  })
})
