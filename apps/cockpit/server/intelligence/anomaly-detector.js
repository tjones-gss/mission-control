// Session anomaly detection (Phase I1). The intelligence layer already analyzes
// sessions for qualitative concerns; this module is the deterministic, no-LLM
// counterpart: it watches every live session for four mechanical failure modes
// and surfaces each as a non-blocking `anomaly` SSE event + an append-only log
// line. No claude session is ever spawned here — this is a pure-arithmetic guard
// rail (UNIVERSAL CONSTRAINT #4: no LLM in the alert/trust path).
//
// Detection (detectAnomalies) is a PURE function over a normalized snapshot so it
// is exhaustively unit-testable; the wiring (scanSession / startAnomalySweep)
// assembles that snapshot from the session parser + the runtime approval map and
// handles SSE emit, the JSONL log, and edge-triggered dedup.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { emit, onEvent } from '../sse.js'
import { logger } from '../lib/logger.js'
import { parseSessionRecord, getAllSessions } from '../parsers/sessions.js'
import { isMetaSession } from './meta-session-detector.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Thresholds — exported so tests assert against the same constants the detector
// uses (no magic-number drift between spec, code, and test).
export const STALL_MS = 5 * 60_000 // running, no new messages for > 5 min
export const APPROVAL_TIMEOUT_MS = 2 * 60_000 // approval pending > 2 min
export const LOOP_WINDOW = 10 // look back at the last 10 tool calls
export const LOOP_THRESHOLD = 8 // same tool > 8 times in that window
export const BUDGET_MULTIPLIER = 10 // cost > 10× rolling average
export const ROLLING_WINDOW = 10 // sessions averaged for the budget baseline

// Phase S1 — tighter thresholds for `meta` sessions (Oversight building itself):
// we want to catch a wandering build agent sooner than a normal session.
export const META_STALL_MS = 3 * 60_000 // stall after 3 min, not 5
export const META_LOOP_THRESHOLD = 5 // loop after 5 identical calls, not 8

const DEFAULT_ANOMALY_LOG_PATH = path.resolve(__dirname, '..', 'data', 'anomalies.jsonl')
let anomalyLogPath = DEFAULT_ANOMALY_LOG_PATH

export function setAnomalyLogPath(p) {
  anomalyLogPath = p
}
export function getAnomalyLogPath() {
  return anomalyLogPath
}

// ── Pure detection ─────────────────────────────────────────────────────────
//
// snapshot: {
//   sessionId, lastModified, lastMainEndTurn, estimatedCost,
//   recentTools: string[],            // last ≤LOOP_WINDOW tool names, in order
//   humanMessageInWindow: bool,       // a genuine user turn within that window
//   pendingApprovalSince: number|null,// earliest unresolved approval ts
//   rollingAvgCost: number|null,      // mean cost of recent OTHER sessions
// }
// Returns an array of { sessionId, kind, detail, ts } (possibly empty).
export function detectAnomalies(snapshot, { now = Date.now(), budgetMax = 0, meta = false } = {}) {
  const out = []
  const push = (kind, detail) => out.push({ sessionId: snapshot.sessionId, kind, detail, ts: now })
  // Meta sessions (Oversight watching its own build) get tighter thresholds.
  const stallMs = meta ? META_STALL_MS : STALL_MS
  const loopThreshold = meta ? META_LOOP_THRESHOLD : LOOP_THRESHOLD

  // 1. Stall — the agent was mid-task (its last main-thread record was NOT an
  //    end_turn, i.e. it was waiting on a tool result or hung) and has produced
  //    nothing for longer than the stall threshold. A session that ended its
  //    turn (lastMainEndTurn) is waiting for the human, which is not a stall.
  if (!snapshot.lastMainEndTurn && now - snapshot.lastModified > stallMs) {
    const mins = Math.round((now - snapshot.lastModified) / 60_000)
    push('stall', `No activity for ${mins}m while mid-task — the agent may be hung.`)
  }

  // 2. Budget overrun — explicit cap takes precedence; otherwise compare against
  //    a multiple of the user's recent rolling average. Never both.
  if (budgetMax > 0 && snapshot.estimatedCost > budgetMax) {
    push(
      'budget',
      `Session cost $${snapshot.estimatedCost.toFixed(2)} exceeds the $${budgetMax.toFixed(2)} budget.`,
    )
  } else if (
    !(budgetMax > 0) &&
    snapshot.rollingAvgCost > 0 &&
    snapshot.estimatedCost > BUDGET_MULTIPLIER * snapshot.rollingAvgCost
  ) {
    push(
      'budget',
      `Session cost $${snapshot.estimatedCost.toFixed(2)} is over ${BUDGET_MULTIPLIER}× your recent average of $${snapshot.rollingAvgCost.toFixed(2)}.`,
    )
  }

  // 3. Infinite tool loop — one tool dominates the recent window with no human
  //    turn to break it.
  if (!snapshot.humanMessageInWindow && snapshot.recentTools?.length) {
    const counts = {}
    for (const t of snapshot.recentTools) counts[t] = (counts[t] || 0) + 1
    for (const [tool, count] of Object.entries(counts)) {
      if (count > loopThreshold) {
        push(
          'loop',
          `${tool} called ${count}× in the last ${snapshot.recentTools.length} tool calls with no human input.`,
        )
        break
      }
    }
  }

  // 4. Approval timeout — a human approval has been pending too long.
  if (
    snapshot.pendingApprovalSince != null &&
    now - snapshot.pendingApprovalSince > APPROVAL_TIMEOUT_MS
  ) {
    const mins = Math.round((now - snapshot.pendingApprovalSince) / 60_000)
    push('approval', `An approval has been waiting ${mins}m for your decision.`)
  }

  return out
}

// ── Snapshot extraction ──────────────────────────────────────────────────────
//
// Build the file-derivable portion of a snapshot from parseSessionRecord output.
// pendingApprovalSince / rollingAvgCost are runtime signals merged in by the
// caller (scanSession), not derivable from the transcript alone.
export function buildSnapshot(parsed) {
  const summary = parsed?.summary || {}
  const records = Array.isArray(parsed?.records) ? parsed.records : []

  // Tool calls, in order, across all assistant messages.
  const toolCalls = []
  // Index of the most recent genuine human turn (string content or a text
  // block) — a tool_result-only user record is the harness echoing tool output,
  // not the human intervening.
  let lastHumanIdx = -1
  records.forEach((r, i) => {
    if (r?.type === 'assistant' && Array.isArray(r.message?.content)) {
      for (const block of r.message.content) {
        if (block?.type === 'tool_use') toolCalls.push({ name: block.name, idx: i })
      }
    } else if (r?.type === 'user') {
      const content = r.message?.content
      const isHuman =
        typeof content === 'string'
          ? content.trim().length > 0
          : Array.isArray(content)
            ? content.some((b) => b?.type === 'text')
            : false
      if (isHuman) lastHumanIdx = i
    }
  })

  const window = toolCalls.slice(-LOOP_WINDOW)
  const recentTools = window.map((t) => t.name)
  const humanMessageInWindow = window.length > 0 && lastHumanIdx >= window[0].idx

  return {
    sessionId: summary.sessionId,
    cwd: summary.cwd || null,
    lastModified: summary.lastModified || 0,
    lastMainEndTurn: Boolean(parsed?.lastMainEndTurn),
    estimatedCost: summary.estimatedCost || 0,
    recentTools,
    humanMessageInWindow,
    pendingApprovalSince: null,
    rollingAvgCost: null,
  }
}

// ── Runtime approval tracking ────────────────────────────────────────────────
//
// Approval state lives in the PTY/streaming layer, not the transcript. We mirror
// it from the existing tool_approval_request / tool_approval_resolved SSE events
// so the sweep can detect a stuck approval.
const pendingApprovals = new Map() // approvalId → { sessionId, ts }

export function trackApproval(sessionId, approvalId, ts = Date.now()) {
  if (!sessionId || !approvalId) return
  pendingApprovals.set(approvalId, { sessionId, ts })
}

export function resolveApproval(approvalId) {
  pendingApprovals.delete(approvalId)
}

export function getPendingApprovalSince(sessionId) {
  let earliest = null
  for (const { sessionId: sid, ts } of pendingApprovals.values()) {
    if (sid === sessionId && (earliest === null || ts < earliest)) earliest = ts
  }
  return earliest
}

// Mirror the PTY layer's approval lifecycle into our pending map by subscribing
// to the same internal SSE pub/sub the watcher uses. Returns an unsubscribe fn.
export function startApprovalTracking() {
  return onEvent((event, data) => {
    if (event === 'tool_approval_request') {
      trackApproval(data?.sessionId, data?.approvalId, data?.ts || Date.now())
    } else if (event === 'tool_approval_resolved') {
      resolveApproval(data?.approvalId)
    }
  })
}

// ── Edge-triggered dedup ─────────────────────────────────────────────────────
//
// Track the set of currently-active anomaly kinds per session. We emit only when
// a kind first appears, and forget it once it clears, so a 6-minute stall fires
// one toast (not one per scan) yet can re-fire if the session stalls again later.
const activeAnomalies = new Map() // sessionId → Set<kind>

export function __resetAnomalyState() {
  pendingApprovals.clear()
  activeAnomalies.clear()
}

function appendAnomalyLog(record) {
  try {
    fs.mkdirSync(path.dirname(anomalyLogPath), { recursive: true })
    fs.appendFileSync(anomalyLogPath, JSON.stringify(record) + '\n')
  } catch (err) {
    logger.warn({ detail: err.message }, 'anomaly_log_append_failed')
  }
}

export function readAnomalyLog() {
  let raw
  try {
    raw = fs.readFileSync(anomalyLogPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return []
    logger.warn({ detail: err.message }, 'anomaly_log_read_failed')
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      /* corrupt line — skip */
    }
  }
  return out
}

// Mean estimatedCost of the most recent OTHER sessions — the baseline the budget
// anomaly compares against when no explicit cap is set.
function computeRollingAvgCost(sessionId) {
  let sessions
  try {
    sessions = getAllSessions() || []
  } catch {
    return null
  }
  const others = sessions
    .filter((s) => s.sessionId !== sessionId && typeof s.estimatedCost === 'number')
    .slice(0, ROLLING_WINDOW)
  if (others.length === 0) return null
  return others.reduce((sum, s) => sum + s.estimatedCost, 0) / others.length
}

// Resolve the detailed parse for a session. parseSessionRecord wants a file
// path; the watcher change handler and the sweep both already hold one, so they
// pass it directly. With no path we look the session up in the parser's listing
// (each summary carries filePath); failing that we hand the id straight to the
// parser as a last resort. Returns null for anything unparseable.
function resolveParsed(sessionId, filePath) {
  try {
    if (filePath) return parseSessionRecord(filePath)
    const found = (getAllSessions() || []).find((s) => s.sessionId === sessionId)
    return parseSessionRecord(found?.filePath || sessionId)
  } catch {
    return null
  }
}

// Scan a single session: parse → snapshot → detect → emit + log the newly-active
// anomalies (edge-triggered). Safe no-op for a missing/unparseable session.
export async function scanSession(sessionId, { filePath, now = Date.now(), budgetMax = 0 } = {}) {
  const parsed = resolveParsed(sessionId, filePath)
  if (!parsed || !parsed.summary) return

  const snapshot = buildSnapshot(parsed)
  snapshot.pendingApprovalSince = getPendingApprovalSince(sessionId)
  if (!(budgetMax > 0)) snapshot.rollingAvgCost = computeRollingAvgCost(sessionId)

  const meta = isMetaSession(snapshot.cwd)
  const anomalies = detectAnomalies(snapshot, { now, budgetMax, meta })
  const currentKinds = new Set(anomalies.map((a) => a.kind))
  const prevKinds = activeAnomalies.get(sessionId) || new Set()

  for (const anomaly of anomalies) {
    if (prevKinds.has(anomaly.kind)) continue // already alerted — still active
    const record = { type: 'anomaly', ...anomaly }
    try {
      emit('anomaly', record)
    } catch (err) {
      logger.warn({ detail: err.message }, 'anomaly_emit_failed')
    }
    appendAnomalyLog(record)
  }

  if (currentKinds.size === 0) activeAnomalies.delete(sessionId)
  else activeAnomalies.set(sessionId, currentKinds)
}

// Periodic sweep over all sessions — catches stall + approval-timeout, which are
// about elapsed SILENCE and so cannot be detected from a change event. Returns
// the interval timer so boot/tests can clear it.
export function startAnomalySweep({ intervalMs = 30_000, budgetMax = 0 } = {}) {
  const tick = () => {
    let sessions
    try {
      sessions = getAllSessions() || []
    } catch {
      return
    }
    for (const s of sessions) {
      scanSession(s.sessionId, { filePath: s.filePath, budgetMax }).catch(() => {})
    }
  }
  const timer = setInterval(tick, intervalMs)
  if (typeof timer.unref === 'function') timer.unref()
  return timer
}
