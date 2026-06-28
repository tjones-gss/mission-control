import { Router } from 'express'
import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { getAllSessions, getSessionById } from '../parsers/sessions.js'
import { listSessions, isIndexReady } from '../lib/db/session-index.js'
import { isDbUnavailable } from '../lib/db/connection.js'
import { worstClassification } from '../utils/commandClassifier.js'
import { isMetaSession } from '../intelligence/meta-session-detector.js'
import { getConfigForSession } from '../parsers/config.js'
import { getSessionMessages } from '../parsers/messages.js'
import { getMemoryForSession } from '../parsers/memory.js'
import { getCached, getInFlight } from '../intelligence/cache.js'
import { runAnalysis } from '../intelligence/triggers.js'
import { runClaude, runClaudeCancellable } from '../claude-cli.js'
import { awaitNewSession } from '../lib/pending-session.js'
import { logger } from '../lib/logger.js'
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
import { onEvent, emit } from '../sse.js'
import { validateSessionId, validateSlashCommand } from '../utils/validate.js'
import { formatAsMarkdown, formatAsJson } from '../utils/export.js'
import { atomicWriteJson } from '../lib/atomic-write.js'
import { recordAuditEventSafe } from '../lib/audit-log.js'
import { seatFromHeaders } from '../lib/seat.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const NAMES_FILE = path.join(__dirname, '..', 'data', 'session-names.json')

// Display names can hold any unicode (we want emoji and punctuation), but
// long ones break the sidebar layout and balloon the CLI --name arg. 80 chars
// is enough for any sensible session label and well below the 100-char
// file-name cap used elsewhere. Shared by the /new spawn path and the rename
// route so both enforce the same ceiling.
const MAX_DISPLAY_NAME_LENGTH = 80

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
// NDJSON stdout parser (used by stream-json CLI output)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Parse stdout from `--output-format stream-json`: one JSON object per line.
 * Returns the last object with `type === 'result'`, or the last parseable
 * object, or `{ raw: stdout }` as a fallback so callers always get an object.
 */
export function parseStreamJsonStdout(stdout) {
  if (!stdout || typeof stdout !== 'string') return { raw: stdout ?? '' }
  const objects = []
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      objects.push(JSON.parse(trimmed))
    } catch {
      // skip unparseable lines (e.g. debug noise)
    }
  }
  if (objects.length === 0) return { raw: stdout }
  const resultObj = [...objects].reverse().find((o) => o.type === 'result')
  return resultObj ?? objects[objects.length - 1]
}

// ──────────────────────────────────────────────────────────────────────────────
// Log helpers
// ──────────────────────────────────────────────────────────────────────────────

// CLI stdout/stderr can be multi-KB for long sessions. Cap what we hand to
// the structured logger so we don't flood pino or the log aggregator with
// output that's already streamed to the client. The full payload is still
// sent in the HTTP error body for the dashboard to render.
const LOG_OUTPUT_CAP = 2048

export function truncateForLog(text) {
  if (typeof text !== 'string' || text.length === 0) return text || null
  if (text.length <= LOG_OUTPUT_CAP) return text
  const kept = text.slice(0, LOG_OUTPUT_CAP)
  return `${kept}…[truncated ${text.length - LOG_OUTPUT_CAP} bytes]`
}

// ──────────────────────────────────────────────────────────────────────────────
// CLI options helper
// ──────────────────────────────────────────────────────────────────────────────

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
  // Note: options.effort is intentionally not forwarded. The claude CLI in -p
  // print mode rejects "--effort" with exit 1; effort is only an SDK option.

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

// ADR-0008: the SQLite session index replaces the old 3s TTL cache. The
// watcher upserts exactly the session that changed (event-driven
// invalidation), and listSessions() recomputes isActive/needsInput at read
// time. Degraded mode: when the db is unavailable — deleting cockpit.db must
// always be a safe user action — or while the boot rebuild hasn't completed
// yet (cold/stale index), fall back to the direct synchronous parser scan,
// which is the exact pre-index behavior.
function getCachedSessions() {
  if (isDbUnavailable() || !isIndexReady()) return getAllSessions()
  return listSessions()
}

// Risk-typed approvals: join the live in-memory PTY approval state onto a
// stateless JSONL-derived session summary. riskLevel is the WORST pending
// classification (null when none pending / not classified — never fabricated),
// and an unresolved approval forces needsInput — a blocked tool call IS
// "waiting on you" even though the file-based heuristic can't see it.
function withLiveApprovalRisk(summary) {
  const status = getQueryStatus(summary.sessionId) || { pendingApprovals: [] }
  const pending = Array.isArray(status.pendingApprovals) ? status.pendingApprovals : []
  const worst = worstClassification(pending.map((a) => a.riskLevel).filter(Boolean))
  const worstApproval = worst ? pending.find((a) => a.riskLevel === worst) : null
  return {
    ...summary,
    riskLevel: worst ?? null,
    riskDescription: worstApproval?.riskDescription ?? null,
    pendingApprovalCount: pending.length,
    needsInput: Boolean(summary.needsInput) || pending.length > 0,
    // Phase S1: a session in the Oversight repo is building Oversight itself.
    meta: isMetaSession(summary.cwd),
  }
}

/**
 * @openapi
 * /api/sessions:
 *   get:
 *     summary: List discovered agent sessions (enriched with display names + live-approval risk).
 *     description: >-
 *       Each summary carries riskLevel/riskDescription — the WORST pending
 *       tool-approval classification (SAFE_READONLY | UNKNOWN | REQUIRES_REVIEW |
 *       CODE_EXECUTION | DESTRUCTIVE) or null when nothing is pending —
 *       plus pendingApprovalCount; an unresolved approval forces needsInput true.
 *     tags: [Sessions]
 *     responses:
 *       200:
 *         description: Array of sessions.
 */
router.get('/', async (req, res, next) => {
  try {
    const sessions = getCachedSessions()
    const names = await loadSessionNames()
    const enriched = sessions.map((s) =>
      withLiveApprovalRisk({
        ...s,
        displayName: names[s.sessionId] || null,
      }),
    )
    res.json(enriched)
  } catch (err) {
    next(err)
  }
})

/**
 * @openapi
 * /api/sessions/{sessionId}:
 *   get:
 *     summary: Fetch a single session by id.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: The session.
 *       404:
 *         description: Session not found.
 */
router.get('/:sessionId', async (req, res) => {
  const session = getSessionById(req.params.sessionId)
  if (!session) return res.status(404).json({ error: 'Session not found' })
  const names = await loadSessionNames()
  res.json(withLiveApprovalRisk({ ...session, displayName: names[session.sessionId] || null }))
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
  // Harden the slash-command line before it is sent to the running agent: a
  // single token (colons allowed for namespaced skills) + a length-capped args
  // string, so neither field can inject extra instructions into the prompt.
  if (!validateSlashCommand(skill, skillArgs, res)) return

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

/**
 * @openapi
 * /api/sessions/new:
 *   post:
 *     summary: Spawn a new agent session (the front-door spawn path).
 *     tags: [Sessions]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [cwd, prompt]
 *             properties:
 *               cwd: { type: string }
 *               prompt: { type: string }
 *               name: { type: string }
 *               worktree: { type: boolean }
 *               options: { type: object }
 *     responses:
 *       200:
 *         description: Session spawned.
 *       400:
 *         description: Missing or invalid prompt/cwd.
 */
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
  const baseArgs = ['-p', prompt.trim(), '--output-format', 'stream-json']
  if (name != null) {
    if (typeof name !== 'string' || name.trim().length > MAX_DISPLAY_NAME_LENGTH) {
      return res.status(400).json({
        error: `name too long (max ${MAX_DISPLAY_NAME_LENGTH} characters)`,
      })
    }
    if (name.trim()) baseArgs.push('--name', name.trim())
  }
  if (worktree === true) {
    baseArgs.push('--worktree')
  }
  const args = buildCliArgs(baseArgs, options)

  // Race: file-watcher ack vs CLI completion vs 15s deadline (inside awaitNewSession).
  //
  // (1) awaitNewSession fires when the JSONL appears on disk → 202 streaming ack
  // (2) runClaude resolves before any ack → 201 legacy shape (rare, likely an error-exit)
  // (3) awaitNewSession times out (15 s, no JSONL seen) → 504 + kill child

  const { promise: cliPromise, cancel: cancelCli } = runClaudeCancellable({
    args,
    cwd,
    timeoutMs: 300_000,
  })

  // AUDIT (cockpit sole writer): the front-door "spawn a new agent" path. Recorded
  // once the CLI subprocess is committed (the agent is launched) — the sessionId is
  // not known yet (the watcher acks it later), so it is null here. Fire-and-forget
  // so the audit append never affects the spawn race below. This is the front-door
  // counterpart to the Fleet child-spawn audit in fleet/fleet-runner.js.
  recordAuditEventSafe({
    eventType: 'spawn',
    source: 'cockpit',
    sessionId: null,
    // v9 controlState: the policies this agent was LAUNCHED under. The operator
    // initiated the spawn (decisionMaker human); permissionMode is recorded only
    // when the request carried one explicitly — never fabricated.
    controlState: {
      decisionMaker: 'human',
      permissionMode: (options && options.permissionMode) || null,
      policiesInForce: worktree === true ? ['worktree-isolation'] : [],
    },
    payload: {
      kind: 'session_new',
      cwd,
      worktree: worktree === true,
      named: !!(name && name.trim()),
    },
  })

  // Race: file-watcher ack vs CLI completion vs 15s deadline.
  //
  // To prevent Node from ever seeing an unhandledRejection on cliPromise,
  // we convert it to an always-resolving tagged promise immediately. The
  // rejection is preserved in the tag so the try/catch below can re-raise it.
  const taggedCli = cliPromise.then(
    (v) => ({ _tag: 'cli', value: v }),
    (err) => ({ _tag: 'cli_err', error: err }),
  )
  const taggedAck = awaitNewSession(cwd, { timeoutMs: 15_000 })
    .then((id) => ({ _tag: 'ack', sessionId: id }))
    .catch((err) => ({ _tag: 'timeout', error: err }))

  const winner = await Promise.race([taggedCli, taggedAck])

  if (winner._tag === 'cli_err') {
    // CLI rejected before ack — keep existing 503 path
    const err = winner.error
    logger.warn(
      {
        detail: err.message,
        stderr: truncateForLog(err.stderrOutput),
        stdout: truncateForLog(err.stdoutOutput),
      },
      'session_create_failed',
    )
    return res.status(503).json({
      error: 'session_create_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
      stdout: err.stdoutOutput || null,
    })
  }

  if (winner._tag === 'ack') {
    // (1) File-watcher fired first — ack immediately, let CLI keep running in bg
    const pendingSessionId = winner.sessionId
    // taggedCli already has the only .then on cliPromise, so cliPromise itself
    // is already fully handled. Log any background failure via taggedCli.
    taggedCli.then((t) => {
      if (t._tag === 'cli_err') {
        logger.warn(
          {
            pendingSessionId,
            detail: t.error.message,
            stderr: truncateForLog(t.error.stderrOutput),
            stdout: truncateForLog(t.error.stdoutOutput),
          },
          'cli_failed_after_ack',
        )
      }
    })
    return res.status(202).json({ ok: true, pendingSessionId, status: 'streaming' })
  }

  if (winner._tag === 'cli') {
    // (2) CLI completed before file-watcher (probably fast error exit or instant success)
    const { stdout, stderr } = winner.value
    const result = parseStreamJsonStdout(stdout)
    return res.status(201).json({ ok: true, result, stderr: stderr || undefined })
  }

  // (3) Timeout — kill the child and return 504
  cancelCli()
  const timeoutErr = winner.error
  logger.warn(
    {
      detail: timeoutErr.message,
    },
    'session_create_timeout',
  )
  return res.status(504).json({
    error: 'timeout_waiting_for_session',
    detail: timeoutErr.message,
  })
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
      [
        '--resume',
        sessionId,
        '--fork-session',
        '-p',
        prompt.trim(),
        '--output-format',
        'stream-json',
      ],
      options,
    )

    const { stdout, stderr } = await runClaude({
      args,
      cwd: session.cwd || undefined,
      timeoutMs: 120_000,
    })

    const result = parseStreamJsonStdout(stdout)

    res.status(201).json({ ok: true, result, stderr: stderr || undefined })
  } catch (err) {
    logger.warn(
      {
        detail: err.message,
        stderr: truncateForLog(err.stderrOutput),
        stdout: truncateForLog(err.stdoutOutput),
      },
      'fork_failed',
    )
    res.status(503).json({
      error: 'fork_failed',
      detail: err.message,
      stderr: err.stderrOutput || null,
      stdout: err.stdoutOutput || null,
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
  const trimmed = name.trim()
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH) {
    return res.status(400).json({
      error: `name too long (max ${MAX_DISPLAY_NAME_LENGTH} characters)`,
    })
  }

  const names = await loadSessionNames()
  names[sessionId] = trimmed
  await saveSessionNames(names)

  // Tell the dashboard to refresh its session list so the new name
  // shows up immediately. The session_update event is the existing
  // signal the client uses to bump sessionsVersion + refetch.
  emit('session_update', { sessionId, ts: Date.now(), reason: 'name_changed' })

  res.json({ ok: true, sessionId, displayName: trimmed })
})

// Clear a custom display name and fall back to the auto-generated slug.
// Without this endpoint there was no way to undo a rename through the
// dashboard — once set, the custom name was permanent.
router.delete('/:sessionId/name', async (req, res) => {
  const { sessionId } = req.params
  const names = await loadSessionNames()
  if (names[sessionId] === undefined) {
    return res.status(404).json({ error: 'no custom display name set' })
  }
  delete names[sessionId]
  await saveSessionNames(names)
  emit('session_update', { sessionId, ts: Date.now(), reason: 'name_cleared' })
  res.json({ ok: true, sessionId, displayName: null })
})

// ──────────────────────────────────────────────────────────────────────────────
// SDK query control endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * @openapi
 * /api/sessions/{sessionId}/tool-approval:
 *   post:
 *     summary: Resolve a paused tool approval (allow or deny) for a session.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [approvalId, decision]
 *             properties:
 *               approvalId: { type: string }
 *               decision: { type: string, enum: [allow, deny] }
 *               message: { type: string }
 *     responses:
 *       200:
 *         description: Approval resolved.
 *       400:
 *         description: Missing approvalId or invalid decision.
 *       404:
 *         description: Approval not found or already resolved.
 */
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

  // Multi-seat team-lead mode (Sprint 2-b): when several leads share one cockpit,
  // the X-Oversight-Seat header names the lead who resolved this approval. Null
  // when unset (the single-operator default) — never fabricated.
  const seat = seatFromHeaders(req.headers)

  // AUDIT (cockpit sole writer): a human tool-approval decision is the canonical
  // 'approval' event. Recorded only AFTER it was actually resolved (so a 404 writes
  // nothing). source 'cockpit' — the dashboard resolved it via the in-memory SDK
  // resolver. Fire-and-forget so the audit append never fails the decision.
  recordAuditEventSafe({
    eventType: 'approval',
    source: 'cockpit',
    sessionId,
    subjectId: approvalId,
    // The operator identity behind the decision — the seat that resolved it.
    actor: seat,
    decision: decision === 'allow' ? 'approved' : 'denied',
    outcome: 'succeeded',
    // v9 controlState: the SDK tool approval is a HARD gate — the tool call was
    // blocked until this human decision resolved it. resolveApproval returns the
    // approval itself, so the decision's risk classification (when one was
    // computed at detection time) rides the audit record — never fabricated.
    controlState: {
      gateType: 'hard',
      decisionMaker: 'human',
      policiesInForce: ['tool-approval-gate'],
    },
    payload: {
      kind: 'tool_approval',
      riskLevel: (typeof resolved === 'object' && resolved?.riskLevel) || null,
    },
  })

  // Echo the resolving seat so a multi-seat client can show who acted.
  res.json({ ok: true, seat })
})

/**
 * @openapi
 * /api/sessions/{sessionId}/cancel:
 *   post:
 *     summary: Cancel the active query for a session.
 *     tags: [Sessions]
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Query cancelled.
 *       404:
 *         description: No active query for this session.
 */
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
