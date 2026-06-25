// Phase I2 — cross-session pattern intelligence (derived read-cache).
//
// Deterministic, no-LLM extraction of recurring habits from a session's tool
// calls, aggregated across all sessions so the UI can surface "you always do X"
// and "this command shows up in N sessions". Mirrors the message/usage indexers:
// a whole-session reindex (DELETE WHERE session_id, then re-insert) runs inside
// the upsertSession transaction, so it is idempotent and the cache rebuilds from
// scratch whenever cockpit.db is deleted. No LLM is ever consulted (UNIVERSAL
// CONSTRAINT #4) — patterns are pure arithmetic over the transcript.

import { getDb } from './connection.js'

// A Bash command is a test run if its text matches a common test-runner shape.
const TEST_RE =
  /\b(vitest|jest|pytest|go test|cargo test|rspec|mocha)\b|(?:npm|yarn|pnpm)\s+(?:run\s+)?test|\btest:/i

// Editing tools whose presence (followed by a test run) implies a verify habit.
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])

// The leading verb of a shell command — the stable key for a "command habit".
// Strips a path prefix (./scripts/foo → foo) and env-var assignments (FOO=bar).
function commandVerb(command) {
  if (typeof command !== 'string') return null
  const tokens = command.trim().split(/\s+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++ // skip env assigns
  const head = tokens[i]
  if (!head) return null
  const base = head.split(/[\\/]/).pop() // strip path
  return base && /^[A-Za-z0-9_.-]+$/.test(base) ? base.toLowerCase() : null
}

// Walk the transcript's tool_use blocks in order and derive patterns. Returns
// a deduped array of { kind, trigger, response } (one per signature).
export function extractPatterns(records) {
  const tools = []
  for (const r of records || []) {
    if (r?.type === 'assistant' && Array.isArray(r.message?.content)) {
      for (const block of r.message.content) {
        if (block?.type === 'tool_use') tools.push(block)
      }
    }
  }

  const bySig = new Map()
  const add = (kind, trigger, response) => {
    const sig = `${kind}:${trigger}`
    if (!bySig.has(sig)) bySig.set(sig, { kind, trigger, response })
  }

  let sawEditBeforeTest = false
  let sawEdit = false
  for (const t of tools) {
    if (EDIT_TOOLS.has(t.name)) sawEdit = true
    if (t.name === 'Bash') {
      const command = t.input?.command
      const verb = commandVerb(command)
      if (verb) add('command', verb, `runs \`${verb}\``)
      if (sawEdit && TEST_RE.test(command || '')) sawEditBeforeTest = true
    }
  }

  if (sawEditBeforeTest) {
    add('workflow', 'edit→test', 'runs tests after editing code')
  }

  return [...bySig.values()]
}

// Whole-session reindex on the CALLER's db handle so it joins the surrounding
// upsertSession transaction. lastSeen is the session's ms mtime (the recency
// the aggregate query surfaces). Idempotent: prior rows for this session are
// removed first, so re-running a session never inflates the cross-session count.
export function reindexSessionPatterns(db, sessionId, records, lastSeen) {
  db.prepare('DELETE FROM session_patterns WHERE session_id = ?').run(sessionId)
  const insert = db.prepare(
    `INSERT OR REPLACE INTO session_patterns (session_id, sig, kind, trigger, response, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  const ts = typeof lastSeen === 'number' && Number.isFinite(lastSeen) ? lastSeen : 0
  for (const p of extractPatterns(records)) {
    insert.run(sessionId, `${p.kind}:${p.trigger}`, p.kind, p.trigger, p.response, ts)
  }
}

// Aggregate the per-session base into the spec's pattern shape at query time:
// { id, kind, trigger, response, count, last_seen, example_session_ids }.
// `query` filters (LIKE) over trigger/response/kind; `session` restricts to
// signatures that the given session contributed to. Empty/degraded → [].
export function searchPatterns(query = '', { session } = {}) {
  const db = getDb()
  if (!db) return []

  const where = []
  const params = []
  const q = (query || '').trim()
  if (q) {
    where.push('(trigger LIKE ? OR response LIKE ? OR kind LIKE ?)')
    const like = `%${q}%`
    params.push(like, like, like)
  }
  if (session) {
    where.push('sig IN (SELECT sig FROM session_patterns WHERE session_id = ?)')
    params.push(session)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  let rows
  try {
    rows = db
      .prepare(
        `SELECT sig,
                kind,
                trigger,
                response,
                COUNT(DISTINCT session_id) AS count,
                MAX(last_seen)             AS last_seen,
                group_concat(DISTINCT session_id) AS example_ids
         FROM session_patterns
         ${whereSql}
         GROUP BY sig, kind, trigger, response
         ORDER BY count DESC, last_seen DESC`,
      )
      .all(...params)
  } catch {
    return []
  }

  return rows.map((r) => ({
    id: r.sig,
    kind: r.kind,
    trigger: r.trigger,
    response: r.response,
    count: r.count,
    last_seen: r.last_seen,
    example_session_ids: r.example_ids ? r.example_ids.split(',') : [],
  }))
}
