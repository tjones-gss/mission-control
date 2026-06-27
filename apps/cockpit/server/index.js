import express from 'express'
import cors from 'cors'
import { config } from './lib/config.js'
import {
  securityMiddleware,
  getCorsOrigin,
  hostCheck,
  originGuard,
  insecureExposureWarning,
} from './middleware/security.js'
import { requestLogger } from './middleware/requestLogger.js'
import { performanceMiddleware } from './middleware/performance.js'
import { registerShutdown } from './lib/lifecycle.js'
import { errorHandler } from './middleware/errorHandler.js'
import { router as sessionsRouter } from './routes/sessions.js'
import { router as tasksRouter } from './routes/tasks.js'
import { router as teamsRouter } from './routes/teams.js'
import { router as historyRouter } from './routes/history.js'
import { router as streamRouter } from './routes/stream.js'
import { router as skillsRouter } from './routes/skills.js'
import { router as workflowsRouter } from './routes/workflows.js'
import { router as plansRouter } from './routes/plans.js'
import { router as configRouter } from './routes/config.js'
import { router as hooksRouter } from './routes/hooks.js'
import { router as mcpRouter } from './routes/mcp.js'
import { router as managersRouter } from './routes/managers.js'
import { router as fsRouter } from './routes/fs.js'
import { router as healthRouter, setHealthReady } from './routes/health.js'
import { router as conductorRouter } from './routes/conductor.js'
import { router as harnessRouter } from './routes/harness.js'
import { router as railsRouter } from './routes/rails.js'
import { router as trustRouter } from './routes/trust.js'
import { router as fleetRouter } from './routes/fleet.js'
import { router as pipelinesRouter } from './routes/pipelines.js'
import { router as searchRouter } from './routes/search.js'
import { router as patternsRouter } from './routes/patterns.js'
import { router as graphRouter } from './routes/graph.js'
import { router as statsRouter } from './routes/stats.js'
import { router as meshRouter } from './routes/mesh.js'
import { reconcileFleetRuns } from './fleet/fleet-runner.js'
import { rebuildAll } from './lib/db/session-index.js'
import { rebuildMemoryIndex } from './lib/db/memory-index.js'
import { initOtel, tracingMiddleware } from './lib/otel.js'
import { initNotify } from './lib/notify.js'
import { mountOpenApi } from './lib/openapi.js'
import { startWatcher } from './watcher.js'
import { startHookLogWatcher } from './lib/hook-receiver.js'
import { startAnomalySweep, startApprovalTracking } from './intelligence/anomaly-detector.js'
import { logger } from './lib/logger.js'
import { fileURLToPath } from 'node:url'
import { argv } from 'node:process'
import './intelligence/triggers.js'

// ──────────────────────────────────────────────────────────────────────────────
// App factory (Phase 4 / D-audit-otel). buildApp() is the SINGLE place the
// middleware stack and routers are assembled, so cross-cutting concerns added
// this phase (OTel tracing) and later (S6's /api/docs mount) share ONE builder
// instead of each editing the module-top imperatively. It returns a configured
// express() app WITHOUT calling listen() — listen lives in start() below so the
// factory is import-safe for tests. createApp is an alias for symmetry with the
// pattern S6 rebases onto.
// ──────────────────────────────────────────────────────────────────────────────
export function buildApp() {
  const app = express()

  // OTel tracing is env-gated (OTEL_ENABLED) and OFF by default — initOtel() is a
  // no-op when disabled, so the localhost-first default path pays nothing. Init it
  // before the middleware stack so the per-request span middleware (also a bare
  // pass-through when disabled) wraps every route.
  initOtel()
  app.use(tracingMiddleware)

  // AFK gate notifier (Phase 4) — env-gated (OVERSIGHT_WEBHOOK_URL) and OFF by
  // default, same contract as OTel above: unset = total no-op. When set it
  // subscribes to the internal SSE pub/sub and POSTs approval-pending events to
  // the webhook. Notify-only — there is NO inbound path.
  initNotify()

  // Middleware stack (order matters)
  // DNS-rebinding guard runs FIRST — before CORS, routes, and everything else —
  // so a request with a foreign Host is rejected before any handler can see it.
  app.use(hostCheck)
  app.use(cors({ origin: getCorsOrigin() }))
  // CSRF / Origin guard for state-changing methods. Runs AFTER hostCheck + CORS
  // (a foreign Host or a blocked CORS origin is already gone) but BEFORE the
  // routers, so a forged cross-origin POST to a safety-critical endpoint such as
  // /api/sessions/:id/tool-approval is rejected before any handler sees it.
  app.use(originGuard)
  app.use(...securityMiddleware)
  app.use(requestLogger)
  app.use(...performanceMiddleware)
  app.use(express.json({ limit: '1mb' }))

  // Routes
  app.use('/api/sessions', sessionsRouter)
  app.use('/api/tasks', tasksRouter)
  app.use('/api/teams', teamsRouter)
  app.use('/api/history', historyRouter)
  app.use('/api/stream', streamRouter)
  app.use('/api/skills', skillsRouter)
  app.use('/api/workflows', workflowsRouter)
  app.use('/api/plans', plansRouter)
  app.use('/api/config', configRouter)
  app.use('/api/hooks', hooksRouter)
  app.use('/api/mcp-servers', mcpRouter)
  app.use('/api/managers', managersRouter)
  app.use('/api/fs', fsRouter)
  app.use('/api/health', healthRouter)
  app.use('/api/conductor', conductorRouter)
  app.use('/api/harness', harnessRouter)
  app.use('/api/rails', railsRouter)
  app.use('/api/trust', trustRouter)
  app.use('/api/fleet', fleetRouter)
  app.use('/api/pipelines', pipelinesRouter)
  app.use('/api/search', searchRouter)
  app.use('/api/patterns', patternsRouter)
  app.use('/api/graph', graphRouter)
  app.use('/api/stats', statsRouter)
  app.use('/api/mesh', meshRouter)

  // OpenAPI docs surface (Phase 4 / C-openapi). Mounted AFTER express.json + the
  // routers but BEFORE the '/api' 404 catch-all, so GET /api/docs(.json) is not
  // shadowed by the catch-all. index.js does NOT own this wiring's contents — it
  // only calls into lib/openapi.js (which owns the spec + the scoped CSP relax).
  mountOpenApi(app)

  // JSON 404 for any unmatched /api/* request — without this, Express
  // returns its built-in "Cannot POST X" HTML page, which forces every
  // client to handle two error response formats.
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'Not found',
      code: 'NOT_FOUND',
      method: req.method,
      path: req.originalUrl,
    })
  })

  // Error handler (must be last)
  app.use(errorHandler)

  return app
}

// Alias — same builder under the createApp name S6's /api/docs work rebases onto.
export const createApp = buildApp

// Start the server: build the app, bind the listener, wire the watcher/lifecycle,
// and kick the boot reconciler. Kept separate from buildApp so importing the
// factory (e.g. in a test) never opens a socket.
export function start() {
  const app = buildApp()

  // Startup security advisory (never fatal): warn if the cockpit is reachable
  // beyond loopback with no API key set. See middleware/security.js.
  const exposureWarning = insecureExposureWarning({
    host: config.host,
    apiKey: config.apiKey,
    allowedHosts: process.env.OVERSIGHT_ALLOWED_HOSTS,
  })
  if (exposureWarning) logger.warn(exposureWarning)

  // Prevent unhandled rejections from crashing the server (e.g., PTY spawn failures)
  process.on('unhandledRejection', (err) => {
    logger.error({ err: err?.message || err }, 'unhandled rejection (server stayed alive)')
  })

  const server = app.listen(config.port, config.host, () => {
    logger.info(`Server → http://${config.host}:${config.port}`)
    const watcher = startWatcher()
    // V3 hook instrumentation (opt-in): watch server/data/hook-log/ for tool-call
    // events dropped by the hook bridge and relay each as a `tool_call` SSE event.
    // If no bridge is installed the dir stays empty and this is inert — the
    // non-hook path (simulated MeshView packets) is never affected.
    startHookLogWatcher()
    // I1 anomaly detection: mirror the PTY approval lifecycle into the detector
    // (for the approval-timeout anomaly) and start the periodic stall/approval
    // sweep. Deterministic, no-LLM; the per-change loop/budget scan is wired in
    // the watcher. budgetMax comes from OVERSIGHT_BUDGET_MAX (0 = use the rolling
    // average baseline instead).
    startApprovalTracking()
    startAnomalySweep({ budgetMax: config.budgetMaxUsd })
    setHealthReady()
    registerShutdown({ server, watcher })
    // BOOT RECONCILER (item 1g) — symmetric to the lifecycle shutdown seam: on
    // start, reap any Fleet run left non-terminal by a previous crash/restart so no
    // run is wedged at 'running'. Fire-and-forget; a failure is logged, never fatal.
    reconcileFleetRuns().catch((err) =>
      logger.warn({ detail: err?.message || err }, 'fleet_boot_reconcile_failed'),
    )
    // ADR-0008 boot rebuild — background, chunked with setImmediate, reparsing
    // only (mtime,size) diffs. Until it completes, GET /api/sessions serves the
    // direct parser scan; on failure the index simply stays not-ready (the
    // degraded mode is the pre-index behavior, never an outage).
    rebuildAll().catch((err) =>
      logger.warn({ detail: err?.message || err }, 'session_index_rebuild_failed'),
    )
    // Phase 6: the knowledge lane of the same rebuild — project memory docs
    // into the search index. Same contract: background, failure is logged and
    // search simply lacks memory docs until the next boot.
    rebuildMemoryIndex().catch((err) =>
      logger.warn({ detail: err?.message || err }, 'memory_index_rebuild_failed'),
    )
  })

  return server
}

// Auto-start ONLY when run as the entry module (node index.js). Importing this
// file for its buildApp/createApp factory (e.g. from a test) must never bind a
// socket — the factory is import-safe; start() is the imperative entry point.
const isEntry = argv[1] && fileURLToPath(import.meta.url) === argv[1]
if (isEntry) {
  start()
}
