import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Mock the shared SSE channel — assert anomalies broadcast on the SAME channel
// the watcher uses (emit), so the 'anomaly' event reaches every connected client.
const emit = vi.fn()
let onEventCb = null
const onEvent = vi.fn((cb) => {
  onEventCb = cb
  return () => {
    onEventCb = null
  }
})
vi.mock('../../sse.js', () => ({ emit: (...a) => emit(...a), onEvent: (...a) => onEvent(...a) }))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

// Mock the parsers so scanSession can be driven from fixtures (no ~/.claude read).
const parseSessionRecord = vi.fn()
const getAllSessions = vi.fn(() => [])
vi.mock('../../parsers/sessions.js', () => ({
  parseSessionRecord: (...a) => parseSessionRecord(...a),
  getAllSessions: (...a) => getAllSessions(...a),
}))

// Mock the ADR-0008 index modules so the sweep's session source is
// deterministic: index when the db is healthy, parser fallback when not.
const listSessions = vi.fn(() => [])
vi.mock('../../lib/db/session-index.js', () => ({
  listSessions: (...a) => listSessions(...a),
}))
const isDbUnavailable = vi.fn(() => false)
vi.mock('../../lib/db/connection.js', () => ({
  isDbUnavailable: (...a) => isDbUnavailable(...a),
}))

import {
  detectAnomalies,
  buildSnapshot,
  trackApproval,
  resolveApproval,
  getPendingApprovalSince,
  scanSession,
  startApprovalTracking,
  startAnomalySweep,
  setAnomalyLogPath,
  getAnomalyLogPath,
  readAnomalyLog,
  __resetAnomalyState,
  STALL_MS,
  APPROVAL_TIMEOUT_MS,
  LOOP_THRESHOLD,
  BUDGET_MULTIPLIER,
  META_STALL_MS,
  META_LOOP_THRESHOLD,
} from '../../intelligence/anomaly-detector.js'

const NOW = 1_700_000_000_000

beforeEach(() => {
  vi.clearAllMocks()
  __resetAnomalyState()
})

describe('detectAnomalies — stall', () => {
  const base = {
    sessionId: 's1',
    lastMainEndTurn: false,
    estimatedCost: 0,
    recentTools: [],
    humanMessageInWindow: false,
    pendingApprovalSince: null,
    rollingAvgCost: null,
  }

  it('fires when a mid-task session has been silent past the stall threshold', () => {
    const snap = { ...base, lastModified: NOW - STALL_MS - 1000 }
    const out = detectAnomalies(snap, { now: NOW })
    const stall = out.find((a) => a.kind === 'stall')
    expect(stall).toBeTruthy()
    expect(stall.sessionId).toBe('s1')
    expect(typeof stall.detail).toBe('string')
    expect(stall.detail.length).toBeGreaterThan(0)
    expect(typeof stall.ts).toBe('number')
  })

  it('does NOT fire when the session ended its turn (waiting for human, not stalled)', () => {
    const snap = { ...base, lastMainEndTurn: true, lastModified: NOW - STALL_MS - 1000 }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'stall')).toBeFalsy()
  })

  it('does NOT fire when the session was active within the threshold', () => {
    const snap = { ...base, lastModified: NOW - 1000 }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'stall')).toBeFalsy()
  })
})

describe('detectAnomalies — meta (Oversight building itself) thresholds', () => {
  const base = {
    sessionId: 's1',
    lastMainEndTurn: false,
    estimatedCost: 0,
    recentTools: [],
    humanMessageInWindow: false,
    pendingApprovalSince: null,
    rollingAvgCost: null,
  }

  it('uses a tighter stall threshold for meta sessions', () => {
    expect(META_STALL_MS).toBeLessThan(STALL_MS)
    // Silent between the meta and normal thresholds: a stall for meta, not normal.
    const snap = { ...base, lastModified: NOW - META_STALL_MS - 1000 }
    expect(
      detectAnomalies(snap, { now: NOW, meta: true }).find((a) => a.kind === 'stall'),
    ).toBeTruthy()
    expect(
      detectAnomalies(snap, { now: NOW, meta: false }).find((a) => a.kind === 'stall'),
    ).toBeFalsy()
  })

  it('uses a tighter loop threshold for meta sessions', () => {
    expect(META_LOOP_THRESHOLD).toBeLessThan(LOOP_THRESHOLD)
    // META_LOOP_THRESHOLD+1 identical calls: a loop for meta, not for normal.
    const recentTools = Array(META_LOOP_THRESHOLD + 1).fill('Bash')
    const snap = { ...base, lastMainEndTurn: true, lastModified: NOW, recentTools }
    expect(
      detectAnomalies(snap, { now: NOW, meta: true }).find((a) => a.kind === 'loop'),
    ).toBeTruthy()
    expect(
      detectAnomalies(snap, { now: NOW, meta: false }).find((a) => a.kind === 'loop'),
    ).toBeFalsy()
  })
})

describe('detectAnomalies — budget', () => {
  const base = {
    sessionId: 's1',
    lastModified: NOW,
    lastMainEndTurn: true,
    recentTools: [],
    humanMessageInWindow: true,
    pendingApprovalSince: null,
    rollingAvgCost: null,
  }

  it('fires when cost exceeds an explicit budget max', () => {
    const snap = { ...base, estimatedCost: 5.0 }
    const out = detectAnomalies(snap, { now: NOW, budgetMax: 1.0 })
    expect(out.find((a) => a.kind === 'budget')).toBeTruthy()
  })

  it('does NOT fire when cost is under an explicit budget max', () => {
    const snap = { ...base, estimatedCost: 0.5 }
    const out = detectAnomalies(snap, { now: NOW, budgetMax: 1.0 })
    expect(out.find((a) => a.kind === 'budget')).toBeFalsy()
  })

  it('fires when cost exceeds 10x the rolling average (no explicit budget)', () => {
    const snap = { ...base, estimatedCost: 1.0, rollingAvgCost: 0.05 }
    const out = detectAnomalies(snap, { now: NOW, budgetMax: 0 })
    const budget = out.find((a) => a.kind === 'budget')
    expect(budget).toBeTruthy()
    expect(budget.detail).toContain('average')
  })

  it('does NOT fire on rolling average when within the multiplier', () => {
    const snap = { ...base, estimatedCost: 0.1, rollingAvgCost: 0.05 }
    const out = detectAnomalies(snap, { now: NOW, budgetMax: 0 })
    expect(out.find((a) => a.kind === 'budget')).toBeFalsy()
  })

  it('explicit budget max takes precedence — does not double-count rolling average', () => {
    const snap = { ...base, estimatedCost: 5.0, rollingAvgCost: 0.05 }
    const out = detectAnomalies(snap, { now: NOW, budgetMax: 1.0 })
    expect(out.filter((a) => a.kind === 'budget').length).toBe(1)
  })
})

describe('detectAnomalies — infinite tool loop', () => {
  const base = {
    sessionId: 's1',
    lastModified: NOW,
    lastMainEndTurn: false,
    estimatedCost: 0,
    pendingApprovalSince: null,
    rollingAvgCost: null,
  }

  it('fires when one tool is called past the loop threshold with no human messages', () => {
    const recentTools = Array(LOOP_THRESHOLD + 1).fill('Bash')
    const snap = { ...base, recentTools, humanMessageInWindow: false }
    const out = detectAnomalies(snap, { now: NOW })
    const loop = out.find((a) => a.kind === 'loop')
    expect(loop).toBeTruthy()
    expect(loop.detail).toContain('Bash')
  })

  it('does NOT fire when a human message appeared within the window', () => {
    const recentTools = Array(LOOP_THRESHOLD + 1).fill('Bash')
    const snap = { ...base, recentTools, humanMessageInWindow: true }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'loop')).toBeFalsy()
  })

  it('does NOT fire at or below the loop threshold', () => {
    const recentTools = Array(LOOP_THRESHOLD).fill('Bash')
    const snap = { ...base, recentTools, humanMessageInWindow: false }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'loop')).toBeFalsy()
  })
})

describe('detectAnomalies — approval timeout', () => {
  const base = {
    sessionId: 's1',
    lastModified: NOW,
    lastMainEndTurn: true,
    estimatedCost: 0,
    recentTools: [],
    humanMessageInWindow: true,
    rollingAvgCost: null,
  }

  it('fires when an approval has been pending past the timeout', () => {
    const snap = { ...base, pendingApprovalSince: NOW - APPROVAL_TIMEOUT_MS - 1000 }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'approval')).toBeTruthy()
  })

  it('does NOT fire when the approval is still fresh', () => {
    const snap = { ...base, pendingApprovalSince: NOW - 1000 }
    const out = detectAnomalies(snap, { now: NOW })
    expect(out.find((a) => a.kind === 'approval')).toBeFalsy()
  })
})

describe('buildSnapshot', () => {
  it('extracts lastModified, cost, lastMainEndTurn and recent tools from a parsed session', () => {
    const parsed = {
      summary: {
        sessionId: 's7',
        lastModified: NOW,
        estimatedCost: 0.42,
      },
      lastMainEndTurn: false,
      records: [
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      ],
    }
    const snap = buildSnapshot(parsed)
    expect(snap.sessionId).toBe('s7')
    expect(snap.lastModified).toBe(NOW)
    expect(snap.estimatedCost).toBe(0.42)
    expect(snap.lastMainEndTurn).toBe(false)
    expect(snap.recentTools).toEqual(['Read', 'Bash'])
  })

  it('flags a human message in the window (genuine user text, not a tool result)', () => {
    const parsed = {
      summary: { sessionId: 's8', lastModified: NOW, estimatedCost: 0 },
      lastMainEndTurn: false,
      records: [
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
        { type: 'user', message: { content: 'please stop' } },
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
      ],
    }
    const snap = buildSnapshot(parsed)
    expect(snap.humanMessageInWindow).toBe(true)
  })

  it('does NOT count tool_result-only user records as human messages', () => {
    const parsed = {
      summary: { sessionId: 's9', lastModified: NOW, estimatedCost: 0 },
      lastMainEndTurn: false,
      records: [
        { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
      ],
    }
    const snap = buildSnapshot(parsed)
    expect(snap.humanMessageInWindow).toBe(false)
  })
})

describe('approval tracking', () => {
  it('records the earliest pending approval ts for a session and clears on resolve', () => {
    trackApproval('sX', 'a1', NOW)
    trackApproval('sX', 'a2', NOW + 5000)
    expect(getPendingApprovalSince('sX')).toBe(NOW)
    resolveApproval('a1')
    expect(getPendingApprovalSince('sX')).toBe(NOW + 5000)
    resolveApproval('a2')
    expect(getPendingApprovalSince('sX')).toBe(null)
  })
})

describe('startApprovalTracking', () => {
  it('mirrors tool_approval_request/resolved SSE events into the pending map', () => {
    startApprovalTracking()
    expect(onEvent).toHaveBeenCalledTimes(1)
    onEventCb('tool_approval_request', { sessionId: 'sZ', approvalId: 'ap1', ts: NOW })
    expect(getPendingApprovalSince('sZ')).toBe(NOW)
    onEventCb('tool_approval_resolved', { sessionId: 'sZ', approvalId: 'ap1' })
    expect(getPendingApprovalSince('sZ')).toBe(null)
  })
})

describe('scanSession — wiring (emit + append-only log + dedup)', () => {
  let logPath
  beforeEach(() => {
    logPath = path.join(os.tmpdir(), `anomalies-test-${Math.random().toString(36).slice(2)}.jsonl`)
    setAnomalyLogPath(logPath)
  })
  afterEach(() => {
    try {
      fs.unlinkSync(logPath)
    } catch {
      /* ignore */
    }
  })

  function stalledParsed() {
    return {
      summary: { sessionId: 's1', lastModified: NOW - STALL_MS - 1000, estimatedCost: 0 },
      lastMainEndTurn: false,
      records: [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash' }] } }],
    }
  }

  it('emits an anomaly SSE event and appends to the log for a new anomaly', async () => {
    parseSessionRecord.mockReturnValue(stalledParsed())
    await scanSession('s1', { now: NOW })
    const anomalyEmits = emit.mock.calls.filter(([name]) => name === 'anomaly')
    expect(anomalyEmits.length).toBe(1)
    expect(anomalyEmits[0][1]).toMatchObject({ type: 'anomaly', sessionId: 's1', kind: 'stall' })
    const log = readAnomalyLog()
    expect(log.length).toBe(1)
    expect(log[0].kind).toBe('stall')
  })

  it('does NOT re-emit the same active anomaly on a second scan (edge-triggered)', async () => {
    parseSessionRecord.mockReturnValue(stalledParsed())
    await scanSession('s1', { now: NOW })
    await scanSession('s1', { now: NOW + 1000 })
    const anomalyEmits = emit.mock.calls.filter(([name]) => name === 'anomaly')
    expect(anomalyEmits.length).toBe(1)
  })

  it('does nothing for an unparseable / missing session', async () => {
    parseSessionRecord.mockReturnValue(null)
    await scanSession('ghost', { now: NOW })
    expect(emit.mock.calls.filter(([n]) => n === 'anomaly').length).toBe(0)
  })
})

describe('scanSession — Sprint 2 semantic alerting (loop + cost runway)', () => {
  let logPath
  const iso = (ms) => new Date(ms).toISOString()
  beforeEach(() => {
    logPath = path.join(os.tmpdir(), `anomalies-test-${Math.random().toString(36).slice(2)}.jsonl`)
    setAnomalyLogPath(logPath)
  })
  afterEach(() => {
    try {
      fs.unlinkSync(logPath)
    } catch {
      /* ignore */
    }
  })

  it('emits a loop_detected anomaly when the session is in a tight tool loop', async () => {
    const bash = (ms) => ({
      type: 'assistant',
      timestamp: iso(ms),
      message: { content: [{ type: 'tool_use', name: 'bash', input: { command: 'ls' } }] },
    })
    parseSessionRecord.mockReturnValue({
      // lastMainEndTurn true + fresh mtime → isolate loop_detected from stall.
      summary: { sessionId: 's1', lastModified: NOW, estimatedCost: 0 },
      lastMainEndTurn: true,
      records: [bash(NOW - 60_000), bash(NOW - 30_000), bash(NOW)],
    })
    await scanSession('s1', { now: NOW })
    const loopEmit = emit.mock.calls.find(([n, d]) => n === 'anomaly' && d.kind === 'loop_detected')
    expect(loopEmit).toBeTruthy()
    expect(loopEmit[1]).toMatchObject({ sessionId: 's1', tool: 'bash', count: 3 })
  })

  it('emits a cost_runway anomaly when the session nears the budget ceiling', async () => {
    parseSessionRecord.mockReturnValue({
      summary: { sessionId: 's2', lastModified: NOW, estimatedCost: 0.9 },
      lastMainEndTurn: true,
      records: [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read' }] } }],
    })
    await scanSession('s2', { now: NOW, budgetMax: 1.0 })
    const runwayEmit = emit.mock.calls.find(([n, d]) => n === 'anomaly' && d.kind === 'cost_runway')
    expect(runwayEmit).toBeTruthy()
    expect(runwayEmit[1]).toMatchObject({ sessionId: 's2', pct: 90 })
  })
})

describe('log path accessors', () => {
  it('round-trips the configured log path', () => {
    setAnomalyLogPath('/tmp/foo.jsonl')
    expect(getAnomalyLogPath()).toBe('/tmp/foo.jsonl')
  })

  it('exposes BUDGET_MULTIPLIER as a stable constant', () => {
    expect(BUDGET_MULTIPLIER).toBe(10)
  })
})

// ADR-0008 degraded mode: the periodic sweep reads sessions from the SQLite
// index when the db is healthy, and MUST fall back to the direct parser scan
// when it is not — listSessions() never throws (it returns [] on error), so
// without the explicit isDbUnavailable() guard a db-less server would silently
// sweep zero sessions forever.
describe('startAnomalySweep — session source', () => {
  it('reads from the index when the db is healthy', () => {
    vi.useFakeTimers()
    try {
      isDbUnavailable.mockReturnValue(false)
      const timer = startAnomalySweep({ intervalMs: 1000 })
      vi.advanceTimersByTime(1001)
      clearInterval(timer)
      expect(listSessions).toHaveBeenCalled()
      expect(getAllSessions).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to the parser scan when the db is unavailable', () => {
    vi.useFakeTimers()
    try {
      isDbUnavailable.mockReturnValue(true)
      const timer = startAnomalySweep({ intervalMs: 1000 })
      vi.advanceTimersByTime(1001)
      clearInterval(timer)
      expect(getAllSessions).toHaveBeenCalled()
      expect(listSessions).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
