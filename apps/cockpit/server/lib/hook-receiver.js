// Hook receiver — turns an inbound tool-call hook event into a `tool_call` SSE
// broadcast on the SAME channel the watcher uses. This is the cockpit side of
// V3 hook instrumentation: the opt-in hook bridge (packages/hook-server)
// delivers raw events here (via the ingest route), and MeshView renders them as
// real packets. Validation is strict and fail-closed — a malformed event is
// dropped, never broadcast — because this is the one inbound path and we only
// ever forward a normalized, whitelisted shape ({ type, sessionId, tool, ts }).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import chokidar from 'chokidar'
import { emit } from '../sse.js'
import { logger } from './logger.js'

// Default drop dir: server/data/hook-log/ — the SAME dir the L2-b pure-Node hook
// shim writes to. The opt-in hook bridge drops one JSON file per tool call here.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const HOOK_LOG_DIR = path.resolve(__dirname, '..', 'data', 'hook-log')

function cleanStr(v) {
  return typeof v === 'string' ? v.trim() : ''
}

// Validate a raw hook event and, if valid, broadcast a normalized tool_call SSE
// event. Returns { ok: true } on broadcast, { ok: false, error } otherwise.
export function receiveHookEvent(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'event must be an object' }
  }
  const sessionId = cleanStr(raw.sessionId)
  const tool = cleanStr(raw.tool)
  if (!sessionId) return { ok: false, error: 'sessionId is required' }
  if (!tool) return { ok: false, error: 'tool is required' }

  const ts = typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : Date.now()

  // Only ever forward the whitelisted shape — unknown fields are dropped.
  const event = { type: 'tool_call', sessionId, tool, ts }
  try {
    emit('tool_call', event)
  } catch (err) {
    logger.warn({ detail: err.message }, 'hook_emit_failed')
    return { ok: false, error: err.message }
  }
  return { ok: true, event }
}

// Consume one dropped hook-log file: read → receive (emit) → delete. Consume-once
// keeps the drop dir from growing unbounded. A poison (unparseable) file is also
// deleted so it can't wedge the dir; a non-.json path is left untouched (not
// ours). Returns the receive result, or { ok: false } for ignored/poison files.
export function consumeHookLogFile(filePath) {
  if (!filePath.endsWith('.json')) return { ok: false, error: 'not a hook-log file' }
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    return { ok: false, error: err.message }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Poison file — delete and move on, never broadcast.
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* ignore */
    }
    return { ok: false, error: 'unparseable hook-log file' }
  }
  const result = receiveHookEvent(parsed)
  try {
    fs.unlinkSync(filePath)
  } catch {
    /* ignore */
  }
  return result
}

// Opt-in: watch HOOK_LOG_DIR (or a given dir) and consume each dropped file. The
// hook bridge is opt-in, so the dir may not exist — we create it so chokidar has
// something to watch, then relay every new file as a tool_call. Returns the
// chokidar watcher so the boot path / tests can close it. If the watch can't be
// set up, hook instrumentation is simply absent — the non-hook path is never
// broken (V3 constraint).
export function startHookLogWatcher(dir = HOOK_LOG_DIR) {
  try {
    fs.mkdirSync(dir, { recursive: true })
  } catch {
    /* ignore — watcher.add below will just no-op */
  }
  let watcher
  try {
    watcher = chokidar.watch(dir, { ignoreInitial: true, depth: 0 })
  } catch (err) {
    logger.warn({ detail: err.message }, 'hook_log_watch_failed')
    return null
  }
  watcher.on('add', (filePath) => {
    try {
      consumeHookLogFile(filePath)
    } catch (err) {
      logger.warn({ detail: err.message }, 'hook_log_consume_failed')
    }
  })
  watcher.on('error', (err) => {
    logger.warn({ detail: err?.message || String(err) }, 'hook_log_watch_error')
  })
  return watcher
}
