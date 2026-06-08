import express from 'express'
import cors from 'cors'
import { config } from './lib/config.js'
import { securityMiddleware, getCorsOrigin, hostCheck, originGuard } from './middleware/security.js'
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
import { reconcileFleetRuns } from './fleet/fleet-runner.js'
import { startWatcher } from './watcher.js'
import { logger } from './lib/logger.js'
import './intelligence/triggers.js'

const app = express()

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

// Prevent unhandled rejections from crashing the server (e.g., PTY spawn failures)
process.on('unhandledRejection', (err) => {
  logger.error({ err: err?.message || err }, 'unhandled rejection (server stayed alive)')
})

const server = app.listen(config.port, config.host, () => {
  logger.info(`Server → http://${config.host}:${config.port}`)
  const watcher = startWatcher()
  setHealthReady()
  registerShutdown({ server, watcher })
  // BOOT RECONCILER (item 1g) — symmetric to the lifecycle shutdown seam: on
  // start, reap any Fleet run left non-terminal by a previous crash/restart so no
  // run is wedged at 'running'. Fire-and-forget; a failure is logged, never fatal.
  reconcileFleetRuns().catch((err) =>
    logger.warn({ detail: err?.message || err }, 'fleet_boot_reconcile_failed'),
  )
})
