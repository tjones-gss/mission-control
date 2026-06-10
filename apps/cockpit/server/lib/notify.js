// AFK gate notifications — ENV-GATED, OFF BY DEFAULT (Phase 4, ADR plan).
// Mirrors the lib/otel.js pattern: with OVERSIGHT_WEBHOOK_URL unset, initNotify()
// is a total no-op (no subscription, no fetch, zero overhead) so the default
// localhost path pays nothing.
//
// NOTIFY-ONLY, by explicit user decision: this module POSTs an outbound webhook
// when an approval gate opens (PTY tool approvals + harness .harness/approvals/
// pending transitions) and has NO inbound path. Approving still flows through the
// cockpit's audited write routes — the sole-writer and no-auto-approve invariants
// are untouched. A failed POST is logged (logger.warn) and never affects the
// approval flow: fire-and-forget with a short timeout.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { onEvent } from '../sse.js'
import { config } from './config.js'
import { logger } from './logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Same store routes/sessions.js writes custom display names to. The notifier is a
// READER only — a missing/unreadable file simply means displayName: null.
const DEFAULT_NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json')
let namesFile = DEFAULT_NAMES_FILE

// Short timeout so a slow/dead webhook endpoint can never back-pressure the
// cockpit — the POST is best-effort by contract.
const POST_TIMEOUT_MS = 3000

// The active onEvent() unsubscriber (null = not subscribed / disabled).
let unsubscribe = null

// In-flight POST promises, tracked ONLY so tests can deterministically await
// delivery (__flushForTest). Each promise is internally caught — never rejects.
const inflight = new Set()

// OVERSIGHT_WEBHOOK_URL gate. Any non-blank value enables the notifier; unset or
// whitespace-only leaves it OFF (the default).
export function isNotifyEnabled() {
  const v = process.env.OVERSIGHT_WEBHOOK_URL
  return typeof v === 'string' && v.trim().length > 0
}

// Subscribe to the internal SSE pub/sub when enabled. No-op (returns null) when
// disabled. Idempotent: a second call while subscribed returns the existing
// unsubscriber instead of double-subscribing.
export function initNotify() {
  if (!isNotifyEnabled()) return null
  if (unsubscribe) return unsubscribe
  unsubscribe = onEvent(handleEvent)
  logger.info({ url: process.env.OVERSIGHT_WEBHOOK_URL }, 'notify_webhook_enabled')
  return unsubscribe
}

// Drop the subscription (test cleanup / graceful shutdown). Safe when nothing
// was initialised.
export function shutdownNotify() {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}

// Test seams. __setNamesFileForTest points displayName lookups at a temp file so
// tests never touch the real server/data/session-names.json (pass null to
// restore the default). __flushForTest awaits all in-flight POSTs.
export function __setNamesFileForTest(p) {
  namesFile = p || DEFAULT_NAMES_FILE
}

export async function __flushForTest() {
  await Promise.allSettled([...inflight])
}

// Internal pub/sub listener — sees every SSE emit, reacts only to the two
// approval-pending shapes. sse.js already guards listener throws, but this
// handler also never throws by construction (the async work is tracked + caught).
function handleEvent(event, data) {
  if (event === 'tool_approval_request') {
    // From pty-session.js: { sessionId, approvalId, toolName, input, riskLevel,
    // riskDescription, ts } — forward the compact subset.
    track(
      postNotification({
        sessionId: data?.sessionId ?? null,
        toolName: data?.toolName ?? null,
        riskLevel: data?.riskLevel ?? null,
        riskDescription: data?.riskDescription ?? null,
      }),
    )
  } else if (event === 'harness_approval_pending') {
    // From watcher.js: { projectPath, filePath, ts } — a file appeared/changed
    // under <project>/.harness/approvals/pending/. The harness gate has no
    // cockpit sessionId; identify it by project instead.
    const where = data?.projectPath ? ` in ${data.projectPath}` : ''
    track(
      postNotification({
        sessionId: null,
        toolName: 'harness_gate',
        riskLevel: null,
        riskDescription: `Harness approval pending${where}`,
      }),
    )
  }
}

function track(promise) {
  inflight.add(promise)
  promise.finally(() => inflight.delete(promise))
}

// Best-effort display-name lookup from the cockpit's session-names store.
async function lookupDisplayName(sessionId) {
  if (!sessionId) return null
  try {
    const names = JSON.parse(await readFile(namesFile, 'utf-8'))
    return names[sessionId] || null
  } catch {
    // Missing or unreadable names store is the normal case (no custom names
    // saved yet) — the payload simply carries displayName: null.
    return null
  }
}

// Fire-and-forget POST. Resolves (never rejects) so a webhook failure can never
// surface into the emit path or the approval flow.
async function postNotification({ sessionId, toolName, riskLevel, riskDescription }) {
  const url = process.env.OVERSIGHT_WEBHOOK_URL
  const payload = {
    sessionId,
    displayName: await lookupDisplayName(sessionId),
    riskLevel,
    riskDescription,
    toolName,
    // Deep link back to the local cockpit — the consumer (e.g. the user's
    // Telegram tooling) renders this as "open Mission Control".
    action_url: `http://localhost:${config.port}`,
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(POST_TIMEOUT_MS),
    })
    if (!res.ok) {
      logger.warn({ status: res.status, sessionId, toolName }, 'notify_webhook_non_2xx')
    }
  } catch (err) {
    logger.warn(
      { detail: err?.message || String(err), sessionId, toolName },
      'notify_webhook_failed',
    )
  }
}
