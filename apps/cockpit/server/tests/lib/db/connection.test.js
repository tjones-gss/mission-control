// ADR-0008 Phase 1 — lib/db/connection.js
//
// The ONE file allowed to import node:sqlite. These tests run against the real
// engine in a temp directory: bootstrap, WAL mode, transactions, the
// schema-version delete-and-rebuild, corruption recovery, and the degraded
// dbUnavailable mode. Deleting cockpit.db must ALWAYS be a safe user action.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  openDb,
  getDb,
  closeDb,
  isDbUnavailable,
  withTransaction,
  defaultDbPath,
  DB_SCHEMA_VERSION,
} from '../../../lib/db/connection.js'

let tmpDir
let dbPath

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-db-test-'))
  dbPath = path.join(tmpDir, 'cockpit.db')
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('openDb() bootstrap', () => {
  it('creates the db file, parent dir, and schema on first open', () => {
    const nested = path.join(tmpDir, 'data', 'cockpit.db')
    const db = openDb(nested)
    expect(db).toBeTruthy()
    expect(fs.existsSync(nested)).toBe(true)
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => r.name)
    expect(tables).toContain('meta')
    expect(tables).toContain('sessions')
  })

  it('enables WAL journal mode', () => {
    const db = openDb(dbPath)
    const { journal_mode } = db.prepare('PRAGMA journal_mode').get()
    expect(journal_mode).toBe('wal')
  })

  it('writes the schema_version meta row on first open', () => {
    const db = openDb(dbPath)
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get()
    expect(row.value).toBe(String(DB_SCHEMA_VERSION))
  })

  it('is idempotent — reopening the same path returns a working handle and keeps rows', () => {
    let db = openDb(dbPath)
    db.prepare(
      `INSERT INTO sessions (session_id, file_path, last_modified, last_main_end_turn, file_mtime, file_size, summary_json)
       VALUES ('s1', '/p/s1.jsonl', 1, 0, 1, 10, '{}')`,
    ).run()
    closeDb()
    db = openDb(dbPath)
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(1)
    expect(isDbUnavailable()).toBe(false)
  })

  it('getDb() lazily opens the default-or-last path and returns the singleton', () => {
    const db = openDb(dbPath)
    expect(getDb()).toBe(db)
  })

  it('defaultDbPath() points at server/data/cockpit.db', () => {
    const p = defaultDbPath()
    expect(p.endsWith(path.join('data', 'cockpit.db'))).toBe(true)
  })
})

describe('schema-version mismatch → delete-and-rebuild', () => {
  it('drops the old cache and rebuilds when the stored version differs', () => {
    let db = openDb(dbPath)
    db.prepare(
      `INSERT INTO sessions (session_id, file_path, last_modified, last_main_end_turn, file_mtime, file_size, summary_json)
       VALUES ('stale', '/p/stale.jsonl', 1, 0, 1, 10, '{}')`,
    ).run()
    db.prepare(`UPDATE meta SET value = '99999' WHERE key = 'schema_version'`).run()
    closeDb()

    db = openDb(dbPath)
    expect(db).toBeTruthy()
    expect(isDbUnavailable()).toBe(false)
    // The cache is derived — a version bump throws it away wholesale.
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(0)
    const row = db.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get()
    expect(row.value).toBe(String(DB_SCHEMA_VERSION))
  })
})

describe('corruption recovery', () => {
  it('deletes a corrupt file and recreates a fresh db', () => {
    fs.writeFileSync(dbPath, 'this is definitely not a sqlite file — corrupt header')
    const db = openDb(dbPath)
    expect(db).toBeTruthy()
    expect(isDbUnavailable()).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(0)
  })
})

describe('degraded mode — dbUnavailable', () => {
  it('sets dbUnavailable when the db cannot be created at all', () => {
    // A regular FILE where the parent directory should be → mkdir fails on both
    // attempts → degraded mode, callers fall back to direct parser reads.
    const blocker = path.join(tmpDir, 'blocker')
    fs.writeFileSync(blocker, 'i am a file, not a directory')
    const db = openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(db).toBe(null)
    expect(isDbUnavailable()).toBe(true)
    expect(getDb()).toBe(null)
  })

  it('closeDb() clears the unavailable flag so a restart can retry', () => {
    const blocker = path.join(tmpDir, 'blocker2')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(isDbUnavailable()).toBe(true)
    closeDb()
    expect(isDbUnavailable()).toBe(false)
    expect(openDb(dbPath)).toBeTruthy()
  })
})

describe('withTransaction()', () => {
  it('commits on success and returns the callback result', () => {
    openDb(dbPath)
    const result = withTransaction((db) => {
      db.prepare(
        `INSERT INTO sessions (session_id, file_path, last_modified, last_main_end_turn, file_mtime, file_size, summary_json)
         VALUES ('tx1', '/p/tx1.jsonl', 1, 0, 1, 10, '{}')`,
      ).run()
      return 'done'
    })
    expect(result).toBe('done')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(1)
  })

  it('rolls back when the callback throws', () => {
    openDb(dbPath)
    expect(() =>
      withTransaction((db) => {
        db.prepare(
          `INSERT INTO sessions (session_id, file_path, last_modified, last_main_end_turn, file_mtime, file_size, summary_json)
           VALUES ('tx2', '/p/tx2.jsonl', 1, 0, 1, 10, '{}')`,
        ).run()
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(getDb().prepare('SELECT COUNT(*) AS n FROM sessions').get().n).toBe(0)
  })

  it('throws when the db is unavailable', () => {
    const blocker = path.join(tmpDir, 'blocker3')
    fs.writeFileSync(blocker, 'file')
    openDb(path.join(blocker, 'nested', 'cockpit.db'))
    expect(() => withTransaction(() => {})).toThrow(/unavailable/i)
  })
})
