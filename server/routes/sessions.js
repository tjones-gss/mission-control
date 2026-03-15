import { Router } from 'express'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'
import { runClaude } from '../claude-cli.js'

export const router = Router()

// Track sessions currently being interacted with to prevent concurrent writes
const activeSends = new Set()

router.get('/', (req, res) => {
  res.json(getAllSessions())
})

router.get('/:sessionId', (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(session)
})

router.get('/:sessionId/messages', (req, res) => {
  const result = getSessionMessages(req.params.sessionId)
  if (!result) return res.status(404).json({ error: 'Session not found' })
  res.json(result)
})

router.get('/:sessionId/intelligence', async (req, res) => {
  const { sessionId } = req.params

  const cached = getCached(sessionId)
  if (cached) return res.json({ ...cached.result, analyzedAt: cached.timestamp })

  const inFlight = getInFlight(sessionId)
  if (inFlight) {
    try {
      const result = await inFlight
      return res.json({ ...result, analyzedAt: Date.now() })
    } catch (err) {
      return res.status(503).json({
        error: 'analysis_failed',
        detail: err.message,
        stderr: err.stderrOutput || null,
      })
    }
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'not found' })

  try {
    const result = await runAnalysis(sessionId, session)
    res.json({ ...result, analyzedAt: Date.now() })
  } catch (err) {
    res.status(503).json({
      error: 'analysis_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Interaction endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:sessionId/message', async (req, res) => {
  const { sessionId } = req.params
  const { message } = req.body

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message is required' })
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  if (activeSends.has(sessionId)) {
    return res.status(409).json({ error: 'A message is already being sent to this session' })
  }

  activeSends.add(sessionId)
  try {
    const { stdout, stderr } = await runClaude({
      args: [
        '--resume', sessionId,
        '-p', message.trim(),
        '--output-format', 'json',
      ],
      cwd: session.cwd || undefined,
      timeoutMs: 120_000,
    })

    let result
    try {
      result = JSON.parse(stdout)
    } catch {
      result = { raw: stdout }
    }

    res.json({ ok: true, result, stderr: stderr || undefined })
  } catch (err) {
    res.status(503).json({
      error: 'send_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  } finally {
    activeSends.delete(sessionId)
  }
})

router.post('/:sessionId/skill', async (req, res) => {
  const { sessionId } = req.params
  const { skill, args } = req.body

  if (!skill || typeof skill !== 'string') {
    return res.status(400).json({ error: 'skill is required' })
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  if (activeSends.has(sessionId)) {
    return res.status(409).json({ error: 'A message is already being sent to this session' })
  }

  // Skills are invoked as slash commands in the prompt
  const prompt = args ? `/${skill} ${args}` : `/${skill}`

  activeSends.add(sessionId)
  try {
    const { stdout, stderr } = await runClaude({
      args: [
        '--resume', sessionId,
        '-p', prompt,
        '--output-format', 'json',
      ],
      cwd: session.cwd || undefined,
      timeoutMs: 120_000,
    })

    let result
    try {
      result = JSON.parse(stdout)
    } catch {
      result = { raw: stdout }
    }

    res.json({ ok: true, result, stderr: stderr || undefined })
  } catch (err) {
    res.status(503).json({
      error: 'skill_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  } finally {
    activeSends.delete(sessionId)
  }
})

router.post('/new', async (req, res) => {
  const { cwd, prompt } = req.body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' })
  }
  if (!cwd || typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd is required' })
  }

  try {
    const { stdout, stderr } = await runClaude({
      args: [
        '-p', prompt.trim(),
        '--output-format', 'json',
      ],
      cwd,
      timeoutMs: 120_000,
    })

    let result
    try {
      result = JSON.parse(stdout)
    } catch {
      result = { raw: stdout }
    }

    res.status(201).json({ ok: true, result, stderr: stderr || undefined })
  } catch (err) {
    res.status(503).json({
      error: 'session_create_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  }
})
