vi.mock('../../parsers/sessions.js', () => ({
  getAllSessions: vi.fn().mockReturnValue([]),
  getSessionById: vi.fn().mockReturnValue(null),
}))
vi.mock('../../parsers/messages.js', () => ({
  getSessionMessages: vi.fn().mockReturnValue(null),
}))
vi.mock('../../intelligence/cache.js', () => ({
  getCached: vi.fn().mockReturnValue(null),
  getInFlight: vi.fn().mockReturnValue(null),
}))
vi.mock('../../intelligence/triggers.js', () => ({
  runAnalysis: vi.fn().mockResolvedValue({ summary: 'ok' }),
}))
vi.mock('fs', () => ({
  default: {
    mkdirSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
  },
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
  readFileSync: vi.fn(() => '{}'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => true),
}))
vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn().mockResolvedValue({ stdout: '{"result":"ok"}', stderr: '', exitCode: 0 }),
  runClaudeCancellable: vi.fn().mockImplementation(() => {
    const promise = Promise.resolve({ stdout: '{"result":"ok"}', stderr: '', exitCode: 0 })
    return { promise, cancel: vi.fn() }
  }),
}))
vi.mock('../../lib/pending-session.js', () => ({
  awaitNewSession: vi.fn().mockResolvedValue('pending-session-id'),
}))
vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
  onEvent: vi.fn(() => vi.fn()),
}))
vi.mock('multer', () => {
  const multerInstance = {
    single: () => (req, _res, next) => {
      if (req.headers['x-test-file']) {
        req.file = {
          path: 'C:\\tmp\\oversight-uploads\\1234-abcdef.png',
          originalname: 'screenshot.png',
          mimetype: 'image/png',
          size: 1024,
        }
      }
      next()
    },
  }
  const fn = () => multerInstance
  fn.diskStorage = () => ({})
  return { default: fn }
})
vi.mock('../../pty-session.js', () => ({
  startQuery: vi.fn().mockResolvedValue({ ok: true, streaming: true }),
  spawnNewSession: vi
    .fn()
    .mockResolvedValue({ ok: true, sessionId: 'new-pty-123', streaming: true }),
  isQueryActive: vi.fn().mockReturnValue(false),
  getQueryStatus: vi.fn().mockReturnValue({ active: false, pendingApprovals: [] }),
  resolveApproval: vi.fn().mockReturnValue(true),
  cancelQuery: vi.fn().mockReturnValue(true),
  VALID_PERMISSION_MODES: new Set([
    'plan',
    'auto',
    'default',
    'acceptEdits',
    'dontAsk',
    'bypassPermissions',
  ]),
  VALID_MODEL_SHORTCUTS: new Set(['sonnet', 'opus', 'haiku']),
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import express from 'express'
import request from 'supertest'
import fs from 'fs'
import { getAllSessions, getSessionById } from '../../parsers/sessions.js'
import { getSessionMessages } from '../../parsers/messages.js'
import { runClaude, runClaudeCancellable } from '../../claude-cli.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import {
  startQuery,
  spawnNewSession,
  isQueryActive,
  getQueryStatus,
  resolveApproval,
  cancelQuery,
} from '../../pty-session.js'
import { onEvent } from '../../sse.js'
import { logger } from '../../lib/logger.js'
import { router, _resetSessionsCache, truncateForLog } from '../../routes/sessions.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
  // The GET / handler memoizes getAllSessions() with a short TTL; reset
  // between tests so a prior test's mock return value doesn't leak.
  _resetSessionsCache()
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns getAllSessions() result with displayName', async () => {
    const sessions = [{ id: 'abc', messages: [] }]
    getAllSessions.mockReturnValue(sessions)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'abc', messages: [], displayName: null }])
  })

  it('returns empty array when no sessions', async () => {
    getAllSessions.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([])
  })
})

// ─── GET /:sessionId ─────────────────────────────────────────────────────────

describe('GET /:sessionId', () => {
  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).get('/nonexistent-session')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/session not found/i)
  })

  it('200 with session data when found', async () => {
    const session = { id: 'abc123', messages: [], active: false }
    getSessionById.mockReturnValue(session)
    const res = await request(app).get('/abc123')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...session, displayName: null })
  })
})

// ─── GET /:sessionId/messages ─────────────────────────────────────────────────

describe('GET /:sessionId/messages', () => {
  it('404 when session not found', async () => {
    getSessionMessages.mockReturnValue(null)
    const res = await request(app).get('/nonexistent-session/messages')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/session not found/i)
  })

  it('200 with messages when found', async () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi!' },
    ]
    getSessionMessages.mockReturnValue(messages)
    const res = await request(app).get('/abc123/messages')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(messages)
  })
})

// ─── POST /:sessionId/message ───────────────────────────────────────────────

describe('POST /:sessionId/message', () => {
  it('400 when message is missing', async () => {
    const res = await request(app).post('/abc123/message').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/message is required/i)
  })

  it('400 when message is empty string', async () => {
    const res = await request(app).post('/abc123/message').send({ message: '   ' })
    expect(res.status).toBe(400)
  })

  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(404)
  })

  it('202 when message sent via PTY', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.streaming).toBe(true)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'abc123',
        prompt: 'hello',
        cwd: '/tmp',
      }),
    )
  })

  it('409 when query already active', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    isQueryActive.mockReturnValue(true)
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(409)
  })

  it('passes sdkOptions with permissionMode to startQuery', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app)
      .post('/abc123/message')
      .send({
        message: 'hello',
        options: { permissionMode: 'plan', model: 'sonnet' },
      })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sdkOptions: { permissionMode: 'plan', model: 'sonnet' },
      }),
    )
  })

  it('503 when startQuery rejects', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockRejectedValue(new Error('PTY spawn failed'))
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('send_failed')
    expect(res.body.detail).toBe('PTY spawn failed')
  })

  it('400 when options is malformed JSON string', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    // Simulate multipart form-data where options arrives as a string
    const res = await request(app).post('/abc123/message').send({
      message: 'hello',
      options: '{bad json',
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid options/i)
  })

  it('passes valid JSON options string when parsed', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/message').send({
      message: 'hello',
      options: '{"permissionMode":"auto"}',
    })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sdkOptions: { permissionMode: 'auto' },
      }),
    )
  })
})

// ─── POST /:sessionId/skill ─────────────────────────────────────────────────

describe('POST /:sessionId/skill', () => {
  it('400 when skill is missing', async () => {
    const res = await request(app).post('/abc123/skill').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/skill is required/i)
  })

  it('404 when session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(404)
  })

  it('202 when skill invoked via PTY', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'abc123',
        prompt: '/commit',
        cwd: '/tmp',
      }),
    )
  })

  it('sends skill with args via PTY', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit', args: '-m "fix"' })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '/commit -m "fix"',
      }),
    )
  })

  it('409 when query already active for skill', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    isQueryActive.mockReturnValue(true)
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(409)
  })

  it('503 when startQuery rejects for skill', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockRejectedValue(new Error('PTY busy'))
    const res = await request(app).post('/abc123/skill').send({ skill: 'commit' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('skill_failed')
  })

  it('passes sdkOptions to startQuery for skill', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app)
      .post('/abc123/skill')
      .send({
        skill: 'commit',
        options: { permissionMode: 'auto' },
      })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sdkOptions: { permissionMode: 'auto' },
      }),
    )
  })
})

// ─── POST /new ──────────────────────────────────────────────────────────────
// The route now races runClaudeCancellable vs awaitNewSession.
// Default mock setup: awaitNewSession resolves immediately (→ 202 ack).
// Individual tests override these mocks to drive each branch.

/**
 * Create a rejected promise with a noop .catch attached so that Vitest's
 * unhandledRejection hook doesn't see it as unhandled. The route will still
 * observe the rejection through its own `taggedCli = cliPromise.then(ok, err)`
 * chain because .catch() is just syntactic sugar for .then(undefined, onRejected),
 * and multiple .then handlers on the same promise are all notified.
 */
function rejectedCliPromise(err) {
  const p = Promise.reject(err)
  p.catch(() => {}) // suppress unhandledRejection at Vitest process level
  return p
}

describe('POST /new', () => {
  it('400 when prompt is missing', async () => {
    const res = await request(app).post('/new').send({ cwd: '/tmp' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/prompt is required/i)
  })

  it('400 when cwd is missing', async () => {
    const res = await request(app).post('/new').send({ prompt: 'hello' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/cwd is required/i)
  })

  // Scenario 1: awaitNewSession resolves → 202 with pendingSessionId
  // (The normal fast path — file watcher fires before CLI completes)
  it('202 with pendingSessionId when awaitNewSession resolves first', async () => {
    // awaitNewSession resolves immediately (default mock)
    // CLI promise stays pending so ack wins the race
    let resolveCli
    runClaudeCancellable.mockReturnValue({
      promise: new Promise((r) => {
        resolveCli = r
      }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('new-sess-ack-123')

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.pendingSessionId).toBe('new-sess-ack-123')
    expect(res.body.status).toBe('streaming')

    // Resolve CLI now (background) — shouldn't change response (already sent)
    resolveCli({ stdout: '{}', stderr: '', exitCode: 0 })
  })

  // Scenario 2: runClaude resolves first (CLI completes before any new_session event) → 201 legacy
  // (Rare in production — typically a fast error-exit or a very quick interaction)
  it('201 legacy shape when CLI completes before awaitNewSession', async () => {
    // CLI resolves immediately, awaitNewSession never resolves (times out much later)
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"session_id":"new-123"}', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(res.body.result).toEqual({ session_id: 'new-123' })
    expect(runClaudeCancellable).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/tmp' }))
  })

  // Scenario 3: awaitNewSession times out → 504
  it('504 when awaitNewSession times out and CLI is still pending', async () => {
    const cancelMock = vi.fn()
    runClaudeCancellable.mockReturnValue({
      promise: new Promise(() => {}), // never resolves
      cancel: cancelMock,
    })
    awaitNewSession.mockRejectedValue(new Error('timeout_waiting_for_session'))

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(504)
    expect(res.body.error).toBe('timeout_waiting_for_session')
    expect(cancelMock).toHaveBeenCalled()
  })

  // Scenario 4: runClaude rejects before ack → 503
  it('503 when CLI rejects before ack', async () => {
    const err = new Error('claude CLI exited with code=1 signal=null')
    err.stderrOutput = 'error: something broke\n'
    err.stdoutOutput = ''
    runClaudeCancellable.mockReturnValue({
      promise: rejectedCliPromise(err),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('session_create_failed')
    expect(res.body.detail).toMatch(/code=1/)
    expect(res.body.stderr).toBe('error: something broke\n')
  })

  // Scenario 5: CLI rejects AFTER ack → logs warn, doesn't affect already-sent response
  it('logs warn when CLI fails after 202 ack, does not re-raise', async () => {
    let rejectCli
    const cliPromise = new Promise((_resolve, reject) => {
      rejectCli = reject
    })
    // Suppress the unhandled rejection that would fire when we reject below —
    // the route converts cliPromise to taggedCli (which catches it), but to
    // avoid a race between test rejection and route setup, attach a noop here.
    cliPromise.catch(() => {})
    runClaudeCancellable.mockReturnValue({
      promise: cliPromise,
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('acked-session-id')

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hello' })
    expect(res.status).toBe(202)
    expect(res.body.pendingSessionId).toBe('acked-session-id')

    // Now reject the CLI after the response was already sent
    const bgErr = new Error('claude CLI exited with code=1 signal=null')
    bgErr.stderrOutput = 'bg failure'
    rejectCli(bgErr)

    // Give the taggedCli.then handler a tick to run
    await new Promise((r) => setTimeout(r, 10))

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ pendingSessionId: 'acked-session-id' }),
      'cli_failed_after_ack',
    )
  })

  // Scenario 6: does NOT forward --effort (preserved assertion)
  it('does NOT forward --effort to the claude CLI (SDK-only option)', async () => {
    // awaitNewSession never resolves so CLI path wins (CLI resolves immediately)
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"session_id":"new-789"}', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app)
      .post('/new')
      .send({ cwd: '/tmp', prompt: 'hello', options: { effort: 'low' } })
    expect(res.status).toBe(201)
    const argv = runClaudeCancellable.mock.calls.at(-1)[0].args
    expect(argv).not.toContain('--effort')
    expect(argv).not.toContain('low')
  })

  // Scenario 7: 503 carries stderr (preserved assertion)
  it('503 error response includes stderr captured from the CLI', async () => {
    const err = new Error('claude CLI exited with code=1 signal=null')
    err.stderrOutput = 'error: unknown option --effort\n'
    runClaudeCancellable.mockReturnValue({
      promise: rejectedCliPromise(err),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {}))

    const res = await request(app)
      .post('/new')
      .send({ cwd: '/tmp', prompt: 'hello', options: { effort: 'low' } })
    expect(res.status).toBe(503)
    expect(res.body.error).toBe('session_create_failed')
    expect(res.body.detail).toMatch(/code=1/)
    expect(res.body.stderr).toBe('error: unknown option --effort\n')
  })

  // Scenario 8: 503 carries stdout (preserved assertion)
  it('503 error response also includes stdout (for quota-style JSON errors)', async () => {
    const err = new Error('claude CLI exited with code=1 signal=null')
    err.stderrOutput = ''
    err.stdoutOutput = '{"is_error":true,"api_error_status":429,"result":"You\'ve hit your limit"}'
    runClaudeCancellable.mockReturnValue({
      promise: rejectedCliPromise(err),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {}))

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hi' })
    expect(res.status).toBe(503)
    expect(res.body.stdout).toContain('api_error_status')
    expect(res.body.stdout).toContain("You've hit your limit")
  })

  it('truncates oversized stdout/stderr before handing them to the logger but not in the HTTP body', async () => {
    const big = 'x'.repeat(10_000)
    const err = new Error('claude CLI exited with code=1 signal=null')
    err.stderrOutput = big
    err.stdoutOutput = big
    runClaudeCancellable.mockReturnValue({
      promise: rejectedCliPromise(err),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {}))

    const res = await request(app).post('/new').send({ cwd: '/tmp', prompt: 'hi' })
    expect(res.status).toBe(503)
    // Dashboard still gets the full payload so users can inspect the whole error.
    expect(res.body.stderr).toBe(big)
    expect(res.body.stdout).toBe(big)
    // Logger must not receive the full 10KB payload — it should be truncated.
    expect(logger.warn).toHaveBeenCalled()
    const [logPayload] = logger.warn.mock.calls.at(-1)
    expect(logPayload.stderr.length).toBeLessThan(big.length)
    expect(logPayload.stderr).toMatch(/\[truncated \d+ bytes\]/)
    expect(logPayload.stdout).toMatch(/\[truncated \d+ bytes\]/)
  })

  it('includes --worktree in CLI args when worktree flag is set', async () => {
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"session":"new123"}', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {}))

    const res = await request(app)
      .post('/new')
      .send({ cwd: '/tmp', prompt: 'hello', worktree: true })
    expect(res.status).toBe(201)
    expect(res.body.ok).toBe(true)
    expect(runClaudeCancellable).toHaveBeenCalledWith(
      expect.objectContaining({
        args: expect.arrayContaining(['-p', 'hello', '--worktree']),
      }),
    )
  })
})

// ─── truncateForLog helper ──────────────────────────────────────────────────

describe('truncateForLog', () => {
  it('returns null for null/undefined/empty', () => {
    expect(truncateForLog(null)).toBe(null)
    expect(truncateForLog(undefined)).toBe(null)
    expect(truncateForLog('')).toBe(null)
  })

  it('returns the original string when below the cap', () => {
    expect(truncateForLog('short')).toBe('short')
  })

  it('truncates and appends the byte-count marker when above the cap', () => {
    const big = 'y'.repeat(5000)
    const out = truncateForLog(big)
    expect(out).not.toBe(big)
    expect(out.length).toBeLessThan(big.length)
    expect(out).toMatch(/\[truncated 2952 bytes\]/) // 5000 - 2048 = 2952
  })
})

// ─── POST /:sessionId/tool-approval ─────────────────────────────────────────

describe('POST /:sessionId/tool-approval', () => {
  it('400 when approvalId missing', async () => {
    const res = await request(app).post('/abc123/tool-approval').send({ decision: 'allow' })
    expect(res.status).toBe(400)
  })

  it('400 when decision invalid', async () => {
    const res = await request(app)
      .post('/abc123/tool-approval')
      .send({ approvalId: 'x', decision: 'maybe' })
    expect(res.status).toBe(400)
  })

  it('200 when approval resolved', async () => {
    resolveApproval.mockReturnValue(true)
    const res = await request(app)
      .post('/abc123/tool-approval')
      .send({ approvalId: 'x', decision: 'allow' })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('404 when approval not found', async () => {
    resolveApproval.mockReturnValue(false)
    const res = await request(app)
      .post('/abc123/tool-approval')
      .send({ approvalId: 'x', decision: 'deny' })
    expect(res.status).toBe(404)
  })
})

// ─── POST /:sessionId/cancel ────────────────────────────────────────────────

describe('POST /:sessionId/cancel', () => {
  it('200 when query cancelled', async () => {
    cancelQuery.mockReturnValue(true)
    const res = await request(app).post('/abc123/cancel')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  it('404 when no active query', async () => {
    cancelQuery.mockReturnValue(false)
    const res = await request(app).post('/abc123/cancel')
    expect(res.status).toBe(404)
  })
})

// ─── GET /:sessionId/query-status ───────────────────────────────────────────

describe('GET /:sessionId/query-status', () => {
  it('returns query status', async () => {
    getQueryStatus.mockReturnValue({
      active: true,
      pendingApprovals: [{ approvalId: 'a1', toolName: 'Bash' }],
    })
    const res = await request(app).get('/abc123/query-status')
    expect(res.status).toBe(200)
    expect(res.body.active).toBe(true)
    expect(res.body.pendingApprovals).toHaveLength(1)
  })
})

// ─── POST /:sessionId/message — image upload ────────────────────────────────

describe('POST /:sessionId/message — image upload', () => {
  it('appends image path to prompt when file uploaded', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'check this' })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          '[User attached an image. View it using the Read tool at: C:/tmp/oversight-uploads/1234-abcdef.png]',
        ),
      }),
    )
  })

  it('sends plain prompt without image reference when no file', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/message').send({ message: 'hello' })
    expect(res.status).toBe(202)
    const calledPrompt = startQuery.mock.calls[0][0].prompt
    expect(calledPrompt).not.toContain('[User attached an image')
  })

  it('registers cleanup listener after successful startQuery with image', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'check this' })
    expect(onEvent).toHaveBeenCalled()
  })

  it('cleans up file on 400 malformed options JSON', async () => {
    const res = await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'hello', options: '{bad' })
    expect(res.status).toBe(400)
    expect(fs.unlinkSync).toHaveBeenCalledWith('C:\\tmp\\oversight-uploads\\1234-abcdef.png')
  })

  it('cleans up file on 400 missing message', async () => {
    const res = await request(app).post('/abc123/message').set('x-test-file', '1').send({})
    expect(res.status).toBe(400)
    expect(fs.unlinkSync).toHaveBeenCalledWith('C:\\tmp\\oversight-uploads\\1234-abcdef.png')
  })

  it('cleans up file on 404 session not found', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'hello' })
    expect(res.status).toBe(404)
    expect(fs.unlinkSync).toHaveBeenCalledWith('C:\\tmp\\oversight-uploads\\1234-abcdef.png')
  })

  it('cleans up file on 409 active query', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    isQueryActive.mockReturnValue(true)
    const res = await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'hello' })
    expect(res.status).toBe(409)
    expect(fs.unlinkSync).toHaveBeenCalledWith('C:\\tmp\\oversight-uploads\\1234-abcdef.png')
  })

  it('cleans up file on 503 startQuery failure', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockRejectedValue(new Error('PTY spawn failed'))
    const res = await request(app)
      .post('/abc123/message')
      .set('x-test-file', '1')
      .send({ message: 'hello' })
    expect(res.status).toBe(503)
    expect(fs.unlinkSync).toHaveBeenCalledWith('C:\\tmp\\oversight-uploads\\1234-abcdef.png')
  })

  it('handles undefined options gracefully', async () => {
    getSessionById.mockReturnValue({ sessionId: 'abc123', cwd: '/tmp' })
    startQuery.mockResolvedValue({ ok: true, streaming: true })
    const res = await request(app).post('/abc123/message').send({ message: 'hi' })
    expect(res.status).toBe(202)
    expect(startQuery).toHaveBeenCalledWith(expect.objectContaining({ sdkOptions: {} }))
  })
})

// ─── GET /:sessionId/export ────────────────────────────────────────────────

describe('GET /:sessionId/export', () => {
  it('returns markdown by default', async () => {
    getSessionById.mockReturnValue({
      sessionId: 'abc123',
      slug: 'test-session',
      model: 'claude-sonnet-4-6',
      cwd: '/tmp',
      firstTimestamp: '2025-06-01T00:00:00Z',
    })
    getSessionMessages.mockReturnValue({
      sessionId: 'abc123',
      messages: [{ type: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
    })
    const res = await request(app).get('/abc123/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/markdown/)
    expect(res.headers['content-disposition']).toContain('abc123.md')
    expect(res.text).toContain('# Session: test-session')
    expect(res.text).toContain('hello')
  })

  it('returns JSON when format=json', async () => {
    getSessionById.mockReturnValue({
      sessionId: 'abc123',
      slug: 'test-session',
      model: 'claude-sonnet-4-6',
      cwd: '/tmp',
      firstTimestamp: '2025-06-01T00:00:00Z',
    })
    getSessionMessages.mockReturnValue({
      sessionId: 'abc123',
      messages: [{ type: 'user', blocks: [{ type: 'text', text: 'hello' }] }],
    })
    const res = await request(app).get('/abc123/export?format=json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.headers['content-disposition']).toContain('abc123.json')
    const parsed = JSON.parse(res.text)
    expect(parsed.sessionId).toBe('abc123')
    expect(parsed.messages).toHaveLength(1)
  })

  it('returns 404 for unknown session', async () => {
    getSessionById.mockReturnValue(null)
    const res = await request(app).get('/nonexistent-session/export')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/session not found/i)
  })
})
