// ADR-0008 Phase 5 — lib/db/usage-index.js
//
// Real node:sqlite in a temp dir. Covers: day/model_family bucketing from
// record timestamps (mirroring the tokenUsage accumulation in
// parsers/sessions.js), whole-session reindex inside the upsertSession
// transaction, removeSession cleanup, and getUsageStats() aggregation priced
// with the MODEL_PRICING tables in utils/cost.js.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, getDb } from '../../../lib/db/connection.js'
import {
  extractUsageDaily,
  reindexSessionUsage,
  getUsageStats,
} from '../../../lib/db/usage-index.js'
import { upsertSession, removeSession } from '../../../lib/db/session-index.js'
import { MODEL_PRICING } from '../../../utils/cost.js'

let tmpDir
let projectsDir

function assistant({
  ts = '2026-06-01T10:00:00Z',
  model = 'claude-sonnet-4-6',
  input = 0,
  output = 0,
  cacheRead = 0,
  cacheWrite = 0,
} = {}) {
  return {
    type: 'assistant',
    timestamp: ts,
    isSidechain: false,
    message: {
      role: 'assistant',
      model,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: input,
        output_tokens: output,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheWrite,
      },
      content: [{ type: 'text', text: 'ok' }],
    },
  }
}

function user(text, extra = {}) {
  return {
    type: 'user',
    timestamp: '2026-06-01T09:59:00Z',
    cwd: 'C:/work/proj',
    isSidechain: false,
    message: { role: 'user', content: text },
    ...extra,
  }
}

function writeSessionJsonl(sessionId, records, { project = 'C--proj' } = {}) {
  const dir = path.join(projectsDir, project)
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, `${sessionId}.jsonl`)
  fs.writeFileSync(filePath, records.map((r) => JSON.stringify(r)).join('\n') + '\n')
  return filePath
}

function usageRows(sessionId) {
  return getDb()
    .prepare('SELECT * FROM usage_daily WHERE session_id = ? ORDER BY day, model_family')
    .all(sessionId)
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-usage-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractUsageDaily()', () => {
  it('buckets usage by UTC day and model family', () => {
    const buckets = extractUsageDaily([
      user('hello'),
      assistant({ ts: '2026-06-01T10:00:00Z', input: 100, output: 50 }),
      assistant({ ts: '2026-06-02T01:00:00Z', input: 7, output: 3, cacheRead: 11, cacheWrite: 5 }),
    ])
    expect(buckets).toEqual([
      {
        day: '2026-06-01',
        modelFamily: 'sonnet',
        input: 100,
        output: 50,
        cacheRead: 0,
        cacheWrite: 0,
      },
      {
        day: '2026-06-02',
        modelFamily: 'sonnet',
        input: 7,
        output: 3,
        cacheRead: 11,
        cacheWrite: 5,
      },
    ])
  })

  it('accumulates multiple records into the same day+family bucket', () => {
    const buckets = extractUsageDaily([
      assistant({ ts: '2026-06-01T08:00:00Z', input: 1, output: 2, cacheRead: 3, cacheWrite: 4 }),
      assistant({
        ts: '2026-06-01T22:00:00Z',
        input: 10,
        output: 20,
        cacheRead: 30,
        cacheWrite: 40,
      }),
    ])
    expect(buckets).toEqual([
      {
        day: '2026-06-01',
        modelFamily: 'sonnet',
        input: 11,
        output: 22,
        cacheRead: 33,
        cacheWrite: 44,
      },
    ])
  })

  it('separates model families on the same day', () => {
    const buckets = extractUsageDaily([
      assistant({ model: 'claude-opus-4-5', input: 5 }),
      assistant({ model: 'claude-haiku-4-5', input: 9 }),
    ])
    expect(buckets.map((b) => b.modelFamily).sort()).toEqual(['haiku', 'opus'])
  })

  it("buckets unknown models under the 'unknown' family", () => {
    const buckets = extractUsageDaily([assistant({ model: 'mystery-model-9', input: 1 })])
    expect(buckets).toHaveLength(1)
    expect(buckets[0].modelFamily).toBe('unknown')
  })

  it('skips records without usage or without a parseable timestamp', () => {
    const noTs = assistant({ input: 5 })
    delete noTs.timestamp
    const badTs = assistant({ ts: 'not-a-date', input: 7 })
    expect(extractUsageDaily([user('no usage here'), noTs, badTs])).toEqual([])
  })
})

describe('reindexSessionUsage() — whole-session reindex', () => {
  it('replaces all rows for the session on each call (no duplicates)', () => {
    const db = getDb()
    reindexSessionUsage(db, 's1', [assistant({ input: 1 })])
    reindexSessionUsage(db, 's1', [
      assistant({ input: 2 }),
      assistant({ ts: '2026-06-03T00:00:00Z', input: 3 }),
    ])
    const rows = usageRows('s1')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.input)).toEqual([2, 3])
  })

  it('does not touch other sessions', () => {
    const db = getDb()
    reindexSessionUsage(db, 's1', [assistant({ input: 1 })])
    reindexSessionUsage(db, 's2', [assistant({ input: 2 })])
    reindexSessionUsage(db, 's1', [])
    expect(usageRows('s1')).toHaveLength(0)
    expect(usageRows('s2')).toHaveLength(1)
  })
})

describe('upsertSession() populates usage_daily in the same transaction', () => {
  it('indexes usage when a session is upserted', () => {
    const filePath = writeSessionJsonl('sess-usage', [
      user('count my tokens'),
      assistant({ input: 100, output: 50, cacheRead: 25, cacheWrite: 10 }),
    ])
    expect(upsertSession(filePath)).toBe(true)
    const rows = usageRows('sess-usage')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      day: '2026-06-01',
      model_family: 'sonnet',
      input: 100,
      output: 50,
      cache_read: 25,
      cache_write: 10,
    })
  })

  it('reindexes (not appends) on re-upsert', () => {
    const filePath = writeSessionJsonl('sess-reidx', [user('hi'), assistant({ input: 1 })])
    upsertSession(filePath)
    upsertSession(filePath)
    expect(usageRows('sess-reidx')).toHaveLength(1)
  })

  it('removeSession() drops the usage rows with the session row', () => {
    const filePath = writeSessionJsonl('sess-drop', [user('hi'), assistant({ input: 1 })])
    upsertSession(filePath)
    expect(usageRows('sess-drop')).toHaveLength(1)
    removeSession('sess-drop')
    expect(usageRows('sess-drop')).toHaveLength(0)
  })
})

describe('getUsageStats()', () => {
  function seed() {
    upsertSession(
      writeSessionJsonl(
        'sess-a',
        [
          { ...user('alpha work'), cwd: 'C:/work/alpha' },
          assistant({ ts: '2026-06-01T10:00:00Z', input: 1_000_000, output: 0 }),
          assistant({ ts: '2026-06-02T10:00:00Z', input: 0, output: 1_000_000 }),
        ],
        { project: 'C--alpha' },
      ),
    )
    upsertSession(
      writeSessionJsonl(
        'sess-b',
        [
          { ...user('beta work'), cwd: 'C:/work/beta' },
          assistant({
            ts: '2026-06-01T12:00:00Z',
            model: 'claude-opus-4-5',
            input: 1_000_000,
            cacheRead: 1_000_000,
          }),
        ],
        { project: 'C--beta' },
      ),
    )
  }

  it('groups by day, ordered ascending, with cost priced per family', () => {
    seed()
    const stats = getUsageStats({ groupBy: 'day' })
    expect(stats.groupBy).toBe('day')
    expect(stats.rows.map((r) => r.key)).toEqual(['2026-06-01', '2026-06-02'])
    const day1 = stats.rows[0]
    // 1M sonnet input ($3) + 1M opus input ($15) + 1M opus cacheRead ($1.50)
    expect(day1.input).toBe(2_000_000)
    expect(day1.cacheRead).toBe(1_000_000)
    expect(day1.cost).toBeCloseTo(
      MODEL_PRICING.sonnet.input + MODEL_PRICING.opus.input + MODEL_PRICING.opus.cacheRead,
      6,
    )
    // day 2: 1M sonnet output ($15)
    expect(stats.rows[1].cost).toBeCloseTo(MODEL_PRICING.sonnet.output, 6)
  })

  it('groups by model family', () => {
    seed()
    const stats = getUsageStats({ groupBy: 'model' })
    const keys = stats.rows.map((r) => r.key)
    expect(keys).toContain('sonnet')
    expect(keys).toContain('opus')
    const opus = stats.rows.find((r) => r.key === 'opus')
    expect(opus.input).toBe(1_000_000)
    expect(opus.cacheRead).toBe(1_000_000)
  })

  it('groups by project via the session cwd', () => {
    seed()
    const stats = getUsageStats({ groupBy: 'project' })
    const keys = stats.rows.map((r) => r.key)
    expect(keys).toContain('C:/work/alpha')
    expect(keys).toContain('C:/work/beta')
    const alpha = stats.rows.find((r) => r.key === 'C:/work/alpha')
    expect(alpha.input).toBe(1_000_000)
    expect(alpha.output).toBe(1_000_000)
  })

  it('includes a cache-hit-rate per row and overall totals', () => {
    seed()
    const stats = getUsageStats({ groupBy: 'model' })
    const opus = stats.rows.find((r) => r.key === 'opus')
    // cacheRead / (cacheRead + input) = 1M / 2M = 50%
    expect(opus.cacheHitRate).toBeCloseTo(50, 6)
    // seed totals: sonnet 1M input + 1M output; opus 1M input + 1M cacheRead
    expect(stats.totals.input).toBe(2_000_000)
    expect(stats.totals.output).toBe(1_000_000)
    expect(stats.totals.cacheRead).toBe(1_000_000)
    expect(stats.totals.cost).toBeCloseTo(
      MODEL_PRICING.sonnet.input +
        MODEL_PRICING.sonnet.output +
        MODEL_PRICING.opus.input +
        MODEL_PRICING.opus.cacheRead,
      6,
    )
    // cacheRead / (cacheRead + input) = 1M / 3M
    expect(stats.totals.cacheHitRate).toBeCloseTo(100 / 3, 6)
  })

  it('prices unknown families at zero instead of throwing', () => {
    upsertSession(
      writeSessionJsonl('sess-unk', [
        user('mystery'),
        assistant({ model: 'mystery-model-9', input: 1_000_000 }),
      ]),
    )
    const stats = getUsageStats({ groupBy: 'model' })
    const unknown = stats.rows.find((r) => r.key === 'unknown')
    expect(unknown.input).toBe(1_000_000)
    expect(unknown.cost).toBe(0)
  })

  it('returns empty rows and zero totals when the db is unavailable', () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    const stats = getUsageStats({ groupBy: 'day' })
    expect(stats.rows).toEqual([])
    expect(stats.totals.cost).toBe(0)
  })
})
