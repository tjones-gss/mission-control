import express from 'express'
import cors from 'cors'
import { config } from './lib/config.js'
import { securityMiddleware, getCorsOrigin } from './middleware/security.js'
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
import { startWatcher } from './watcher.js'
import { logger } from './lib/logger.js'
import './intelligence/triggers.js'

const app = express()

// Middleware stack (order matters)
app.use(cors({ origin: getCorsOrigin() }))
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

const server = app.listen(config.port, () => {
  logger.info(`Server → http://localhost:${config.port}`)
  const watcher = startWatcher()
  setHealthReady()
  registerShutdown({ server, watcher })
})
