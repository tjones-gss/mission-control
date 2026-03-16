import { Router } from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'
import { runClaude } from '../claude-cli.js'
import { startQuery, isQueryActive, getQueryStatus, resolveApproval, cancelQuery, VALID_PERMISSION_MODES, VALID_MODEL_SHORTCUTS } from '../pty-session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json')

export const router = Router()

// Note: concurrency control for queries is handled by pty-session.js isQueryActive()

// ──────────────────────────────────────────────────────────────────────────────
// CLI options helper
// ──────────────────────────────────────────────────────────────────────────────

const VALID_EFFORTS = new Set(['low', 'medium', 'high', 'max'])

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

function buildSdkOptions(options) {
  const sdk = {}
  if (!options || typeof options !== 'object') return sdk

  if (options.permissionMode && VALID_PERMISSION_MODES.has(options.permissionMode)) {
    sdk.permissionMode = options.permissionMode
  }
  if (options.model) {
    if (VALID_MODEL_SHORTCUTS.has(options.model) || /^claude-/.test(options.model)) {
      sdk.model = options.model
    }
  }

  return sdk
}

// ──────────────────────────────────────────────────────────────────────────────
// Session names store
// ──────────────────────────────────────────────────────────────────────────────

// In-memory cache — loaded once, updated on writes
let sessionNamesCache = null

export function loadSessionNames() {
  if (sessionNamesCache) return sessionNamesCache
  try {
    sessionNamesCache = JSON.parse(fs.readFileSync(NAMES_FILE, 'utf-8'))
  } catch {
    sessionNamesCache = {}
  }
  return sessionNamesCache
}

function saveSessionNames(names) {
  sessionNamesCache = names
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

  if (isQueryActive(sessionId)) {
    return res.status(409).json({ error: 'A query is already active for this session' })
  }

  try {
    const result = await startQuery({
      sessionId,
      prompt: message.trim(),
      cwd: session.cwd || undefined,
      sdkOptions: buildSdkOptions(options),
    })
    res.status(202).json(result)
  } catch (err) {
    res.status(503).json({
      error: 'send_failed',
      detail: err.message,
    })
  }
})

router.post('/:sessionId/skill', async (req, res) => {
  const { sessionId } = req.params
  const { skill, args: skillArgs, options } = req.body

  if (!skill || typeof skill !== 'string') {
    return res.status(400).json({ error: 'skill is required' })
  }

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  if (isQueryActive(sessionId)) {
    return res.status(409).json({ error: 'A query is already active for this session' })
  }

  const prompt = skillArgs ? `/${skill} ${skillArgs}` : `/${skill}`

  try {
    const result = await startQuery({
      sessionId,
      prompt,
      cwd: session.cwd || undefined,
      sdkOptions: buildSdkOptions(options),
    })
    res.status(202).json(result)
  } catch (err) {
    res.status(503).json({
      error: 'skill_failed',
      detail: err.message,
    })
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

  // New sessions always use CLI path (PTY requires a sessionId to --resume)
  try {
    const baseArgs = ['-p', prompt.trim(), '--output-format', 'json']
    if (name && typeof name === 'string' && name.trim()) {
      baseArgs.push('--name', name.trim())
    }
    if (worktree === true) {
      baseArgs.push('--worktree')
    }
    const args = buildCliArgs(baseArgs, options)
    const { stdout, stderr } = await runClaude({ args, cwd, timeoutMs: 120_000 })
    let result
    try { result = JSON.parse(stdout) } catch { result = { raw: stdout } }
    return res.status(201).json({ ok: true, result, stderr: stderr || undefined })
  } catch (err) {
    return res.status(503).json({
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

// ──────────────────────────────────────────────────────────────────────────────
// SDK query control endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:sessionId/tool-approval', (req, res) => {
  const { sessionId } = req.params
  const { approvalId, decision, message } = req.body

  if (!approvalId || typeof approvalId !== 'string') {
    return res.status(400).json({ error: 'approvalId is required' })
  }
  if (decision !== 'allow' && decision !== 'deny') {
    return res.status(400).json({ error: 'decision must be "allow" or "deny"' })
  }

  const resolved = resolveApproval(sessionId, approvalId, decision, message)
  if (!resolved) {
    return res.status(404).json({ error: 'Approval not found or already resolved' })
  }

  res.json({ ok: true })
})

router.post('/:sessionId/cancel', (req, res) => {
  const { sessionId } = req.params

  const cancelled = cancelQuery(sessionId)
  if (!cancelled) {
    return res.status(404).json({ error: 'No active query for this session' })
  }

  res.json({ ok: true })
})

router.get('/:sessionId/query-status', (req, res) => {
  const { sessionId } = req.params
  res.json(getQueryStatus(sessionId))
})
