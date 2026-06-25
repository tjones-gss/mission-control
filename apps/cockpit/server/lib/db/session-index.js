// ADR-0008 — the SQLite session index (replaces the 3s TTL cache in
// routes/sessions.js with event-driven invalidation from watcher.js).
//
// Rows store the VERBATIM parseSessionRecord summary as summary_json so API
// responses stay byte-identical, plus query columns (cwd, last_modified,
// model, (mtime,size) fingerprint, last_main_end_turn). The staleness trap:
// isActive/needsInput are functions of Date.now() — every read recomputes
// them via computeSessionTimeFields; the stored values are never served.
//
// Every function here is a safe no-op when the db is unavailable (degraded
// mode) — callers fall back to direct parser reads via routes/sessions.js.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDb, withTransaction } from './connection.js'
import { reindexSessionMessages } from './message-index.js'
import { reindexSessionUsage } from './usage-index.js'
import { reindexSessionPatterns } from './pattern-index.js'
import { parseSessionRecord, computeSessionTimeFields } from '../../parsers/sessions.js'

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

// Flipped by the first completed rebuildAll(). Until then the index may be
// cold (fresh db) or stale (server was down while sessions changed), so the
// sessions route keeps serving direct parser scans.
let indexReady = false

export function isIndexReady() {
  return indexReady
}

export function _resetIndexReadyForTests() {
  indexReady = false
}

const UPSERT_SQL = `
  INSERT INTO sessions (
    session_id, file_path, cwd, model, last_modified,
    last_main_end_turn, file_mtime, file_size, summary_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    file_path          = excluded.file_path,
    cwd                = excluded.cwd,
    model              = excluded.model,
    last_modified      = excluded.last_modified,
    last_main_end_turn = excluded.last_main_end_turn,
    file_mtime         = excluded.file_mtime,
    file_size          = excluded.file_size,
    summary_json       = excluded.summary_json
`

function sessionIdFromPath(filePath) {
  return path.basename(filePath, '.jsonl')
}

// Defense in depth behind the watcher's direct-child depth check: subagent
// transcripts (projects/<proj>/<sessionId>/subagents/agent-*.jsonl) contain
// type user/assistant records, so parseSessionRecord alone cannot reject
// them — indexing one puts a phantom 'agent-...' row in listSessions().
function isSubagentTranscript(filePath) {
  return filePath.split(/[\\/]/).includes('subagents')
}

/**
 * Parse one session JSONL and upsert its row. Called by the watcher on
 * add/change — the watcher knows exactly which file changed, so this is the
 * per-session invalidation the 3s TTL could never do. Returns true when a row
 * was written. A vanished or no-longer-parseable file drops any stale row.
 */
export function upsertSession(filePath) {
  const db = getDb()
  if (!db) return false
  if (isSubagentTranscript(filePath)) return false

  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    removeSession(sessionIdFromPath(filePath))
    return false
  }

  const parsed = parseSessionRecord(filePath)
  if (!parsed) {
    removeSession(sessionIdFromPath(filePath))
    return false
  }

  const { summary, lastMainEndTurn, records } = parsed
  try {
    // One transaction: the session row and its message-index rows (Phase 2)
    // commit or roll back together, so search can never see a session whose
    // messages belong to an older parse.
    withTransaction((tx) => {
      tx.prepare(UPSERT_SQL).run(
        summary.sessionId,
        filePath,
        summary.cwd ?? null,
        summary.model ?? null,
        summary.lastModified,
        lastMainEndTurn ? 1 : 0,
        stat.mtimeMs,
        stat.size,
        JSON.stringify(summary),
      )
      reindexSessionMessages(tx, summary.sessionId, summary.cwd ?? null, records ?? [])
      reindexSessionUsage(tx, summary.sessionId, records ?? [])
      reindexSessionPatterns(tx, summary.sessionId, records ?? [], summary.lastModified)
    })
    return true
  } catch {
    return false
  }
}

/** Delete a session row and its message-index rows (the watcher unlink path). */
export function removeSession(sessionId) {
  const db = getDb()
  if (!db) return false
  try {
    return withTransaction((tx) => {
      tx.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId)
      tx.prepare('DELETE FROM usage_daily WHERE session_id = ?').run(sessionId)
      tx.prepare('DELETE FROM session_patterns WHERE session_id = ?').run(sessionId)
      const result = tx.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId)
      return result.changes > 0
    })
  } catch {
    return false
  }
}

// Recompute the Date.now()-dependent fields at read time — never serve the
// values frozen into summary_json. Spreading then overriding keeps the
// original key order, so JSON.stringify output stays byte-identical.
function rowToSummary(row) {
  const summary = JSON.parse(row.summary_json)
  const { isActive, needsInput } = computeSessionTimeFields(
    row.last_modified,
    row.last_main_end_turn === 1,
  )
  return { ...summary, isActive, needsInput }
}

/** All sessions, newest first — the same order getAllSessions() produces. */
export function listSessions() {
  const db = getDb()
  if (!db) return []
  try {
    return db.prepare('SELECT * FROM sessions ORDER BY last_modified DESC').all().map(rowToSummary)
  } catch {
    return []
  }
}

/** One session summary by id, or null. */
export function getSession(sessionId) {
  const db = getDb()
  if (!db) return null
  try {
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId)
    return row ? rowToSummary(row) : null
  } catch {
    return null
  }
}

/**
 * Boot-time reconciliation: scan the projects tree, reparse only the files
 * whose (mtime,size) fingerprint changed, and reap rows whose file is gone.
 * Chunked with setImmediate so a cold rebuild of a large history never starves
 * the event loop. Flips isIndexReady() on completion.
 */
export async function rebuildAll({ projectsDir = DEFAULT_PROJECTS_DIR, chunkSize = 10 } = {}) {
  const db = getDb()
  if (!db) return { scanned: 0, updated: 0, removed: 0 }

  // Tolerant scan, mirroring getAllSessions(): a dir vanishing mid-scan is
  // a partial result, never a throw.
  const files = []
  try {
    const projectDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
    for (const projectDir of projectDirs) {
      const dirPath = path.join(projectsDir, projectDir.name)
      let names = []
      try {
        names = fs.readdirSync(dirPath).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      for (const name of names) files.push(path.join(dirPath, name))
    }
  } catch {
    // projects dir missing (fresh machine) — empty scan, reap below still runs
  }

  const fingerprints = new Map()
  try {
    for (const row of db.prepare('SELECT file_path, file_mtime, file_size FROM sessions').all()) {
      fingerprints.set(row.file_path, row)
    }
  } catch {
    // unreadable index — treat everything as a diff
  }

  let updated = 0
  for (let i = 0; i < files.length; i += chunkSize) {
    for (const filePath of files.slice(i, i + chunkSize)) {
      let stat
      try {
        stat = fs.statSync(filePath)
      } catch {
        continue
      }
      const prev = fingerprints.get(filePath)
      if (prev && prev.file_mtime === stat.mtimeMs && prev.file_size === stat.size) continue
      if (upsertSession(filePath)) updated++
    }
    // Yield between chunks — the boot rebuild runs behind live requests.
    await new Promise((resolve) => setImmediate(resolve))
  }

  // Reap rows whose backing file no longer exists (covers unlinks that
  // happened while the server was down — the watcher only sees live ones).
  // Also reap phantom subagent rows a pre-guard index may hold: their backing
  // file still exists, so only this path check can ever heal them.
  let removed = 0
  try {
    for (const row of db.prepare('SELECT session_id, file_path FROM sessions').all()) {
      if (isSubagentTranscript(row.file_path) || !fs.existsSync(row.file_path)) {
        if (removeSession(row.session_id)) removed++
      }
    }
  } catch {
    // reap is best-effort; stale rows fall out on the next rebuild
  }

  indexReady = true
  return { scanned: files.length, updated, removed }
}
