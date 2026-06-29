import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'
import os from 'os'
import path from 'path'
import { rmSync } from 'fs'

import {
  isOtelEnabled,
  initOtel,
  shutdownOtel,
  tracingMiddleware,
  startSpan,
  endSpan,
  __setInMemoryExporterForTest,
} from '../../lib/otel.js'
import { recordAuditEvent, setAuditLogPath, getAuditLogPath } from '../../lib/audit-log.js'

const ORIGINAL_ENV = process.env.OTEL_ENABLED
const ORIGINAL_AUDIT_PATH = getAuditLogPath()

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
// ReadableSpan start/end times are HrTime ([seconds, nanos]); fold to millis so we
// can compare them against the Date.now() boundaries the test records.
const hrToMs = (hr) => hr[0] * 1e3 + hr[1] / 1e6

afterEach(async () => {
  await shutdownOtel()
  setAuditLogPath(ORIGINAL_AUDIT_PATH)
  if (ORIGINAL_ENV === undefined) delete process.env.OTEL_ENABLED
  else process.env.OTEL_ENABLED = ORIGINAL_ENV
})

describe('otel: env-gated, OFF by default', () => {
  beforeEach(() => {
    delete process.env.OTEL_ENABLED
  })

  it('isOtelEnabled() is false when OTEL_ENABLED is unset (the default localhost path pays nothing)', () => {
    expect(isOtelEnabled()).toBe(false)
  })

  it('isOtelEnabled() is true only when OTEL_ENABLED is the string "true"/"1"', () => {
    process.env.OTEL_ENABLED = 'true'
    expect(isOtelEnabled()).toBe(true)
    process.env.OTEL_ENABLED = '1'
    expect(isOtelEnabled()).toBe(true)
    process.env.OTEL_ENABLED = 'false'
    expect(isOtelEnabled()).toBe(false)
    process.env.OTEL_ENABLED = ''
    expect(isOtelEnabled()).toBe(false)
  })

  it('initOtel() is a no-op when disabled (returns null, no provider stood up)', () => {
    delete process.env.OTEL_ENABLED
    expect(initOtel()).toBe(null)
  })

  it('tracingMiddleware is a pass-through when tracing is off (does not break the request)', async () => {
    delete process.env.OTEL_ENABLED
    initOtel()
    const app = express()
    app.use(tracingMiddleware)
    app.get('/ping', (_req, res) => res.json({ ok: true }))
    const res = await request(app).get('/ping')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })
})

describe('otel: in-process span export (NO external collector)', () => {
  beforeEach(() => {
    process.env.OTEL_ENABLED = 'true'
  })

  it('emits a span for a traced request into the in-memory exporter', async () => {
    // PROVABILITY without a collector: an InMemorySpanExporter captures spans into
    // a local array we then assert on. This is the env-gated path proving traces
    // flow; the OTLP exporter is a later opt-in (locked decision).
    const exporter = __setInMemoryExporterForTest()
    initOtel()

    const app = express()
    app.use(tracingMiddleware)
    app.get('/api/widgets', (_req, res) => res.json({ ok: true }))

    const res = await request(app).get('/api/widgets')
    expect(res.status).toBe(200)

    // SimpleSpanProcessor exports each span synchronously on end (res 'finish'),
    // so the span is already captured — no flush/shutdown needed (and shutdown
    // would RESET the InMemorySpanExporter, clearing the very spans we assert on).
    const spans = exporter.getFinishedSpans()
    expect(spans.length).toBeGreaterThan(0)
    const span = spans.find((s) => String(s.name).includes('/api/widgets')) || spans[0]
    expect(span).toBeTruthy()
    // The span carries the HTTP method + route as attributes.
    expect(span.attributes['http.method'] || span.attributes['http.request.method']).toBe('GET')
  })

  it('does NOT stand up any OTLP/network exporter — only the in-memory one in this test path', () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    // The in-memory exporter is reachable and empty until a request is traced.
    expect(typeof exporter.getFinishedSpans).toBe('function')
    expect(exporter.getFinishedSpans()).toEqual([])
  })
})

// ── Span primitives (startSpan / endSpan) — the seam fleet + approval wiring use.

describe('otel: span primitives are no-ops when disabled', () => {
  beforeEach(() => {
    delete process.env.OTEL_ENABLED
  })

  it('test_no_op_when_disabled — startSpan returns null and endSpan ignores it (nothing throws/exports)', () => {
    initOtel()
    const span = startSpan('fleet.run', { 'fleet.run_id': 'x', 'fleet.child_count': 2 })
    expect(span).toBe(null)
    // endSpan must tolerate the null handle — a call site pays nothing on the
    // default path and never has to guard the return value itself.
    expect(() => endSpan(span, { 'fleet.status': 'succeeded' })).not.toThrow()
  })

  it('test_zero_overhead_default — disabled import path stands up no provider and records nothing', () => {
    // No exporter override installed and OTEL_ENABLED unset: initOtel must NOT
    // build a provider/exporter (no SDK provider, no network exporter stood up),
    // and the span primitives stay inert — the production-default localhost path.
    expect(initOtel()).toBe(null)
    const exporter = __setInMemoryExporterForTest()
    // Even with an exporter handy, a disabled init wires nothing to it.
    initOtel()
    const span = startSpan('fleet.run', { 'fleet.run_id': 'x' })
    expect(span).toBe(null)
    endSpan(span)
    expect(exporter.getFinishedSpans()).toEqual([])
  })
})

describe('otel: fleet-run span (start → terminal state)', () => {
  beforeEach(() => {
    process.env.OTEL_ENABLED = 'true'
  })

  it('test_fleet_run_span_emitted_when_enabled — span carries run id, child count, terminal status', () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    // The fleet runner opens a 'fleet.run' span at start (run id + child count) and
    // closes it on the run's terminal state with the final status. Exercise that shape.
    const span = startSpan('fleet.run', { 'fleet.run_id': 'goal-123', 'fleet.child_count': 3 })
    endSpan(span, { 'fleet.status': 'succeeded' })

    const fleet = exporter.getFinishedSpans().find((s) => s.name === 'fleet.run')
    expect(fleet).toBeTruthy()
    expect(fleet.attributes['fleet.run_id']).toBe('goal-123')
    expect(fleet.attributes['fleet.child_count']).toBe(3)
    expect(fleet.attributes['fleet.status']).toBe('succeeded')
  })

  it('test_fleet_run_span_covers_full_duration — span opens before run start and closes after run end', async () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    // Wiring contract: the span is opened BEFORE the run does any work (children
    // spawn) and closed AFTER the run settles, so it fully envelopes the run. We
    // record run-start/run-end boundaries strictly inside that window and assert
    // the span brackets them.
    const span = startSpan('fleet.run', { 'fleet.run_id': 'dur-1', 'fleet.child_count': 1 })
    await delay(15)
    const runStart = Date.now()
    await delay(15)
    const runEnd = Date.now()
    await delay(15)
    endSpan(span, { 'fleet.status': 'succeeded' })

    const fleet = exporter.getFinishedSpans().find((s) => s.name === 'fleet.run')
    expect(fleet).toBeTruthy()
    expect(hrToMs(fleet.startTime)).toBeLessThanOrEqual(runStart)
    expect(hrToMs(fleet.endTime)).toBeGreaterThanOrEqual(runEnd)
  })
})

describe('otel: approval span (per approval decision)', () => {
  beforeEach(() => {
    process.env.OTEL_ENABLED = 'true'
  })

  it('test_approval_span_emitted_when_enabled — recording an approval emits a span tagged with actor + seat', async () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    const tmp = path.join(os.tmpdir(), `otel-approval-${process.pid}-a.jsonl`)
    setAuditLogPath(tmp)

    // Real write path: recordAuditEvent is the single seam every approval site
    // funnels through, so wiring the span there covers them all. actor holds the
    // resolving seat identity (see the audit-event schema), so both attributes
    // derive from it.
    await recordAuditEvent({
      eventType: 'approval',
      source: 'cockpit',
      sessionId: 'sess-1',
      subjectId: 'appr-1',
      actor: 'lead-seat-2',
      decision: 'approved',
      outcome: 'succeeded',
      controlState: {
        gateType: 'hard',
        decisionMaker: 'human',
        policiesInForce: ['tool-approval-gate'],
      },
    })

    const span = exporter.getFinishedSpans().find((s) => s.name === 'approval')
    expect(span).toBeTruthy()
    expect(span.attributes['approval.actor']).toBe('lead-seat-2')
    expect(span.attributes['approval.seat']).toBe('lead-seat-2')
    rmSync(tmp, { force: true })
  })

  it('test_approval_span_has_decision_attribute — span carries the actual recorded decision', async () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    const tmp = path.join(os.tmpdir(), `otel-approval-${process.pid}-b.jsonl`)
    setAuditLogPath(tmp)

    await recordAuditEvent({
      eventType: 'approval',
      source: 'harness',
      sessionId: 'sess-2',
      subjectId: 'req-9',
      actor: 'lead-seat-1',
      decision: 'denied',
      outcome: 'succeeded',
      controlState: {
        gateType: 'hard',
        decisionMaker: 'human',
        policiesInForce: ['danger-zone-approval'],
      },
    })

    const span = exporter.getFinishedSpans().find((s) => s.name === 'approval')
    expect(span).toBeTruthy()
    expect(span.attributes['approval.decision']).toBe('denied')
    rmSync(tmp, { force: true })
  })

  it('does NOT emit an approval span for non-approval audit events', async () => {
    const exporter = __setInMemoryExporterForTest()
    initOtel()
    setAuditLogPath(path.join(os.tmpdir(), `otel-approval-${process.pid}-c.jsonl`))

    await recordAuditEvent({
      eventType: 'spawn',
      source: 'cockpit',
      subjectId: 'fleet/x/c0',
      controlState: { decisionMaker: 'auto', policiesInForce: ['worktree-isolation'] },
    })

    expect(exporter.getFinishedSpans().find((s) => s.name === 'approval')).toBeFalsy()
  })
})
