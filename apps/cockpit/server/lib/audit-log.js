// Append-only audit log — the cockpit is the SOLE WRITER (Phase 4 / D-audit-otel,
// LOCKED decision). One newline-delimited JSON (JSONL) file recording the
// consequential actions the oversight dashboard orchestrates: agent spawns, human
// approval decisions, and branch merges — including the rails-mediated ones the
// cockpit DRIVES via the harness CLI shell-out (those carry source:'harness').
//
// Storage discipline matches ADR-0004 (localhost-first, one local-JSON store, no
// DB): each record is appended through the existing lib/atomic-write.js rename
// primitive so a concurrent writer can never interleave bytes mid-line. The log is
// APPEND-ONLY — prior lines are NEVER mutated or truncated; a monotonic `seq`
// (resumed from the on-disk tail at startup) makes that invariant observable.
//
// Records are validated against the shared packages/contracts audit-event schema
// before they are written (fail closed — an invalid event is rejected, not
// written), so the on-disk log can never drift from the versioned contract. We
// validate against the enums + required list READ FROM the schema (not a hand-
// copied list) so a schema edit can't silently bypass the check, while keeping ajv
// a test-only dependency — the schema is permissive (additionalProperties:true) so
// emitters attach event-specific detail under `payload` without a bump.
//
// KNOWN LIMITATION (documented in ADR-0004 + DOD-LADDER L3 #3): actions taken
// against the harness CLI DIRECTLY (outside the dashboard, e.g. a developer running
// `harness approve` in a terminal) are NOT captured here. There is no second,
// Python-side audit writer this phase — the cockpit only records the harness-
// mediated events it itself drives. Closing that gap is deferred.

import { promises as fs, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'node:url'
import { SCHEMA_VERSION, auditEventSchema } from '@mission-control/contracts'
import { logger } from './logger.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Default location mirrors the Fleet one-JSON-per-run store: under server/data,
// resolved relative to this module so it is correct regardless of cwd. A single
// append-only file (audit.jsonl) rather than one-file-per-event — an audit log is
// a time-ordered stream, not a keyed store.
const DEFAULT_AUDIT_LOG_PATH = join(__dirname, '..', 'data', 'audit', 'audit.jsonl')

// Mutable so tests can point at a tmp file; production uses the default. Setting it
// also resets the in-memory seq cache so a fresh path re-derives seq from its tail.
let auditLogPath = DEFAULT_AUDIT_LOG_PATH
let lastSeq = null // null = not yet resolved from disk

export function setAuditLogPath(p) {
  auditLogPath = p
  lastSeq = null
}

export function getAuditLogPath() {
  return auditLogPath
}

// Schema-derived validation surface (read once from the contract). Using the
// schema's own required list + enums means a future schema edit is automatically
// honoured here — this can't silently drift from the published contract.
const REQUIRED = Array.isArray(auditEventSchema.required) ? auditEventSchema.required : []
const EVENT_TYPES = auditEventSchema.properties?.eventType?.enum || []
const SOURCES = auditEventSchema.properties?.source?.enum || []

// Validate a fully-stamped record against the contract. Throws (fail closed) with
// context on the first violation — an invalid event is NEVER written.
function assertValid(rec) {
  for (const key of REQUIRED) {
    if (rec[key] === undefined || rec[key] === null) {
      throw new Error(`audit event missing required field "${key}"`)
    }
  }
  if (!EVENT_TYPES.includes(rec.eventType)) {
    throw new Error(
      `audit event has unknown eventType "${rec.eventType}" (expected one of ${EVENT_TYPES.join(', ')})`,
    )
  }
  if (!SOURCES.includes(rec.source)) {
    throw new Error(
      `audit event has unknown source "${rec.source}" (expected one of ${SOURCES.join(', ')})`,
    )
  }
}

// Resolve the next seq: the highest seq already on disk + 1 (so it resumes across
// restarts), cached in memory thereafter. A corrupt/seqless line contributes 0.
function resolveNextSeq() {
  if (lastSeq !== null) return lastSeq + 1
  let max = 0
  try {
    if (existsSync(auditLogPath)) {
      const raw = readFileSync(auditLogPath, 'utf8')
      for (const line of raw.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const obj = JSON.parse(trimmed)
          if (obj && typeof obj.seq === 'number' && obj.seq > max) max = obj.seq
        } catch {
          /* corrupt line — does not contribute a seq */
        }
      }
    }
  } catch (err) {
    logger.warn({ detail: err.message }, 'audit_seq_resolve_failed')
  }
  lastSeq = max
  return lastSeq + 1
}

// Append one line atomically WITHOUT mutating prior bytes. We read the current
// content, concatenate the new line, and rename a temp file over the destination
// (the same atomic-rename discipline as lib/atomic-write.js). Because the new
// content is the old content + one appended line, every prior byte is preserved
// verbatim — the append-only invariant holds even though we rewrite the whole file
// (correct + simple for a single-operator localhost store; ADR-0004). On Windows,
// rename can transiently fail with EPERM/EBUSY/EEXIST under contention, so we retry.
const RETRY_DELAYS_MS = [0, 8, 24, 60]
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'EEXIST'])

async function appendLine(line) {
  await fs.mkdir(dirname(auditLogPath), { recursive: true })
  let existing = ''
  try {
    existing = await fs.readFile(auditLogPath, 'utf8')
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    existing = ''
  }
  const next = existing + line + '\n'
  const tmp = auditLogPath + '.tmp.' + Math.random().toString(36).slice(2, 10)
  await fs.writeFile(tmp, next)
  let lastErr
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    try {
      await fs.rename(tmp, auditLogPath)
      return
    } catch (err) {
      lastErr = err
      if (!TRANSIENT_CODES.has(err.code)) break
    }
  }
  try {
    await fs.unlink(tmp)
  } catch {
    /* ignore orphaned temp on terminal failure */
  }
  throw lastErr
}

// Record one audit event. The caller supplies the semantic fields (eventType,
// source, and any of actor/subjectId/sessionId/projectKey/decision/outcome/
// correlationId/payload); this stamps schemaVersion (from the single-source
// sidecar), an ISO-8601 `ts`, and a monotonic `seq`, validates against the
// contract (fail closed), then appends one JSONL line. Returns the written record.
export async function recordAuditEvent(event = {}) {
  const rec = {
    schemaVersion: SCHEMA_VERSION,
    ts: new Date().toISOString(),
    seq: resolveNextSeq(),
    ...event,
  }
  // assertValid throws before any write, so an invalid event leaves the log
  // untouched (nothing partially written).
  assertValid(rec)
  await appendLine(JSON.stringify(rec))
  lastSeq = rec.seq
  return rec
}

// Best-effort fire-and-forget recorder for call sites on a hot path that must not
// be blocked by (or fail on) an audit write — the audit log is observability, not
// the system of record, so a failed append is logged and swallowed. Returns the
// promise so a caller that DOES want to await can.
export function recordAuditEventSafe(event = {}) {
  return recordAuditEvent(event).catch((err) => {
    logger.warn({ detail: err.message, eventType: event && event.eventType }, 'audit_write_failed')
    return null
  })
}

// Read the whole log back as parsed records (time-ordered). Skips corrupt lines
// rather than throwing — a single bad line must not blind the whole reader. Returns
// [] when the log does not exist yet.
export function readAuditLog() {
  let raw
  try {
    raw = readFileSync(auditLogPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return []
    logger.warn({ detail: err.message }, 'audit_read_failed')
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      /* corrupt line — skip, keep reading */
    }
  }
  return out
}
