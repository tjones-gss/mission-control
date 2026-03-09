import express from 'express'
import cors from 'cors'
import { router as sessionsRouter } from './routes/sessions.js'
import { router as tasksRouter } from './routes/tasks.js'
import { router as teamsRouter } from './routes/teams.js'
import { router as historyRouter } from './routes/history.js'
import { router as streamRouter } from './routes/stream.js'
import { router as skillsRouter } from './routes/skills.js'
import { router as workflowsRouter } from './routes/workflows.js'
import { startWatcher } from './watcher.js'
import './intelligence/triggers.js'

const app = express()
const PORT = 3001

app.use(cors({ origin: /^http:\/\/localhost(:\d+)?$/ }))
app.use(express.json())

app.use('/api/sessions', sessionsRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/teams', teamsRouter)
app.use('/api/history', historyRouter)
app.use('/api/stream', streamRouter)
app.use('/api/skills', skillsRouter)
app.use('/api/workflows', workflowsRouter)

app.get('/api/health', (req, res) => res.json({ ok: true, ts: Date.now() }))

app.listen(PORT, () => {
  console.log(`Server → http://localhost:${PORT}`)
  startWatcher()
})
