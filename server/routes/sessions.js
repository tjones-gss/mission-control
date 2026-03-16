import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'
import { runClaude } from '../claude-cli.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json')

export const router = Router()

// Track sessions currently being interacted with to prevent concurrent writes
const activeSends = new Set()

// ──────────────────────────────────────────────────────────────────────────────
// CLI options helper
// ──────────────────────────────────────────────────────────────────────────────

const VALID_PERMISSION_MODES = new Set(['plan', 'auto', 'default', 'acceptEdits', 'dontAsk', 'bypassPermissions'])
const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'max'])
const VALID_MODEL_SHORTCUTS = new Set(['sonnet', 'opus', 'haiku'])

function buildCliArgs(baseArgs, options) {
  const args = [...baseArgs]
  if (!options || typeof options !== 'object') return args

  if (options.permissionMode && VALID_PERMISSION_MODES.has(options.permissionMode)) {
    args.push('--permission-mode', options.permissionMode)
  }
  if (options.model) {
    // Accept shortcuts or full model names (e.g. claude-sonnet-4-6-20250514)
    if (VALID_MODEL_SHORTCUTS.has(options.model) || /^claude-/.test(options.model)) {
      args.push('--model', options.model)
    }
  }
  if (options.effort && VALID_EFFORTS.has(options.effort)) {
    args.push('--effort', options.effort)
  }

  return args
}

// ──────────────────────────────────────────────────────────────────────────────
// Session names store
// ──────────────────────────────────────────────────────────────────────────────

export function loadSessionNames() {
  try {
    return JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'))
  } catch {
    return {}
  }
}

function saveSessionNames(names) {
  fs.writeFileSync(NAMES_FILE, JSON.stringify(names, null, 2))
}

// ──────────────────────────────────────────────────────────────────────────────
// Read endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const sessions = getAllSessions()
  const names = loadSessionNames()
  const enriched = sessions.map(s => ({
    ...s,
    displayName: names[s.sessionId] || null,
  }))
  res.json(enriched)
})

router.get('/:sessionId', (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const names = loadSessionNames()
  res.json({ ...session, displayName: names[session.sessionId] || null })
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
  const { message, options } = req.body

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
    const args = buildCliArgs([
      '--resume', sessionId,
      '-p', message.trim(),
      '--output-format', 'json',
    ], options)

    const { stdout, stderr } = await runClaude({
      args,
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
  const { skill, args, options } = req.body

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
    const cliArgs = buildCliArgs([
      '--resume', sessionId,
      '-p', prompt,
      '--output-format', 'json',
    ], options)

    const { stdout, stderr } = await runClaude({
      args: cliArgs,
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
  const { cwd, prompt, options, name, worktree } = req.body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' })
  }
  if (!cwd || typeof cwd !== 'string') {
    return res.status(400).json({ error: 'cwd is required' })
  }

  try {
    const baseArgs = ['-p', prompt.trim(), '--output-format', 'json']

    if (name && typeof name === 'string' && name.trim()) {
      baseArgs.push('--name', name.trim())
    }
    if (worktree === true) {
      baseArgs.push('--worktree')
    }

    const args = buildCliArgs(baseArgs, options)

    const { stdout, stderr } = await runClaude({
      args,
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

// ──────────────────────────────────────────────────────────────────────────────
// Fork endpoint
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:sessionId/fork', async (req, res) => {
  const { sessionId } = req.params
  const { prompt, options } = req.body

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' })
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  try {
    const args = buildCliArgs([
      '--resume', sessionId,
      '--fork-session',
      '-p', prompt.trim(),
      '--output-format', 'json',
    ], options)

    const { stdout, stderr } = await runClaude({
      args,
      cwd: session.cwd || undefined,
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
      error: 'fork_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
    })
  }
})

// ──────────────────────────────────────────────────────────────────────────────
// Name endpoint
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:sessionId/name', (req, res) => {
  const { sessionId } = req.params
  const { name } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }

  const names = loadSessionNames()
  names[sessionId] = name.trim()
  saveSessionNames(names)

  res.json({ ok: true, sessionId, displayName: name.trim() })
})
