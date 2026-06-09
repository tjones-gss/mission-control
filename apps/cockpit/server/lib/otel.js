// OpenTelemetry tracing — ENV-GATED, OFF BY DEFAULT (Phase 4 / D-audit-otel,
// LOCKED decision). The localhost-first default path pays NOTHING: with
// OTEL_ENABLED unset, initOtel() is a no-op and tracingMiddleware is a bare
// pass-through, so the singleton-localhost operator carries zero tracing cost.
//
// When OTEL_ENABLED is truthy we stand up a BasicTracerProvider and a per-request
// span middleware. PROVABILITY is in-process: a test installs an
// InMemorySpanExporter (__setInMemoryExporterForTest) and asserts spans land in its
// array — NO external collector is ever stood up in CI or on Win11. An OTLP /
// network exporter is a deliberate later opt-in, not this phase.

import { trace, context, SpanStatusCode } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  InMemorySpanExporter,
} from '@opentelemetry/sdk-trace-base'
import { logger } from './logger.js'

const SERVICE_NAME = 'oversight-cockpit'
const TRACER_NAME = 'oversight-cockpit/http'

// Test-only exporter override. When set, initOtel wires THIS exporter (in-memory)
// instead of any default, so a test can assert on captured spans with no collector.
let testExporter = null
// The live provider (only when enabled). Held so shutdownOtel can flush + dispose.
let provider = null

// OTEL_ENABLED gate. Accept the conventional truthy strings only ("true"/"1");
// anything else (unset, "false", "", "0") leaves tracing OFF.
export function isOtelEnabled() {
  const v = process.env.OTEL_ENABLED
  return v === 'true' || v === '1'
}

// Install an InMemorySpanExporter for the next initOtel() and return it so the test
// can read getFinishedSpans(). This is the provability seam — it keeps the assertion
// in-process and never touches the network. Returns the exporter instance.
export function __setInMemoryExporterForTest() {
  testExporter = new InMemorySpanExporter()
  return testExporter
}

// Stand up the tracer provider when enabled. No-op (returns null) when disabled, so
// the default path stays free. Idempotent-ish: a prior provider is shut down first.
export function initOtel() {
  if (!isOtelEnabled()) return null
  const exporter = testExporter || new InMemorySpanExporter()
  // SimpleSpanProcessor exports each span on end — adequate for the localhost
  // single-operator path and for the in-memory provability test (no batching delay).
  provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  // Register as the global provider so trace.getTracer(...) returns a real tracer.
  trace.setGlobalTracerProvider(provider)
  logger.info({ service: SERVICE_NAME }, 'otel_tracing_enabled')
  return provider
}

// Flush + dispose the provider (test cleanup + graceful shutdown). Safe to call when
// nothing was initialised. Also clears the test exporter override + global provider.
export async function shutdownOtel() {
  testExporter = null
  if (!provider) {
    trace.disable()
    return
  }
  try {
    await provider.forceFlush()
    await provider.shutdown()
  } catch (err) {
    logger.warn({ detail: err.message }, 'otel_shutdown_failed')
  } finally {
    provider = null
    trace.disable()
  }
}

// Per-request span middleware. When tracing is OFF it is a pure pass-through (no
// span, no overhead). When ON it opens a server span named "METHOD route", runs the
// rest of the stack inside that span's context, and ends it on response finish with
// the status code + an error status when the response is a 5xx.
export function tracingMiddleware(req, res, next) {
  if (!isOtelEnabled() || !provider) return next()

  const tracer = trace.getTracer(TRACER_NAME)
  const route = req.originalUrl || req.url || ''
  const span = tracer.startSpan(`${req.method} ${route}`, {
    attributes: {
      'http.method': req.method,
      'http.target': route,
      'http.route': req.path,
    },
  })

  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode)
    if (res.statusCode >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: `HTTP ${res.statusCode}` })
    }
    span.end()
  })

  // Run the downstream handlers inside the span's active context so nested spans
  // (if any are ever added) parent correctly.
  context.with(trace.setSpan(context.active(), span), () => next())
}
