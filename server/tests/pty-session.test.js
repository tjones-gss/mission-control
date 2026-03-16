// ─── Mock setup (must be at top, before imports) ──────────────────────────────

// Each test gets a fresh term — rebuilt in beforeEach
let mockTerm
// Callbacks captured when term.onData / term.onExit / term.on are called
let capturedOnData
let capturedOnExit
let capturedOn

function createMockTerm() {
  capturedOnData = null
  capturedOnExit = null
  capturedOn = {}

  const term = {
    write: vi.fn(),
    kill: vi.fn(),
    on: vi.fn((event, handler) => {
      if (!capturedOn[event]) capturedOn[event] = []
      capturedOn[event].push(handler)
    }),
    removeListener: vi.fn((event, handler) => {
      if (capturedOn[event]) {
        capturedOn[event] = capturedOn[event].filter(h => h !== handler)
      }
    }),
    onData: vi.fn(handler => { capturedOnData = handler }),
    onExit: vi.fn(handler => { capturedOnExit = handler }),
  }
  return term
}

vi.mock('node-pty', () => ({
  spawn: vi.fn(),
}))

vi.mock('../sse.js', () => ({ emit: vi.fn(), onEvent: vi.fn(() => vi.fn()) }))

// Mock Node's crypto so randomUUID returns a predictable value.
// Using a literal string here because vi.mock factories are hoisted before
// variable declarations — the APPROVAL_UUID const below must match this value.
vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    default: {
      ...actual.default,
      randomUUID: vi.fn(() => 'approval-uuid-1234'),
    },
    randomUUID: vi.fn(() => 'approval-uuid-1234'),
  }
})

// ─── Imports ──────────────────────────────────────────────────────────────────

import * as pty from 'node-pty'
import { emit } from '../sse.js'
import {
  startQuery,
  isQueryActive,
  getQueryStatus,
  resolveApproval,
  cancelQuery,
  VALID_PERMISSION_MODES,
  VALID_MODEL_SHORTCUTS,
} from '../pty-session.js'

// ─── Test ID counter — each test uses a unique session so module state doesn't leak ──

let testIdCounter = 0
function uniqueSession() {
  return `test-session-${++testIdCounter}`
}

// UUID returned for approval IDs — must match the vi.mock('crypto') above
const APPROVAL_UUID = 'approval-uuid-1234'

// ─── Setup / Teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers()
  mockTerm = createMockTerm()
  vi.mocked(pty.spawn).mockReturnValue(mockTerm)
  vi.mocked(emit).mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── Helper: drive a session to "ready" state and return the resolved startQuery ──

async function bootSession(sessionId, opts = {}) {
  const promise = startQuery({
    sessionId,
    prompt: opts.prompt ?? 'hello world',
    cwd: opts.cwd ?? '/tmp',
    sdkOptions: opts.sdkOptions,
  })

  // Yield so startQuery can register .on('data') listeners inside waitForReady
  await Promise.resolve()

  // Fire data events that simulate CLI initialization output.
  // Phase 1: Trust prompt appears — waitForReady detects "trust" and sends Enter
  const trustData = '\x1b[?2004h\x1b[?1004hDo you trust this folder?'
  if (capturedOn['data'] && capturedOn['data'].length > 0) {
    capturedOn['data'].forEach(h => h(trustData))
  }
  await Promise.resolve()

  // Phase 2: After trust accepted, full UI loads with "Claude Code"
  const uiData = 'Claude Code v2.1.76'
  if (capturedOn['data'] && capturedOn['data'].length > 0) {
    capturedOn['data'].forEach(h => h(uiData))
  }

  // Advance past the 500ms post-detection pause in waitForReady
  vi.advanceTimersByTime(500)

  // Yield for the startQuery async flow (100ms delay between paste and Enter)
  await vi.advanceTimersByTimeAsync(100)

  return promise
}

// ─── VALID_PERMISSION_MODES / VALID_MODEL_SHORTCUTS exports ──────────────────

describe('exported constants', () => {
  it('VALID_PERMISSION_MODES contains expected values', () => {
    expect(VALID_PERMISSION_MODES.has('plan')).toBe(true)
    expect(VALID_PERMISSION_MODES.has('auto')).toBe(true)
    expect(VALID_PERMISSION_MODES.has('bypassPermissions')).toBe(true)
    expect(VALID_PERMISSION_MODES.has('invalid')).toBe(false)
  })

  it('VALID_MODEL_SHORTCUTS contains expected values', () => {
    expect(VALID_MODEL_SHORTCUTS.has('sonnet')).toBe(true)
    expect(VALID_MODEL_SHORTCUTS.has('opus')).toBe(true)
    expect(VALID_MODEL_SHORTCUTS.has('haiku')).toBe(true)
    expect(VALID_MODEL_SHORTCUTS.has('gpt4')).toBe(false)
  })
})

// ─── isQueryActive ────────────────────────────────────────────────────────────

describe('isQueryActive()', () => {
  it('returns false for unknown sessionId', () => {
    expect(isQueryActive('nonexistent')).toBe(false)
  })

  it('returns true while a query is running', async () => {
    const sid = uniqueSession()
    // Start but do not resolve yet — check busy during waitForReady
    const promise = startQuery({ sessionId: sid, prompt: 'hi', cwd: '/tmp' })
    await Promise.resolve()

    expect(isQueryActive(sid)).toBe(true)

    // Finish the boot so the session is cleaned up for the module
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('trust this folder'))
    await Promise.resolve()
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('Claude Code v2.1.76'))
    vi.advanceTimersByTime(500)
    await vi.advanceTimersByTimeAsync(100)
    await promise
  })
})

// ─── getQueryStatus ───────────────────────────────────────────────────────────

describe('getQueryStatus()', () => {
  it('returns inactive status for unknown session', () => {
    expect(getQueryStatus('unknown')).toEqual({ active: false, pendingApprovals: [] })
  })

  it('returns active=true with empty pendingApprovals right after startQuery', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    const status = getQueryStatus(sid)
    expect(status.active).toBe(true)
    expect(status.pendingApprovals).toEqual([])
  })

  it('includes approval data after an approval prompt arrives', async () => {
    const sid = uniqueSession()
    await bootSession(sid)

    capturedOnData('[Y/n] Do you want to allow this action?')

    const status = getQueryStatus(sid)
    expect(status.pendingApprovals).toHaveLength(1)
    expect(status.pendingApprovals[0]).toMatchObject({
      approvalId: APPROVAL_UUID,
      toolName: expect.any(String),
    })
  })
})

// ─── startQuery ───────────────────────────────────────────────────────────────

describe('startQuery()', () => {
  it('spawns PTY with --resume and sessionId', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    const expectedCmd = process.platform === 'win32' ? 'claude.exe' : 'claude'
    expect(pty.spawn).toHaveBeenCalledWith(
      expectedCmd,
      expect.arrayContaining(['--resume', sid]),
      expect.objectContaining({ cols: 200, rows: 50 }),
    )
  })

  it('passes cwd to pty.spawn', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { cwd: '/my/project' })
    const expectedCmd = process.platform === 'win32' ? 'claude.exe' : 'claude'
    expect(pty.spawn).toHaveBeenCalledWith(
      expectedCmd,
      expect.any(Array),
      expect.objectContaining({ cwd: '/my/project' }),
    )
  })

  it('rejects when a query is already active for the same session', async () => {
    const sid = uniqueSession()

    // First call — do NOT resolve yet
    const first = startQuery({ sessionId: sid, prompt: 'first', cwd: '/tmp' })
    await Promise.resolve()

    // Second call while first is still in waitForReady (busy=true)
    await expect(
      startQuery({ sessionId: sid, prompt: 'second', cwd: '/tmp' })
    ).rejects.toThrow('A query is already active for this session')

    // Clean up
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('trust this folder'))
    await Promise.resolve()
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('Claude Code v2.1.76'))
    vi.advanceTimersByTime(500)
    await vi.advanceTimersByTimeAsync(100)
    await first
  })

  it('writes prompt in bracketed paste mode after waitForReady completes', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { prompt: 'my prompt' })
    expect(mockTerm.write).toHaveBeenCalledWith('\x1b[200~my prompt\x1b[201~')
    expect(mockTerm.write).toHaveBeenCalledWith('\r')
  })

  it('emits sdk_message after writing prompt', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    expect(emit).toHaveBeenCalledWith(
      'sdk_message',
      expect.objectContaining({ sessionId: sid }),
    )
  })

  it('resolves with { ok: true, streaming: true }', async () => {
    const sid = uniqueSession()
    const result = await bootSession(sid)
    expect(result).toEqual({ ok: true, streaming: true })
  })

  it('ignores invalid permissionMode — not passed to PTY args', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { sdkOptions: { permissionMode: 'HACKED; rm -rf /' } })

    const spawnArgs = pty.spawn.mock.calls[pty.spawn.mock.calls.length - 1][1]
    expect(spawnArgs).not.toContain('--permission-mode')
    expect(spawnArgs).not.toContain('HACKED; rm -rf /')
  })

  it('passes valid permissionMode to PTY args', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { sdkOptions: { permissionMode: 'plan' } })

    const spawnArgs = pty.spawn.mock.calls[pty.spawn.mock.calls.length - 1][1]
    expect(spawnArgs).toContain('--permission-mode')
    expect(spawnArgs).toContain('plan')
  })

  it('ignores invalid model — not passed to PTY args', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { sdkOptions: { model: 'gpt-4-hacked' } })

    const spawnArgs = pty.spawn.mock.calls[pty.spawn.mock.calls.length - 1][1]
    expect(spawnArgs).not.toContain('--model')
  })

  it('accepts valid model shortcut (sonnet)', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { sdkOptions: { model: 'sonnet' } })

    const spawnArgs = pty.spawn.mock.calls[pty.spawn.mock.calls.length - 1][1]
    expect(spawnArgs).toContain('--model')
    expect(spawnArgs).toContain('sonnet')
  })

  it('accepts claude-* prefixed model names', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { sdkOptions: { model: 'claude-3-5-sonnet-20241022' } })

    const spawnArgs = pty.spawn.mock.calls[pty.spawn.mock.calls.length - 1][1]
    expect(spawnArgs).toContain('--model')
    expect(spawnArgs).toContain('claude-3-5-sonnet-20241022')
  })

  it('rejects when sessionId is null', async () => {
    await expect(
      startQuery({ sessionId: null, prompt: 'hi', cwd: '/tmp' })
    ).rejects.toThrow('sessionId is required')
  })

  it('rejects when sessionId is undefined', async () => {
    await expect(
      startQuery({ sessionId: undefined, prompt: 'hi', cwd: '/tmp' })
    ).rejects.toThrow('sessionId is required')
  })

  it('sanitizes control characters from prompt before writing to PTY', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { prompt: 'hello\x03world\x1b[Afoo' })
    // \x03 (Ctrl-C) and \x1b (ESC) should be stripped, wrapped in bracketed paste
    expect(mockTerm.write).toHaveBeenCalledWith('\x1b[200~helloworldfoo\x1b[201~')
  })

  it('preserves tabs and newlines in prompt (converted to \\r)', async () => {
    const sid = uniqueSession()
    await bootSession(sid, { prompt: 'line1\tindented' })
    expect(mockTerm.write).toHaveBeenCalledWith('\x1b[200~line1\tindented\x1b[201~')
  })

  it('throws when PTY crashes during waitForReady (exit before ready)', async () => {
    const sid = uniqueSession()
    const promise = startQuery({ sessionId: sid, prompt: 'hi', cwd: '/tmp' })
    await Promise.resolve()

    // Trigger exit event before silence timer fires — simulates PTY crash on init
    if (capturedOn['exit']) capturedOn['exit'].forEach(h => h())

    await expect(promise).rejects.toThrow()
  })
})

// ─── waitForReady — hard timeout fallback ─────────────────────────────────────

describe('waitForReady() hard timeout', () => {
  it('resolves after 15s even with no data', async () => {
    const sid = uniqueSession()
    // Do NOT fire any data events — rely on 15s hard timeout
    const promise = startQuery({ sessionId: sid, prompt: 'hi', cwd: '/tmp' })
    await Promise.resolve()

    vi.advanceTimersByTime(15000)
    // Advance past the 100ms delay between paste and Enter
    await vi.advanceTimersByTimeAsync(100)

    const result = await promise
    expect(result).toEqual({ ok: true, streaming: true })
    expect(mockTerm.write).toHaveBeenCalledWith('\x1b[200~hi\x1b[201~')
    expect(mockTerm.write).toHaveBeenCalledWith('\r')
  })
})

describe('waitForReady() trust prompt acceptance', () => {
  it('sends Enter when trust prompt detected', async () => {
    const sid = uniqueSession()
    const promise = startQuery({ sessionId: sid, prompt: 'hi', cwd: '/tmp' })
    await Promise.resolve()

    // Fire trust prompt data
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('Do you trust this folder?'))
    await Promise.resolve()

    // The trust prompt should trigger an Enter
    expect(mockTerm.write).toHaveBeenCalledWith('\r')

    // Now fire Claude Code UI
    if (capturedOn['data']) capturedOn['data'].forEach(h => h('Claude Code v2.1.76'))
    vi.advanceTimersByTime(500)
    await vi.advanceTimersByTimeAsync(100)
    await promise
  })
})

// ─── resolveApproval ─────────────────────────────────────────────────────────

describe('resolveApproval()', () => {
  let sid

  beforeEach(async () => {
    sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()
    // Trigger an approval prompt to register a pending approval
    capturedOnData('[Y/n] Do you want to allow this action?')
  })

  it('writes y\\r to PTY for allow decision', () => {
    resolveApproval(sid, APPROVAL_UUID, 'allow')
    expect(mockTerm.write).toHaveBeenCalledWith('y\r')
  })

  it('writes n\\r to PTY for deny decision', () => {
    resolveApproval(sid, APPROVAL_UUID, 'deny')
    expect(mockTerm.write).toHaveBeenCalledWith('n\r')
  })

  it('emits tool_approval_resolved', () => {
    resolveApproval(sid, APPROVAL_UUID, 'allow')
    expect(emit).toHaveBeenCalledWith(
      'tool_approval_resolved',
      expect.objectContaining({ sessionId: sid, approvalId: APPROVAL_UUID }),
    )
  })

  it('clears the auto-deny timeout', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    resolveApproval(sid, APPROVAL_UUID, 'allow')
    expect(clearSpy).toHaveBeenCalled()
  })

  it('returns false for unknown approvalId', () => {
    const result = resolveApproval(sid, 'nonexistent-id', 'allow')
    expect(result).toBe(false)
  })

  it('returns false on second call for already-resolved approval', () => {
    resolveApproval(sid, APPROVAL_UUID, 'allow')
    const result = resolveApproval(sid, APPROVAL_UUID, 'deny')
    expect(result).toBe(false)
  })

  it('does not write to PTY on second (duplicate) resolve', () => {
    resolveApproval(sid, APPROVAL_UUID, 'allow')
    const writeCountAfterFirst = mockTerm.write.mock.calls.length
    resolveApproval(sid, APPROVAL_UUID, 'deny')
    expect(mockTerm.write.mock.calls.length).toBe(writeCountAfterFirst)
  })
})

// ─── cancelQuery ─────────────────────────────────────────────────────────────

describe('cancelQuery()', () => {
  it('returns false for unknown sessionId', () => {
    expect(cancelQuery('not-a-real-session')).toBe(false)
  })

  it('kills the PTY term', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    cancelQuery(sid)
    expect(mockTerm.kill).toHaveBeenCalled()
  })

  it('emits sdk_result with subtype cancelled', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()
    cancelQuery(sid)
    expect(emit).toHaveBeenCalledWith(
      'sdk_result',
      expect.objectContaining({ sessionId: sid, subtype: 'cancelled' }),
    )
  })

  it('removes session so isQueryActive returns false', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    expect(isQueryActive(sid)).toBe(true)
    cancelQuery(sid)
    expect(isQueryActive(sid)).toBe(false)
  })

  it('returns true on successful cancel', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    expect(cancelQuery(sid)).toBe(true)
  })

  it('denies all pending approvals and emits tool_approval_resolved for each', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    capturedOnData('[Y/n] Do you want to allow this action?')
    emit.mockClear()

    cancelQuery(sid)

    expect(emit).toHaveBeenCalledWith(
      'tool_approval_resolved',
      expect.objectContaining({ sessionId: sid, approvalId: APPROVAL_UUID }),
    )
  })

  it('clears the 10-minute safety timeout on cancel', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    cancelQuery(sid)
    // Should have cleared s.timeoutId (the 10-min timer)
    expect(clearSpy).toHaveBeenCalled()
  })

  it('clears auto-deny timers when cancelling pending approvals', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    capturedOnData('Do you want to allow this? [Y/n]')

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    cancelQuery(sid)
    expect(clearSpy).toHaveBeenCalled()
  })
})

// ─── handlePtyData — approval detection ──────────────────────────────────────

describe('handlePtyData — approval detection', () => {
  let sid

  beforeEach(async () => {
    sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()
  })

  it('emits tool_approval_request when [Y/n] at end of line detected', () => {
    capturedOnData('The tool wants to use bash\nDo you want to allow this action? [Y/n]')
    expect(emit).toHaveBeenCalledWith(
      'tool_approval_request',
      expect.objectContaining({ sessionId: sid, approvalId: APPROVAL_UUID }),
    )
  })

  it('emits tool_approval_request when "Do you want to allow" pattern detected', () => {
    capturedOnData('Do you want to allow this action?')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })

  it('emits tool_approval_request when "Allow?" pattern detected', () => {
    capturedOnData('Allow? (yes/no)')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })

  it('extracts toolName from "Tool: <name>" in prompt', () => {
    capturedOnData('Tool: bash\nAllow? (y/n)')
    expect(emit).toHaveBeenCalledWith(
      'tool_approval_request',
      expect.objectContaining({ toolName: 'bash' }),
    )
  })

  it('uses "unknown" toolName when no tool name found in prompt', () => {
    capturedOnData('Allow this action? [Y/n]')
    expect(emit).toHaveBeenCalledWith(
      'tool_approval_request',
      expect.objectContaining({ toolName: 'unknown' }),
    )
  })

  it('does not emit a second approval when one is already unresolved', () => {
    capturedOnData('Do you want to allow this?')
    const countAfterFirst = emit.mock.calls.filter(c => c[0] === 'tool_approval_request').length

    // Second matching chunk — should be ignored because an unresolved approval exists
    capturedOnData('Do you want to allow that?')
    const countAfterSecond = emit.mock.calls.filter(c => c[0] === 'tool_approval_request').length

    expect(countAfterSecond).toBe(countAfterFirst)
  })

  it('does not emit approval for normal non-approval output', () => {
    capturedOnData('Working on it...\nAnalyzing code...\nDone.')
    expect(emit).not.toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })

  it('does not false-positive on [Y/n] in middle of conversational text', () => {
    // This would false-positive without the tail-only + end-of-string anchor fix
    capturedOnData('You can use [Y/n] prompts in your CLI.\nThe tool is working now.\nStill running.\nAlmost done.\nDone processing.')
    expect(emit).not.toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })
})

// ─── handlePtyExit ────────────────────────────────────────────────────────────

describe('handlePtyExit — PTY process exit', () => {
  let sid

  beforeEach(async () => {
    sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()
  })

  it('emits sdk_result with subtype success on exitCode 0', () => {
    capturedOnExit({ exitCode: 0 })
    expect(emit).toHaveBeenCalledWith(
      'sdk_result',
      expect.objectContaining({ sessionId: sid, subtype: 'success' }),
    )
  })

  it('emits sdk_result with subtype error on non-zero exitCode', () => {
    capturedOnExit({ exitCode: 1 })
    expect(emit).toHaveBeenCalledWith(
      'sdk_result',
      expect.objectContaining({ sessionId: sid, subtype: 'error' }),
    )
  })

  it('calls term.kill() to prevent zombie processes', () => {
    mockTerm.kill.mockClear()
    capturedOnExit({ exitCode: 0 })
    expect(mockTerm.kill).toHaveBeenCalled()
  })

  it('removes session after exit so isQueryActive returns false', () => {
    capturedOnExit({ exitCode: 0 })
    expect(isQueryActive(sid)).toBe(false)
  })

  it('cleans up pending approvals on exit', () => {
    capturedOnData('Do you want to allow this? [Y/n]')
    expect(getQueryStatus(sid).pendingApprovals).toHaveLength(1)

    capturedOnExit({ exitCode: 0 })

    // Session gone — getQueryStatus returns empty defaults
    expect(getQueryStatus(sid)).toEqual({ active: false, pendingApprovals: [] })
  })
})

// ─── stripAnsi — tested indirectly through approval detection ─────────────────

describe('stripAnsi() — approval detection after stripping', () => {
  let sid

  beforeEach(async () => {
    sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()
  })

  it('strips ANSI color codes so approval patterns still match', () => {
    capturedOnData('\x1b[32m[Y/n]\x1b[0m Do you want to allow this action?')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })

  it('strips cursor visibility escape \\x1b[?25h', () => {
    capturedOnData('\x1b[?25hDo you want to allow this action?')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })

  it('strips OSC sequences (\\x1b]...\\x07)', () => {
    capturedOnData('\x1b]0;title\x07Do you want to allow this? [Y/n]')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })
})

// ─── Buffer trimming at 4KB ───────────────────────────────────────────────────

describe('buffer trimming at 4KB', () => {
  it('handles large data chunks and continues to detect approvals afterwards', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()

    // Send > 4096 bytes of non-matching data to trigger the trim logic
    capturedOnData('x'.repeat(5000))

    // After trim, subsequent approval prompts should still be detected
    capturedOnData('Do you want to allow this? [Y/n]')
    expect(emit).toHaveBeenCalledWith('tool_approval_request', expect.any(Object))
  })
})

// ─── Safety timeout ───────────────────────────────────────────────────────────

describe('10-minute safety timeout', () => {
  it('emits sdk_result timeout after 600 seconds', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    emit.mockClear()

    vi.advanceTimersByTime(600_000)

    expect(emit).toHaveBeenCalledWith(
      'sdk_result',
      expect.objectContaining({ sessionId: sid, subtype: 'timeout' }),
    )
  })

  it('does not emit timeout after cancelQuery removes the session', async () => {
    const sid = uniqueSession()
    await bootSession(sid)
    cancelQuery(sid)
    emit.mockClear()

    vi.advanceTimersByTime(600_000)

    expect(emit).not.toHaveBeenCalledWith(
      'sdk_result',
      expect.objectContaining({ subtype: 'timeout' }),
    )
  })
})
