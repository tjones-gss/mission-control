import { Router } from 'express'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { getConfigForSession } from '../parsers/config.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getMemoryForSession } from '../parsers/memory.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'
import { runClaude } from '../claude-cli.js'
import {
  startQuery,
  spawnNewSession,
  isQueryActive,
  getQueryStatus,
  resolveApproval,
  cancelQuery,
  VALID_PERMISSION_MODES,
  VALID_MODEL_SHORTCUTS,
} from '../pty-session.js'
import { onEvent } from '../sse.js'
import { validateSessionId } from '../utils/validate.js'
import { formatAsMarkdown, formatAsJson } from '../utils/export.js'
import { atomicWriteJson } from '../lib/atomic-write.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json')

// ──────────────────────────────────────────────────────────────────────────────
// Image upload config
// ──────────────────────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(os.tmpdir(), 'oversight-uploads')
const ALLOWED_MIME = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

// Ensure upload dir exists
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// Clean up stale temp files on startup (timers are lost on server restart)
const STALE_AGE_MS = 5 * 60 * 1000 // 5 minutes
try {
  const now = Date.now()
  for (const file of fs.readdirSync(UPLOAD_DIR)) {
    const filePath = path.join(UPLOAD_DIR, file)
    const stat = fs.statSync(filePath)
    if (now - stat.mtimeMs > STALE_AGE_MS) {
      fs.unlinkSync(filePath)
    }
  }
} catch {
  /* ignore cleanup errors */
}

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || mimeToExt(file.mimetype)
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`)
  },
})

const upload = multer({
  storage,
  limits: { fileSize: MAX_IMAGE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME.has(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'))
    }
  },
})

function mimeToExt(mime) {
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/gif': '.gif',
    'image/webp': '.webp',
  }
  return map[mime] || '.bin'
}

function cleanupTempFile(filePath, sessionId) {
  let removeListener = null

  // Clean up after session_update indicates response complete, or 5-min timeout
  const timeout = setTimeout(() => {
    try {
      fs.unlinkSync(filePath)
    } catch {
      /* already gone */
    }
    if (removeListener) removeListener()
  }, 300_000)

  removeListener = onEvent((event, data) => {
    if (event !== 'session_update') return
    if (!data?.filePath?.includes(sessionId)) return
    // Response started — wait a bit for completion, then clean up
    setTimeout(() => {
      try {
        fs.unlinkSync(filePath)
      } catch {
        /* already gone */
      }
      clearTimeout(timeout)
      removeListener()
    }, 5000)
  })
}

function cleanupUploadedFile(req) {
  if (req.file)
    try {
      fs.unlinkSync(req.file.path)
    } catch {
      /* ignore */
    }
}

export const router = Router()

// Multer error handler — must be on the router so file-too-large / invalid-type
// errors return a clean 400 instead of a raw 500 stack trace.
router.use((err, _req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Image too large (max 5MB)' })
  }
  if (err.message?.includes('images are allowed')) {
    return res.status(400).json({ error: err.message })
  }
  next(err)
})

// Note: concurrency control for queries is handled by pty-session.js isQueryActive()

// Validate :sessionId param when present (alphanumeric, hyphens, underscores only)
router.param('sessionId', (req, res, next, id) => {
  if (!validateSessionId(id, res)) return
  next()
})

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

export async function loadSessionNames() {
  if (sessionNamesCache) return sessionNamesCache
  try {
    sessionNamesCache = JSON.parse(await fsp.readFile(NAMES_FILE, 'utf-8'))
  } catch {
    sessionNamesCache = {}
  }
  return sessionNamesCache
}

async function saveSessionNames(names) {
  sessionNamesCache = names
  await fsp.mkdir(path.dirname(NAMES_FILE), { recursive: true })
  await atomicWriteJson(NAMES_FILE, names)
}

// ──────────────────────────────────────────────────────────────────────────────
// Read endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const sessions = getAllSessions()
    const names = await loadSessionNames()
    const enriched = sessions.map((s) => ({
      ...s,
      displayName: names[s.sessionId] || null,
    }))
    res.json(enriched)
  } catch (err) {
    next(err)
  }
})

router.get('/:sessionId', async (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const names = await loadSessionNames()
  res.json({ ...session, displayName: names[session.sessionId] || null })
})

router.get('/:sessionId/messages', (req, res) => {
  // ?limit=N defaults to "last N messages" (slice from the end of the
  // history, which is what users actually look at first). ?offset=K
  // pages forward from K. Pass nothing to get the full history (legacy
  // behavior, kept for backwards compat with older client code).
  const limitRaw = req.query.limit
  const offsetRaw = req.query.offset
  let limit
  if (limitRaw !== undefined) {
    limit = parseInt(limitRaw, 10)
    if (Number.isNaN(limit) || limit < 1) {
      return res.status(400).json({ error: 'limit must be a positive integer' })
    }
  }
  let offset = 0
  if (offsetRaw !== undefined) {
    offset = parseInt(offsetRaw, 10)
    if (Number.isNaN(offset) || offset < 0) {
      return res.status(400).json({ error: 'offset must be a non-negative integer' })
    }
  }
  const result = getSessionMessages(req.params.sessionId, { limit, offset })
  if (!result) return res.status(404).json({ error: 'Session not found' })
  res.json(result)
})

router.get('/:sessionId/memory', (req, res) => {
  const result = getMemoryForSession(req.params.sessionId)
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

router.get('/:sessionId/config', (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  res.json(getConfigForSession(session.cwd))
})

// ──────────────────────────────────────────────────────────────────────────────
// Export endpoint
// ──────────────────────────────────────────────────────────────────────────────

router.get('/:sessionId/export', (req, res) => {
  const { sessionId } = req.params
  const format = req.query.format || 'md'

  const session = getSessionById(sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const result = getSessionMessages(sessionId)
  const messages = result ? result.messages : []

  if (format === 'json') {
    const body = formatAsJson(session, messages)
    res.set('Content-Type', 'application/json')
    res.set('Content-Disposition', `attachment; filename="${sessionId}.json"`)
    return res.send(body)
  }

  const body = formatAsMarkdown(session, messages)
  res.set('Content-Type', 'text/markdown; charset=utf-8')
  res.set('Content-Disposition', `attachment; filename="${sessionId}.md"`)
  return res.send(body)
})

// ──────────────────────────────────────────────────────────────────────────────
// Interaction endpoints
// ──────────────────────────────────────────────────────────────────────────────

router.post('/:sessionId/message', upload.single('image'), async (req, res) => {
  const { sessionId } = req.params

  // Support both JSON body and multipart form-data
  const message = req.body.message
  let options
  try {
    options = typeof req.body.options === 'string' ? JSON.parse(req.body.options) : req.body.options
  } catch {
    cleanupUploadedFile(req)
    return res.status(400).json({ error: 'Invalid options JSON' })
  }

  if (!message || typeof message !== 'string' || !message.trim()) {
    cleanupUploadedFile(req)
    return res.status(400).json({ error: 'message is required' })
  }

  const session = getSessionById(sessionId)
  if (!session) {
    cleanupUploadedFile(req)
    return res.status(404).json({ error: 'Session not found' })
  }

  if (isQueryActive(sessionId)) {
    cleanupUploadedFile(req)
    return res.status(409).json({ error: 'A query is already active for this session' })
  }

  // Build prompt — append image reference if an image was uploaded
  let prompt = message.trim()
  if (req.file) {
    const imgPath = req.file.path.replace(/\\/g, '/')
    prompt += `\n\n[User attached an image. View it using the Read tool at: ${imgPath}]`
  }

  // Use PTY (interactive mode) to send messages — uses subscription auth, not API credits.
  // Response data flows through the JSONL watcher → session_update SSE.
  try {
    const result = await startQuery({
      sessionId,
      prompt,
      cwd: session.cwd || undefined,
      sdkOptions: buildSdkOptions(options),
    })
    // Start temp file cleanup only after query is successfully started
    if (req.file) cleanupTempFile(req.file.path, sessionId)
    res.status(202).json(result)
  } catch (err) {
    cleanupUploadedFile(req)
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

  // Use CLI subprocess for new session creation (stable on Windows).
  // PTY is only used for resuming existing sessions (message endpoint).
  try {
    const baseArgs = ['-p', prompt.trim(), '--output-format', 'json']
    if (name && typeof name === 'string' && name.trim()) {
      baseArgs.push('--name', name.trim())
    }
    if (worktree === true) {
      baseArgs.push('--worktree')
    }
    const args = buildCliArgs(baseArgs, options)
    const { stdout, stderr } = await runClaude({ args, cwd, timeoutMs: 300_000 })
    let result
    try {
      result = JSON.parse(stdout)
    } catch {
      result = { raw: stdout }
    }
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
    const args = buildCliArgs(
      ['--resume', sessionId, '--fork-session', '-p', prompt.trim(), '--output-format', 'json'],
      options,
    )

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

router.post('/:sessionId/name', async (req, res) => {
  const { sessionId } = req.params
  const { name } = req.body

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }

  const names = await loadSessionNames()
  names[sessionId] = name.trim()
  await saveSessionNames(names)

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
