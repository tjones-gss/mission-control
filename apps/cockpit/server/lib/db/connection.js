// ADR-0008 — SQLite derived read-cache: the connection seam.
//
// This is the ONLY file in the cockpit allowed to import node:sqlite (the
// engine emits an ExperimentalWarning on import — expected). Confining the
// import here keeps a future swap to better-sqlite3 a one-file change.
//
// The db at server/data/cockpit.db is a PURE derived cache rebuilt from
// ~/.claude — deleting it must ALWAYS be a safe user action. Accordingly:
//   - schema-version mismatch  → delete-and-rebuild (no migrations for a cache)
//   - corruption / open failure → delete-and-rebuild; if that also fails,
//     dbUnavailable=true and callers fall back to direct parser reads.
// Fleet runs are cockpit-authoritative STATE, not cache — they stay
// JSON-per-run in server/data/fleet/ and never live in this file.
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Bump on any schema change — the cache is thrown away and rebuilt, so no
// migration ceremony is ever needed. v2: messages + messages_fts (Phase 2).
// v3: usage_daily token rollups (Phase 5). v4: intelligence results (Phase 6).
export const DB_SCHEMA_VERSION = 4

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    session_id         TEXT PRIMARY KEY,
    file_path          TEXT NOT NULL,
    cwd                TEXT,
    model              TEXT,
    last_modified      REAL NOT NULL,
    last_main_end_turn INTEGER NOT NULL DEFAULT 0,
    file_mtime         REAL NOT NULL,
    file_size          INTEGER NOT NULL,
    summary_json       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_last_modified ON sessions(last_modified);

  -- Phase 2: per-record searchable text, populated inside the same
  -- upsertSession transaction by lib/db/message-index.js. doc_type leaves room
  -- for Phase 6 ('memory'/'summary' docs) without another schema bump.
  CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    idx        INTEGER NOT NULL,
    role       TEXT,
    ts         TEXT,
    cwd        TEXT,
    doc_type   TEXT NOT NULL DEFAULT 'message',
    text       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);

  -- External-content FTS5 over messages.text. The standard trigger trio keeps
  -- the shadow index in lockstep, so writers only ever touch messages.
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
    text,
    content='messages',
    content_rowid='id',
    tokenize='porter unicode61'
  );
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
    INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text);
  END;

  -- Phase 5: per-session daily token rollups, populated inside the same
  -- upsertSession transaction by lib/db/usage-index.js. day is the UTC
  -- YYYY-MM-DD of the record timestamp; model_family is haiku/sonnet/opus
  -- (or 'unknown'). Pricing happens at read time from utils/cost.js, so a
  -- price change never requires a reindex.
  CREATE TABLE IF NOT EXISTS usage_daily (
    session_id   TEXT NOT NULL,
    day          TEXT NOT NULL,
    model_family TEXT NOT NULL,
    input        INTEGER NOT NULL DEFAULT 0,
    output       INTEGER NOT NULL DEFAULT 0,
    cache_read   INTEGER NOT NULL DEFAULT 0,
    cache_write  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (session_id, day, model_family)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_daily_day ON usage_daily(day);

  -- Phase 6: durable intelligence analyses (lib/db/intelligence-store.js,
  -- fronted by intelligence/cache.js). analyzed_at is a ms epoch;
  -- message_count/subagent_count are the staleness snapshot at analysis time
  -- (nullable — callers that predate the snapshot pass nothing).
  CREATE TABLE IF NOT EXISTS intelligence (
    session_id     TEXT PRIMARY KEY,
    analyzed_at    REAL NOT NULL,
    message_count  INTEGER,
    subagent_count INTEGER,
    result_json    TEXT NOT NULL
  );
`

let db = null
let dbUnavailable = false
let activePath = null

export function defaultDbPath() {
  return path.join(__dirname, '..', '..', 'data', 'cockpit.db')
}

function deleteDbFiles(dbPath) {
  // WAL mode leaves -wal/-shm siblings; a stale pair next to a fresh db is
  // itself a corruption vector, so all three go together.
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.rmSync(dbPath + suffix, { force: true })
    } catch {
      // best effort — the retry open below surfaces any real failure
    }
  }
}

function openAndBootstrap(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true })
  const handle = new DatabaseSync(dbPath)
  try {
    handle.exec('PRAGMA journal_mode = WAL')
    handle.exec(SCHEMA_SQL)
    const row = handle.prepare(`SELECT value FROM meta WHERE key = 'schema_version'`).get()
    if (row && Number(row.value) !== DB_SCHEMA_VERSION) {
      // A cache from another schema generation: not corrupt, just obsolete.
      // Throwing routes it through the same delete-and-rebuild path.
      throw new Error(`schema_version mismatch: db=${row.value} code=${DB_SCHEMA_VERSION}`)
    }
    if (!row) {
      handle
        .prepare(`INSERT INTO meta (key, value) VALUES ('schema_version', ?)`)
        .run(String(DB_SCHEMA_VERSION))
    }
    return handle
  } catch (err) {
    try {
      handle.close()
    } catch {
      // already unusable — deletion below is the recovery
    }
    throw err
  }
}

/**
 * Open (or reuse) the cache db at dbPath. Failure path: delete the db files
 * and retry once; if the retry also fails, enter degraded mode (getDb() → null,
 * isDbUnavailable() → true) so callers fall back to direct parser reads.
 */
export function openDb(dbPath = defaultDbPath()) {
  if (db && activePath === dbPath) return db
  closeDb()
  try {
    db = openAndBootstrap(dbPath)
  } catch {
    deleteDbFiles(dbPath)
    try {
      db = openAndBootstrap(dbPath)
    } catch {
      db = null
      dbUnavailable = true
      activePath = dbPath
      return null
    }
  }
  dbUnavailable = false
  activePath = dbPath
  return db
}

/** Lazy singleton accessor. Returns null in degraded mode. */
export function getDb() {
  if (db) return db
  if (dbUnavailable) return null
  return openDb(activePath ?? defaultDbPath())
}

export function isDbUnavailable() {
  return dbUnavailable
}

/**
 * node:sqlite has no transaction sugar — explicit BEGIN/COMMIT/ROLLBACK.
 * Synchronous on purpose: DatabaseSync is synchronous, so an await inside the
 * callback could never interleave another writer anyway.
 */
export function withTransaction(fn) {
  const handle = getDb()
  if (!handle) throw new Error('db unavailable')
  handle.exec('BEGIN')
  try {
    const result = fn(handle)
    handle.exec('COMMIT')
    return result
  } catch (err) {
    try {
      handle.exec('ROLLBACK')
    } catch {
      // connection is broken — the next openDb() recovers via delete-and-rebuild
    }
    throw err
  }
}

/** Close and reset all module state (also clears degraded mode — a "restart"). */
export function closeDb() {
  if (db) {
    try {
      db.close()
    } catch {
      // closing a broken handle — nothing more to do
    }
  }
  db = null
  dbUnavailable = false
  activePath = null
}
