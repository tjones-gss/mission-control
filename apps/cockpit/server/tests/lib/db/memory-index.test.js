// ADR-0008 Phase 6 — lib/db/memory-index.js
//
// Real node:sqlite in a temp dir. Memory files (~/.claude/projects/<proj>/
// memory/*.md) become doc_type='memory' rows in the messages table — chunked,
// reindexed whole-file on change, reaped on unlink, rebuilt at boot — and
// surface through searchMessages() via the types filter.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb, getDb } from '../../../lib/db/connection.js'
import { MAX_BLOCK_CHARS, searchMessages } from '../../../lib/db/message-index.js'
import {
  indexMemoryFile,
  removeMemoryFile,
  rebuildMemoryIndex,
  memoryDocId,
} from '../../../lib/db/memory-index.js'

let tmpDir
let projectsDir

function writeMemoryFile(name, content, { project = 'C--proj' } = {}) {
  const dir = path.join(projectsDir, project, 'memory')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, name)
  fs.writeFileSync(filePath, content)
  return filePath
}

function memoryRows(filePath) {
  return getDb()
    .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY idx')
    .all(memoryDocId(filePath))
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-mem-test-'))
  projectsDir = path.join(tmpDir, 'projects')
  fs.mkdirSync(projectsDir, { recursive: true })
  openDb(path.join(tmpDir, 'cockpit.db'))
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('indexMemoryFile()', () => {
  it('indexes a memory markdown file as doc_type=memory rows', () => {
    const filePath = writeMemoryFile('install-topology.md', 'root npm install is not enough')
    expect(indexMemoryFile(filePath)).toBe(true)
    const rows = memoryRows(filePath)
    expect(rows).toHaveLength(1)
    expect(rows[0].doc_type).toBe('memory')
    expect(rows[0].text).toContain('root npm install is not enough')
    // The filename is part of the indexed text so title-like searches hit.
    expect(rows[0].text).toContain('install-topology.md')
    expect(rows[0].cwd).toBe(filePath)
    expect(rows[0].role).toBeNull()
    expect(typeof rows[0].ts).toBe('string')
  })

  it('chunks long files at ~4KB per row with increasing idx', () => {
    const long = 'memorable words here '.repeat(600) // ~12.6KB
    const filePath = writeMemoryFile('long.md', long)
    indexMemoryFile(filePath)
    const rows = memoryRows(filePath)
    expect(rows.length).toBeGreaterThanOrEqual(3)
    expect(rows.map((r) => r.idx)).toEqual(rows.map((_, i) => i))
    for (const row of rows) expect(row.text.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS)
  })

  it('reindexes (not appends) on re-index', () => {
    const filePath = writeMemoryFile('reidx.md', 'first version of the note')
    indexMemoryFile(filePath)
    fs.writeFileSync(filePath, 'second version of the note')
    indexMemoryFile(filePath)
    const rows = memoryRows(filePath)
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toContain('second version')
    expect(rows[0].text).not.toContain('first version')
  })

  it('refuses non-markdown and non-memory paths', () => {
    const notMd = writeMemoryFile('notes.txt', 'not markdown')
    expect(indexMemoryFile(notMd)).toBe(false)
    const dir = path.join(projectsDir, 'C--proj')
    fs.mkdirSync(dir, { recursive: true })
    const outside = path.join(dir, 'outside.md')
    fs.writeFileSync(outside, 'lives outside memory/')
    expect(indexMemoryFile(outside)).toBe(false)
    expect(memoryRows(notMd)).toHaveLength(0)
    expect(memoryRows(outside)).toHaveLength(0)
  })

  it('drops stale rows when the file has vanished', () => {
    const filePath = writeMemoryFile('gone.md', 'soon to vanish entirely')
    indexMemoryFile(filePath)
    fs.rmSync(filePath)
    expect(indexMemoryFile(filePath)).toBe(false)
    expect(memoryRows(filePath)).toHaveLength(0)
  })

  it('is a safe no-op in degraded mode', () => {
    const filePath = writeMemoryFile('degraded.md', 'unreachable database')
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(indexMemoryFile(filePath)).toBe(false)
    expect(removeMemoryFile(filePath)).toBe(false)
  })
})

describe('removeMemoryFile()', () => {
  it('removes the rows and their FTS shadow', () => {
    const filePath = writeMemoryFile('rm.md', 'the xylophone gotcha was here')
    indexMemoryFile(filePath)
    expect(searchMessages({ q: 'xylophone' })).toHaveLength(1)
    expect(removeMemoryFile(filePath)).toBe(true)
    expect(memoryRows(filePath)).toHaveLength(0)
    expect(searchMessages({ q: 'xylophone' })).toEqual([])
  })
})

describe('searchMessages() over memory docs', () => {
  it('finds memory docs with slug=filename, docType=memory and a numeric lastModified', () => {
    const filePath = writeMemoryFile('ci-green-gotchas.md', 'npm ci must run last in CI')
    indexMemoryFile(filePath)
    const hits = searchMessages({ q: 'npm ci', types: ['memory'] })
    expect(hits).toHaveLength(1)
    expect(hits[0].docType).toBe('memory')
    expect(hits[0].slug).toBe('ci-green-gotchas.md')
    expect(hits[0].snippet).toContain('<mark>')
    expect(typeof hits[0].lastModified).toBe('number')
    expect(Math.abs(hits[0].lastModified - Date.now())).toBeLessThan(60_000)
  })

  it('project filter matches against the memory file path', () => {
    indexMemoryFile(
      writeMemoryFile('a.md', 'shared keyword alpha', { project: 'C--alpha-project' }),
    )
    indexMemoryFile(writeMemoryFile('b.md', 'shared keyword beta', { project: 'C--beta-project' }))
    const hits = searchMessages({ q: 'keyword', project: 'alpha-project' })
    expect(hits).toHaveLength(1)
    expect(hits[0].slug).toBe('a.md')
  })
})

describe('rebuildMemoryIndex()', () => {
  it('scans projects/*/memory/*.md (including MEMORY.md) and indexes them all', async () => {
    writeMemoryFile('one.md', 'first memory body')
    writeMemoryFile('MEMORY.md', 'the memory index itself')
    writeMemoryFile('two.md', 'second memory body', { project: 'C--other' })
    const result = await rebuildMemoryIndex({ projectsDir })
    expect(result.scanned).toBe(3)
    expect(result.updated).toBe(3)
    expect(searchMessages({ q: 'memory', types: ['memory'] }).length).toBeGreaterThanOrEqual(3)
  })

  it('reaps rows whose backing file vanished while the server was down', async () => {
    const keep = writeMemoryFile('keep.md', 'persistent knowledge')
    const gone = writeMemoryFile('gone.md', 'transient knowledge')
    indexMemoryFile(keep)
    indexMemoryFile(gone)
    fs.rmSync(gone)
    const result = await rebuildMemoryIndex({ projectsDir })
    expect(result.removed).toBe(1)
    expect(memoryRows(gone)).toHaveLength(0)
    expect(memoryRows(keep)).toHaveLength(1)
  })

  it('returns zero counts in degraded mode', async () => {
    closeDb()
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(await rebuildMemoryIndex({ projectsDir })).toEqual({
      scanned: 0,
      updated: 0,
      removed: 0,
    })
  })
})
