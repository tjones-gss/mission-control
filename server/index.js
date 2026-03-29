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
app.use('/api/health', healthRouter)

// Error handler (must be last)
app.use(errorHandler)

const server = app.listen(config.port, () => {
  logger.info(`Server → http://localhost:${config.port}`)
  const watcher = startWatcher()
  setHealthReady()
  registerShutdown({ server, watcher })
})
