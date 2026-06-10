// ADR-0008 Phase 2 — the message index behind GET /api/search.
//
// One row per conversation record in `messages`, mirrored into the
// external-content `messages_fts` (FTS5, porter) by triggers — writers only
// ever touch `messages`. Population happens INSIDE the same upsertSession
// transaction in session-index.js, as a whole-session reindex (delete +
// reinsert — bounded by the parse the upsert already did, and immune to
// mid-file edits/compactions that an append-only index would corrupt on).
//
// What gets indexed: user/assistant text, thinking, and tool-input summaries
// (the exact summarizeToolUse shapes the parser uses for lastAction).
// What never does: tool_results (huge, low-signal, often secret-bearing) and
// base64 payloads. Each block is truncated at ~4KB.
import path from 'node:path'
import { getDb } from './connection.js'
import { summarizeToolUse } from '../../parsers/sessions.js'

export const MAX_BLOCK_CHARS = 4096

const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100

// Everything the messages table can hold (Phase 6): conversation records,
// project memory docs (lib/db/memory-index.js), intelligence summaries
// (lib/db/intelligence-store.js). The search route validates against this.
export const SEARCH_DOC_TYPES = ['message', 'memory', 'summary']

// A data URI, or an unbroken 256+ char run of base64 alphabet — either way it
// is noise to a text index (and possibly an inlined image). Prose never has
// runs that long without spaces or punctuation outside the base64 alphabet.
function looksLikeBase64(text) {
  if (/^data:[^,;]+;base64,/.test(text)) return true
  return /[A-Za-z0-9+/=]{256,}/.test(text)
}

function clip(text) {
  return text.length > MAX_BLOCK_CHARS ? text.slice(0, MAX_BLOCK_CHARS) : text
}

function textParts(content) {
  const parts = []
  if (typeof content === 'string') {
    if (content.trim() && !looksLikeBase64(content)) parts.push(clip(content))
    return parts
  }
  if (!Array.isArray(content)) return parts
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && block.text) {
      if (!looksLikeBase64(block.text)) parts.push(clip(block.text))
    } else if (block.type === 'thinking' && block.thinking) {
      parts.push(clip(block.thinking))
    } else if (block.type === 'tool_use' && block.name) {
      parts.push(clip(`${block.name} ${summarizeToolUse(block.name, block.input || {})}`.trim()))
    }
    // tool_result / image / document blocks: skipped by design.
  }
  return parts
}

/**
 * Reduce parsed JSONL records to indexable docs:
 * [{ idx, role, ts, text }] — one per user/assistant record with any
 * searchable text. Pure; exported for direct testing.
 */
export function extractMessageDocs(records) {
  const docs = []
  records.forEach((record, idx) => {
    if (record.type !== 'user' && record.type !== 'assistant') return
    const parts = textParts(record.message?.content)
    if (!parts.length) return
    docs.push({
      idx,
      role: record.type,
      ts: record.timestamp ?? null,
      text: parts.join('\n'),
    })
  })
  return docs
}

/**
 * Whole-session reindex on the CALLER's db handle, so it joins the
 * surrounding upsertSession transaction (session row and message rows commit
 * or roll back together). The FTS shadow rows follow via triggers.
 */
export function reindexSessionMessages(db, sessionId, cwd, records) {
  // doc_type-scoped: knowledge docs (a 'summary' row shares this session_id)
  // are owned by their own writers and must survive a conversation reindex.
  db.prepare(`DELETE FROM messages WHERE session_id = ? AND doc_type = 'message'`).run(sessionId)
  const insert = db.prepare(
    `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
     VALUES (?, ?, ?, ?, ?, 'message', ?)`,
  )
  for (const doc of extractMessageDocs(records)) {
    insert.run(sessionId, doc.idx, doc.role, doc.ts, cwd, doc.text)
  }
}

// FTS5 MATCH has its own query language ((), AND, NOT, ", *…) that throws on
// malformed input. User text is NOT that language: quote every term so any
// string is a valid query, at the cost of advanced operators.
function toFtsQuery(q) {
  return q
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(' ')
}

// Knowledge docs (memory) have no sessions row — their recency comes from the
// row's own ts (the file mtime, ISO). julianday keeps sub-second precision.
const EFFECTIVE_MTIME_SQL = 'coalesce(s.last_modified, (julianday(m.ts) - 2440587.5) * 86400000.0)'

/**
 * Full-text search joined (LEFT, since memory docs have no session row) to
 * the session index.
 * Ordering: BM25 relevance first (smaller is better in FTS5), recency as the
 * tiebreaker. from/to filter on the effective last-modified (ms epoch):
 * the session's for conversation docs, the doc's own ts otherwise.
 * types narrows doc_type (subset of SEARCH_DOC_TYPES); omitted means all.
 * Returns [] in degraded mode — the route layer turns that state into a 503
 * before ever calling here; this is the belt to that suspender.
 */
export function searchMessages({ q, project, from, to, limit = DEFAULT_LIMIT, types } = {}) {
  const db = getDb()
  if (!db) return []
  const ftsQuery = toFtsQuery(String(q ?? ''))
  if (!ftsQuery) return []

  const where = ['messages_fts MATCH ?']
  const params = [ftsQuery]
  const requestedTypes = Array.isArray(types)
    ? types.filter((t) => SEARCH_DOC_TYPES.includes(t))
    : []
  if (requestedTypes.length > 0 && requestedTypes.length < SEARCH_DOC_TYPES.length) {
    where.push(`m.doc_type IN (${requestedTypes.map(() => '?').join(', ')})`)
    params.push(...requestedTypes)
  }
  if (project) {
    where.push(`instr(lower(coalesce(m.cwd, '')), lower(?)) > 0`)
    params.push(String(project))
  }
  if (Number.isFinite(from)) {
    where.push(`${EFFECTIVE_MTIME_SQL} >= ?`)
    params.push(from)
  }
  if (Number.isFinite(to)) {
    where.push(`${EFFECTIVE_MTIME_SQL} <= ?`)
    params.push(to)
  }
  const cappedLimit = Math.min(Math.max(Math.trunc(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT)

  let rows
  try {
    rows = db
      .prepare(
        `SELECT m.session_id  AS sessionId,
                m.idx         AS idx,
                m.role        AS role,
                m.ts          AS ts,
                m.cwd         AS cwd,
                m.doc_type    AS docType,
                snippet(messages_fts, 0, '<mark>', '</mark>', '…', 12) AS snippet,
                bm25(messages_fts) AS rank,
                ${EFFECTIVE_MTIME_SQL} AS lastModified,
                s.summary_json     AS summaryJson
         FROM messages_fts
         JOIN messages m ON m.id = messages_fts.rowid
         LEFT JOIN sessions s ON s.session_id = m.session_id
         WHERE ${where.join(' AND ')}
         ORDER BY rank, lastModified DESC
         LIMIT ?`,
      )
      .all(...params, cappedLimit)
  } catch {
    // Same degraded contract as the rest of lib/db: a broken handle yields an
    // empty result, never a thrown 500 — openDb() recovery heals the cache.
    return []
  }

  return rows.map((row) => {
    let slug = null
    let model = null
    if (row.docType === 'memory') {
      // Memory docs store their file path in cwd; the filename is the title.
      slug = row.cwd ? path.basename(row.cwd) : null
    }
    try {
      const summary = JSON.parse(row.summaryJson)
      slug = summary.slug ?? slug
      model = summary.model ?? null
    } catch {
      // a malformed (or absent — knowledge docs) summary only costs extras
    }
    return {
      sessionId: row.sessionId,
      idx: row.idx,
      role: row.role,
      ts: row.ts,
      cwd: row.cwd,
      docType: row.docType,
      snippet: row.snippet,
      rank: row.rank,
      lastModified: row.lastModified,
      slug,
      model,
    }
  })
}
