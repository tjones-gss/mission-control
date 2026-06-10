// ADR-0008 Phase 6 — knowledge surfacing: project memory in the search index.
//
// Memory files (~/.claude/projects/<proj>/memory/*.md — the exact layout
// parsers/memory.js reads, MEMORY.md included) become doc_type='memory' rows
// in the messages table, mirrored into messages_fts by the existing triggers.
// Each file is one doc: session_id is the synthetic 'memory:<path>' key, cwd
// holds the file path (so the project filter and the palette title work), ts
// is the file mtime, and the body is chunked at the message-block size.
//
// The watcher reindexes a file before it emits memory_update (fresh-before-
// refetch, same as sessions); rebuildMemoryIndex() reconciles at boot. Every
// function is a safe no-op in degraded mode.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { getDb, withTransaction } from './connection.js'
import { MAX_BLOCK_CHARS } from './message-index.js'

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')

// Hard cap per file (chunks × 4KB = 64KB) — memory files are prose notes; an
// accidental giant in memory/ must not bloat the index.
export const MAX_MEMORY_CHUNKS = 16

export const MEMORY_DOC_PREFIX = 'memory:'

/** The synthetic session_id keying a memory doc's rows. */
export function memoryDocId(filePath) {
  return MEMORY_DOC_PREFIX + filePath
}

// A memory doc is a DIRECT .md child of a memory/ dir — mirroring what
// parsers/memory.js reads and what the watcher's depth check forwards.
function isMemoryMarkdown(filePath) {
  if (!filePath.toLowerCase().endsWith('.md')) return false
  const parts = filePath.split(/[\\/]/)
  return parts.length >= 2 && parts[parts.length - 2] === 'memory'
}

function chunkText(text) {
  const chunks = []
  for (let i = 0; i < text.length && chunks.length < MAX_MEMORY_CHUNKS; i += MAX_BLOCK_CHARS) {
    chunks.push(text.slice(i, i + MAX_BLOCK_CHARS))
  }
  return chunks
}

/**
 * Whole-file reindex of one memory markdown file (delete + reinsert, immune
 * to in-place edits). A vanished file drops its rows. Returns true when rows
 * were written.
 */
export function indexMemoryFile(filePath) {
  const db = getDb()
  if (!db) return false
  if (!isMemoryMarkdown(filePath)) return false

  let stat
  let content
  try {
    stat = fs.statSync(filePath)
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    removeMemoryFile(filePath)
    return false
  }

  // Filename first so title-like searches ("install topology") hit even when
  // the body never repeats the name.
  const text = `${path.basename(filePath)}\n${content}`.trim()
  const docId = memoryDocId(filePath)
  const ts = new Date(stat.mtimeMs).toISOString()
  try {
    withTransaction((tx) => {
      tx.prepare('DELETE FROM messages WHERE session_id = ?').run(docId)
      const insert = tx.prepare(
        `INSERT INTO messages (session_id, idx, role, ts, cwd, doc_type, text)
         VALUES (?, ?, NULL, ?, ?, 'memory', ?)`,
      )
      chunkText(text).forEach((chunk, i) => insert.run(docId, i, ts, filePath, chunk))
    })
    return true
  } catch {
    return false
  }
}

/** Drop a memory doc's rows (watcher unlink path). FTS shadow follows via triggers. */
export function removeMemoryFile(filePath) {
  const db = getDb()
  if (!db) return false
  try {
    return (
      db.prepare('DELETE FROM messages WHERE session_id = ?').run(memoryDocId(filePath)).changes > 0
    )
  } catch {
    return false
  }
}

/**
 * Boot-time reconciliation: index every projects/<proj>/memory/<file>.md and
 * reap rows whose backing file vanished while the server was down. Memory
 * files are few
 * and small, so a full reindex is cheap; still chunked with setImmediate so it
 * never starves the event loop behind live requests.
 */
export async function rebuildMemoryIndex({
  projectsDir = DEFAULT_PROJECTS_DIR,
  chunkSize = 10,
} = {}) {
  const db = getDb()
  if (!db) return { scanned: 0, updated: 0, removed: 0 }

  // Tolerant scan, mirroring rebuildAll(): a dir vanishing mid-scan is a
  // partial result, never a throw.
  const files = []
  try {
    const projectDirs = fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
    for (const projectDir of projectDirs) {
      const memoryDir = path.join(projectsDir, projectDir.name, 'memory')
      let names = []
      try {
        names = fs.readdirSync(memoryDir).filter((f) => f.toLowerCase().endsWith('.md'))
      } catch {
        continue
      }
      for (const name of names) files.push(path.join(memoryDir, name))
    }
  } catch {
    // projects dir missing (fresh machine) — empty scan, reap below still runs
  }

  let updated = 0
  for (let i = 0; i < files.length; i += chunkSize) {
    for (const filePath of files.slice(i, i + chunkSize)) {
      if (indexMemoryFile(filePath)) updated++
    }
    await new Promise((resolve) => setImmediate(resolve))
  }

  // Reap docs whose backing file is gone (unlinks the watcher never saw).
  let removed = 0
  try {
    const rows = db
      .prepare(`SELECT DISTINCT session_id, cwd FROM messages WHERE doc_type = 'memory'`)
      .all()
    for (const row of rows) {
      if (row.cwd && fs.existsSync(row.cwd)) continue
      try {
        db.prepare('DELETE FROM messages WHERE session_id = ?').run(row.session_id)
        removed++
      } catch {
        // best-effort reap; a stale doc falls out on the next rebuild
      }
    }
  } catch {
    // reap is best-effort
  }

  return { scanned: files.length, updated, removed }
}
