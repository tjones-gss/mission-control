// ADR-0008 Phase 2 — lib/db/message-index.js
//
// Real node:sqlite in a temp dir. Covers: the extraction rules (user/assistant
// text, thinking, tool-input summaries; tool_results and base64 skipped;
// ~4KB block truncation), the whole-session reindex inside the upsertSession
// transaction, FTS5 porter matching, snippet highlights, BM25-then-recency
// ordering, and the project/from/to filters.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, getDb } from '../../../lib/db/connection.js'
import {
  extractMessageDocs,
  reindexSessionMessages,
  searchMessages,
  MAX_BLOCK_CHARS,
} from '../../../lib/db/message-index.js'
import { upsertSession, removeSession } from '../../../lib/db/session-index.js'

let tmpDir
let projectsDir

function user(text, extra = {}) {
  return {
    type: 'user',
    timestamp: '2026-06-01T00:00:00Z',
    cwd: 'C:/work/proj',
    isSidechain: false,
    message: { role: 'user', content: text },
    ...extra,
  }
}

function assistant(content, extra = {}) {
  return {
    type: 'assistant',
    timestamp: '2026-06-01T00:00:05Z',
    isSidechain: false,
    message: {
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
      content,
    },
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

function messageRows(sessionId) {
  return getDb().prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY idx').all(sessionId)
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-msg-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('extractMessageDocs()', () => {
  it('indexes user string content and assistant text blocks', () => {
    const docs = extractMessageDocs([
      user('please fix the login bug'),
      assistant([{ type: 'text', text: 'fixed the login bug in auth.js' }]),
    ])
    expect(docs).toHaveLength(2)
    expect(docs[0]).toMatchObject({ idx: 0, role: 'user', text: 'please fix the login bug' })
    expect(docs[1]).toMatchObject({ idx: 1, role: 'assistant' })
    expect(docs[1].text).toContain('fixed the login bug')
  })

  it('indexes thinking blocks and tool-input summaries (the parser shapes)', () => {
    const docs = extractMessageDocs([
      assistant([
        { type: 'thinking', thinking: 'the deadlock is in the mutex ordering' },
        { type: 'tool_use', name: 'Bash', input: { command: 'git log --oneline' } },
        { type: 'tool_use', name: 'Read', input: { file_path: 'C:/proj/auth.js' } },
        { type: 'tool_use', name: 'Skill', input: { skill: 'pair-loop' } },
      ]),
    ])
    expect(docs).toHaveLength(1)
    expect(docs[0].text).toContain('the deadlock is in the mutex ordering')
    expect(docs[0].text).toContain('Bash git log --oneline')
    expect(docs[0].text).toContain('Read C:/proj/auth.js')
    expect(docs[0].text).toContain('Skill pair-loop')
  })

  it('skips tool_result blocks entirely', () => {
    const docs = extractMessageDocs([
      user([
        { type: 'tool_result', tool_use_id: 't1', content: 'SECRETRESULTTOKEN giant tool output' },
      ]),
    ])
    expect(docs).toHaveLength(0)
  })

  it('skips base64 payloads (data URIs and bare base64 runs) and image blocks', () => {
    const b64 = 'QmFzZTY0IQ=='.repeat(40) // long pure-base64 run
    const docs = extractMessageDocs([
      user(`data:image/png;base64,${b64}`),
      assistant([
        { type: 'image', source: { type: 'base64', data: b64 } },
        { type: 'text', text: b64 },
        { type: 'text', text: 'a real sentence to keep' },
      ]),
    ])
    expect(docs).toHaveLength(1)
    expect(docs[0].text).toBe('a real sentence to keep')
  })

  it('truncates each block at ~4KB', () => {
    const huge = 'word '.repeat(5000) // ~25KB
    const docs = extractMessageDocs([assistant([{ type: 'text', text: huge }])])
    expect(docs).toHaveLength(1)
    expect(docs[0].text.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS)
  })

  it('ignores non-conversation records and empty messages', () => {
    const docs = extractMessageDocs([
      { type: 'system', message: 'meta' },
      { type: 'ai-title', title: 'x' },
      user(''),
      assistant([]),
    ])
    expect(docs).toHaveLength(0)
  })
})

describe('reindexSessionMessages() — whole-session reindex', () => {
  it('replaces all rows for the session on each call (no duplicates)', () => {
    const db = getDb()
    reindexSessionMessages(db, 's1', '/work/p', [user('first version of the text')])
    reindexSessionMessages(db, 's1', '/work/p', [
      user('first version of the text'),
      assistant([{ type: 'text', text: 'second message arrives' }]),
    ])
    const rows = messageRows('s1')
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.idx)).toEqual([0, 1])
  })

  it('does not touch other sessions', () => {
    const db = getDb()
    reindexSessionMessages(db, 's1', '/a', [user('alpha content')])
    reindexSessionMessages(db, 's2', '/b', [user('beta content')])
    reindexSessionMessages(db, 's1', '/a', [])
    expect(messageRows('s1')).toHaveLength(0)
    expect(messageRows('s2')).toHaveLength(1)
  })

  it('stores cwd and doc_type=message on every row', () => {
    reindexSessionMessages(getDb(), 's3', 'C:/work/proj', [user('hello there')])
    const [row] = messageRows('s3')
    expect(row.cwd).toBe('C:/work/proj')
    expect(row.doc_type).toBe('message')
  })

  // Phase 6: summary docs share the session_id — the whole-session reindex
  // must only replace doc_type='message' rows, never knowledge docs.
  it('leaves non-message docs for the same session untouched', () => {
    const db = getDb()
    db.prepare(
      `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
       VALUES ('s4', -1, NULL, NULL, NULL, 'summary', 'an analysis summary survives')`,
    ).run()
    reindexSessionMessages(db, 's4', '/work/p', [user('a fresh message')])
    const rows = messageRows('s4')
    expect(rows.map((r) => r.doc_type).sort()).toEqual(['message', 'summary'])
  })
})

describe('upsertSession() populates the message index in the same transaction', () => {
  it('indexes messages when a session is upserted', () => {
    const filePath = writeSessionJsonl('sess-msg', [
      user('search for the flux capacitor'),
      assistant([{ type: 'text', text: 'found the flux capacitor in engine.js' }]),
    ])
    expect(upsertSession(filePath)).toBe(true)
    expect(messageRows('sess-msg')).toHaveLength(2)
  })

  it('reindexes (not appends) on re-upsert', () => {
    const filePath = writeSessionJsonl('sess-reidx', [user('one message only')])
    upsertSession(filePath)
    upsertSession(filePath)
    expect(messageRows('sess-reidx')).toHaveLength(1)
  })

  it('removeSession() drops the message rows with the session row', () => {
    const filePath = writeSessionJsonl('sess-drop', [user('soon to be gone')])
    upsertSession(filePath)
    expect(messageRows('sess-drop')).toHaveLength(1)
    removeSession('sess-drop')
    expect(messageRows('sess-drop')).toHaveLength(0)
    // FTS shadow rows must be gone too — a match would resurrect a ghost.
    expect(searchMessages({ q: 'gone' })).toEqual([])
  })
})

describe('searchMessages()', () => {
  function seed() {
    upsertSession(
      writeSessionJsonl(
        'sess-a',
        [
          user('the deploy pipeline is failing on windows'),
          assistant([{ type: 'text', text: 'fixed the deploy pipeline by pinning node' }]),
        ],
        { project: 'C--alpha' },
      ),
    )
    upsertSession(
      writeSessionJsonl('sess-b', [user('please refactor the theme tokens for the cockpit')], {
        project: 'C--beta',
      }),
    )
  }

  it('matches with porter stemming and returns snippet highlights', () => {
    seed()
    const hits = searchMessages({ q: 'deploying' }) // stems to "deploy"
    expect(hits.length).toBeGreaterThanOrEqual(2)
    expect(hits.every((h) => h.sessionId === 'sess-a')).toBe(true)
    expect(hits[0].snippet).toContain('<mark>')
    expect(hits[0].snippet).toMatch(/<mark>deploy/i)
  })

  it('returns session metadata for deep-linking (sessionId, cwd, lastModified)', () => {
    seed()
    const [hit] = searchMessages({ q: 'theme tokens' })
    expect(hit.sessionId).toBe('sess-b')
    expect(hit.cwd).toBeTruthy()
    expect(typeof hit.lastModified).toBe('number')
    expect(hit.role).toBe('user')
  })

  it('filters by project substring (case-insensitive)', () => {
    // cwd comes from the fixture records: both say C:/work/proj — give one a
    // distinct cwd through a record override.
    upsertSession(
      writeSessionJsonl('sess-proj', [
        { ...user('a needle in the alpha project'), cwd: 'C:/work/ALPHA' },
      ]),
    )
    upsertSession(
      writeSessionJsonl('sess-other', [
        { ...user('a needle in the beta project'), cwd: 'C:/work/beta' },
      ]),
    )
    const hits = searchMessages({ q: 'needle', project: 'alpha' })
    expect(hits.map((h) => h.sessionId)).toEqual(['sess-proj'])
  })

  it('filters by from/to against the session lastModified', () => {
    seed()
    const all = searchMessages({ q: 'pipeline' })
    expect(all.length).toBeGreaterThan(0)
    const lm = all[0].lastModified
    expect(searchMessages({ q: 'pipeline', from: lm + 1 })).toEqual([])
    expect(searchMessages({ q: 'pipeline', to: lm - 1 })).toEqual([])
    expect(searchMessages({ q: 'pipeline', from: lm - 1, to: lm + 1 }).length).toBe(all.length)
  })

  it('respects the limit', () => {
    seed()
    expect(searchMessages({ q: 'pipeline', limit: 1 })).toHaveLength(1)
  })

  it('orders by BM25 relevance, then recency', () => {
    // sess-rich mentions the term twice in one short doc → better BM25 than
    // sess-poor's single mention inside a longer doc.
    upsertSession(writeSessionJsonl('sess-rich', [user('quasar quasar')], { project: 'C--rich' }))
    upsertSession(
      writeSessionJsonl(
        'sess-poor',
        [user('the quasar appeared once among many many other unrelated words here')],
        { project: 'C--poor' },
      ),
    )
    const hits = searchMessages({ q: 'quasar' })
    expect(hits[0].sessionId).toBe('sess-rich')
  })

  it('is resilient to FTS syntax characters in the query', () => {
    seed()
    expect(() => searchMessages({ q: '"unbalanced AND (NOT' })).not.toThrow()
    expect(searchMessages({ q: 'pipeline"' }).length).toBeGreaterThan(0)
  })

  // Phase 6: doc_type filter. Knowledge docs (memory/summary) share the
  // messages table — types narrows the match; omitted means everything.
  describe('types filter', () => {
    function seedDocTypes() {
      seed()
      getDb()
        .prepare(
          `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
           VALUES ('sess-a', -1, NULL, '2026-06-01T00:00:10.000Z', 'C:/work/proj', 'summary',
                   'pipeline analysis summary doc')`,
        )
        .run()
      getDb()
        .prepare(
          `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
           VALUES ('memory:C:/mem/pipeline-notes.md', 0, NULL, '2026-06-01T00:00:20.000Z',
                   'C:/mem/pipeline-notes.md', 'memory', 'pipeline memory doc body')`,
        )
        .run()
    }

    it('returns all doc types when types is omitted', () => {
      seedDocTypes()
      const kinds = new Set(searchMessages({ q: 'pipeline' }).map((h) => h.docType))
      expect(kinds).toEqual(new Set(['message', 'summary', 'memory']))
    })

    it('narrows to the requested doc types', () => {
      seedDocTypes()
      expect(searchMessages({ q: 'pipeline', types: ['memory'] }).map((h) => h.docType)).toEqual([
        'memory',
      ])
      const two = searchMessages({ q: 'pipeline', types: ['summary', 'memory'] })
      expect(new Set(two.map((h) => h.docType))).toEqual(new Set(['summary', 'memory']))
    })

    it('memory docs without a session row still surface (LEFT JOIN, ts-derived recency)', () => {
      seedDocTypes()
      const [hit] = searchMessages({ q: 'pipeline', types: ['memory'] })
      expect(hit.sessionId).toBe('memory:C:/mem/pipeline-notes.md')
      expect(hit.slug).toBe('pipeline-notes.md')
      expect(typeof hit.lastModified).toBe('number')
      expect(hit.lastModified).toBeGreaterThan(Date.parse('2026-06-01T00:00:19Z'))
    })
  })

  it('returns [] for an empty query or when the db is unavailable', () => {
    seed()
    expect(searchMessages({ q: '   ' })).toEqual([])
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(searchMessages({ q: 'pipeline' })).toEqual([])
  })
})
