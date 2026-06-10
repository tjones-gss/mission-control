// ADR-0008 Phase 6 — durable intelligence results.
//
// The storage behind intelligence/cache.js: one row per session in the
// intelligence table (analyzed_at, the messageCount/subagentCount staleness
// snapshot, result_json) so analyses survive restarts, plus a doc_type=
// 'summary' row in the messages index so GET /api/search and the palette can
// find what the analyzer concluded. The summary row shares the real
// session_id — removeSession() reaps it with the session, and the message
// reindex is doc_type-scoped so it survives conversation updates.
//
// Degraded mode falls back to an in-memory Map: exactly the pre-Phase-6
// behavior (functional, just amnesiac across restarts) — never an outage.
import { getDb, withTransaction } from './connection.js'

const memFallback = new Map() // sessionId → entry (degraded mode only)

export function _resetMemFallbackForTests() {
  memFallback.clear()
}

function toCount(value) {
  return Number.isFinite(value) ? value : null
}

// The searchable text of an analysis result — the analyzer's shape (goal/
// progress/flags/subagents/recommendation), defensively flattened.
export function summaryText(result) {
  if (!result || typeof result !== 'object') return ''
  const parts = [
    result.goal,
    result.progress,
    ...(Array.isArray(result.flags) ? result.flags : []),
    result.subagents,
    result.recommendation,
  ]
  return parts
    .filter((p) => typeof p === 'string' && p.trim() && p.trim().toLowerCase() !== 'none')
    .join('\n')
}

const UPSERT_SQL = `
  INSERT INTO intelligence (session_id, analyzed_at, message_count, subagent_count, result_json)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(session_id) DO UPDATE SET
    analyzed_at    = excluded.analyzed_at,
    message_count  = excluded.message_count,
    subagent_count = excluded.subagent_count,
    result_json    = excluded.result_json
`

/**
 * Persist one analysis (and its searchable summary doc) for a session.
 * snapshot is the optional { messageCount, subagentCount } staleness
 * fingerprint at analysis time. Returns the stored entry
 * ({ result, timestamp, messageCount, subagentCount }).
 */
export function saveIntelligence(sessionId, result, snapshot = {}) {
  const timestamp = Date.now()
  const entry = {
    result,
    timestamp,
    messageCount: toCount(snapshot?.messageCount),
    subagentCount: toCount(snapshot?.subagentCount),
  }
  const db = getDb()
  if (!db) {
    memFallback.set(sessionId, entry)
    return entry
  }
  try {
    withTransaction((tx) => {
      tx.prepare(UPSERT_SQL).run(
        sessionId,
        timestamp,
        entry.messageCount,
        entry.subagentCount,
        JSON.stringify(result),
      )
      // One summary doc per session, replaced on every re-analysis. idx -1
      // keeps it clear of real record indexes.
      tx.prepare(`DELETE FROM messages WHERE session_id = ? AND doc_type = 'summary'`).run(
        sessionId,
      )
      const text = summaryText(result)
      if (text) {
        const sessionRow = tx
          .prepare('SELECT cwd FROM sessions WHERE session_id = ?')
          .get(sessionId)
        tx.prepare(
          `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
           VALUES (?, -1, NULL, ?, ?, 'summary', ?)`,
        ).run(sessionId, new Date(timestamp).toISOString(), sessionRow?.cwd ?? null, text)
      }
    })
    memFallback.delete(sessionId)
  } catch {
    memFallback.set(sessionId, entry)
  }
  return entry
}

/** The stored entry for a session, or null. Shape matches saveIntelligence(). */
export function getIntelligence(sessionId) {
  const db = getDb()
  if (!db) return memFallback.get(sessionId) ?? null
  let row
  try {
    row = db.prepare('SELECT * FROM intelligence WHERE session_id = ?').get(sessionId)
  } catch {
    return memFallback.get(sessionId) ?? null
  }
  if (!row) return memFallback.get(sessionId) ?? null
  let result
  try {
    result = JSON.parse(row.result_json)
  } catch {
    return null
  }
  return {
    result,
    timestamp: row.analyzed_at,
    messageCount: row.message_count,
    subagentCount: row.subagent_count,
  }
}
