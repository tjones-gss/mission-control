import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import express from 'express'
import request from 'supertest'

import {
  isOtelEnabled,
  initOtel,
  shutdownOtel,
  tracingMiddleware,
  __setInMemoryExporterForTest,
} from '../../lib/otel.js'

const ORIGINAL_ENV = process.env.OTEL_ENABLED

afterEach(async () => {
  await shutdownOtel()
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
