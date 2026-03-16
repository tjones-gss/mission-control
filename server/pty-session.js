import * as pty from 'node-pty'
import crypto from 'crypto'
import { emit } from './sse.js'

// On Windows, node-pty needs the .exe extension to find executables in PATH
const CLAUDE_CMD = process.platform === 'win32' ? 'claude.exe' : 'claude'

// Validation whitelists (shared with routes/sessions.js)
export const VALID_PERMISSION_MODES = new Set(['plan', 'auto', 'default', 'acceptEdits', 'dontAsk', 'bypassPermissions'])
export const VALID_MODEL_SHORTCUTS = new Set(['sonnet', 'opus', 'haiku'])

// Active PTY sessions keyed by sessionId
const sessions = new Map()

// Pending tool approvals keyed by approvalId
const pendingApprovals = new Map()

function cleanEnv() {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
  }
  return env
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07|\x1b[()][A-Z0-9]|\x1b[>=<]|\r/g

function stripAnsi(str) {
  return str.replace(ANSI_RE, '')
}

// Strip control characters that could corrupt the PTY input buffer
// (Ctrl-C, Ctrl-Z, cursor movement, etc.) — preserves tabs and newlines
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

function sanitizePrompt(str) {
  return str.replace(ANSI_RE, '').replace(CONTROL_RE, '')
}

// Patterns that indicate the CLI is asking for tool approval.
// Only match against the last few lines of output (the PTY prompt area)
// to avoid false positives on conversational text in Claude's responses.
const APPROVAL_PATTERNS = [
  /Do you want to (?:allow|approve|proceed)/i,
  /Allow (?:this action|tool|once)/i,
  /\[Y\/n\]\s*$/,
  /\[y\/N\]\s*$/,
  /Allow\?\s*\(/,
]

// Extract tool name from approval prompt text
const TOOL_NAME_RE = /(?:wants? to (?:use|run)\s+(?:the\s+)?|Tool:\s*|─+\s*)(\w+)/i

export function isQueryActive(sessionId) {
  const s = sessions.get(sessionId)
  return s?.busy || false
}

export function getQueryStatus(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return { active: false, pendingApprovals: [] }
  return {
    active: s.busy,
    pendingApprovals: [...s.approvals.values()]
      .filter(a => !a.resolved)
      .map(a => ({ approvalId: a.approvalId, toolName: a.toolName, input: a.input })),
  }
}

export function resolveApproval(sessionId, approvalId, decision) {
  const approval = pendingApprovals.get(approvalId)
  if (!approval || approval.resolved) return false

  const s = sessions.get(sessionId)
  if (!s || s.exited) return false

  approval.resolved = true
  if (approval.timeoutId) clearTimeout(approval.timeoutId)
  pendingApprovals.delete(approvalId)

  // Write the response to the PTY
  s.term.write(decision === 'allow' ? 'y\r' : 'n\r')
  // Reset output buffer so we don't re-detect the same prompt
  s.recentOutput = ''

  emit('tool_approval_resolved', { sessionId, approvalId })
  return true
}

export function cancelQuery(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return false

  // Deny all pending approvals
  for (const [id, approval] of s.approvals) {
    if (!approval.resolved) {
      approval.resolved = true
      if (approval.timeoutId) clearTimeout(approval.timeoutId)
      pendingApprovals.delete(id)
      emit('tool_approval_resolved', { sessionId, approvalId: id })
    }
  }

  if (s.timeoutId) clearTimeout(s.timeoutId)
  if (s.completionTimer) clearTimeout(s.completionTimer)
  s.term.kill()
  s.busy = false
  s.exited = true
  sessions.delete(sessionId)
  emit('sdk_result', { sessionId, subtype: 'cancelled' })
  return true
}

/**
 * Send a message to a session via pseudo-terminal (uses subscription auth, not API credits).
 * Spawns `claude --resume <id>` in a PTY so the CLI treats it as interactive.
 * Response data comes via the JSONL watcher, not from PTY output.
 */
export async function startQuery({ sessionId, prompt, cwd, sdkOptions = {} }) {
  if (!sessionId) {
    throw new Error('sessionId is required for PTY queries (use CLI path for new sessions)')
  }

  let s = sessions.get(sessionId)

  if (s?.busy) {
    throw new Error('A query is already active for this session')
  }

  // If no existing PTY or it exited, spawn a new one
  if (!s || s.exited) {
    const args = ['--resume', sessionId]

    if (sdkOptions.permissionMode && VALID_PERMISSION_MODES.has(sdkOptions.permissionMode)) {
      args.push('--permission-mode', sdkOptions.permissionMode)
    }
    if (sdkOptions.model && (VALID_MODEL_SHORTCUTS.has(sdkOptions.model) || /^claude-/.test(sdkOptions.model))) {
      args.push('--model', sdkOptions.model)
    }

    let term
    try {
      term = pty.spawn(CLAUDE_CMD, args, {
        cwd: cwd || undefined,
        env: cleanEnv(),
        cols: 200,
        rows: 50,
      })
    } catch (spawnErr) {
      throw new Error(`Failed to spawn PTY: ${spawnErr.message}`)
    }

    s = {
      term,
      sessionId,
      busy: true,
      exited: false,
      recentOutput: '',
      approvals: new Map(),
    }
    sessions.set(sessionId, s)

    term.onData(data => handlePtyData(sessionId, data))
    term.onExit(({ exitCode }) => handlePtyExit(sessionId, exitCode))

    // Wait for the CLI to initialize before sending the message
    await waitForReady(s)

    // If PTY crashed during init, abort
    if (s.exited) {
      throw new Error('PTY exited before message could be sent')
    }
  } else {
    s.busy = true
    s.recentOutput = ''
  }

  // Send the message (sanitize to prevent control char injection)
  s.term.write(sanitizePrompt(prompt) + '\r')
  emit('sdk_message', { sessionId, msg: { type: 'system', subtype: 'message_sent' } })

  // Safety timeout: if the query runs for more than 10 minutes, mark as no longer busy
  // (the PTY stays alive for reuse, but we unblock the UI)
  const timeoutId = setTimeout(() => {
    const current = sessions.get(sessionId)
    if (current?.busy) {
      current.busy = false
      emit('sdk_result', { sessionId, subtype: 'timeout' })
    }
  }, 600_000)
  s.timeoutId = timeoutId

  return { ok: true, streaming: true }
}

/**
 * Wait for the CLI to be ready for input.
 * Strategy: wait for output to start, then wait for 1.5s of silence.
 */
function waitForReady(s) {
  return new Promise((resolve, reject) => {
    let silenceTimer = null

    const cleanup = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      s.term.removeListener('data', onData)
      s.term.removeListener('exit', onExit)
    }

    const onData = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        cleanup()
        resolve()
      }, 1500)
    }

    const onExit = () => {
      cleanup()
      reject(new Error('PTY exited during initialization'))
    }

    s.term.on('data', onData)
    s.term.on('exit', onExit)

    // Hard timeout: resolve after 8 seconds regardless
    setTimeout(() => {
      cleanup()
      resolve()
    }, 8000)
  })
}

function handlePtyData(sessionId, data) {
  const s = sessions.get(sessionId)
  if (!s || !s.busy) return

  // Mark that the PTY has produced output since the message was sent
  s.hasOutput = true

  // Reset the completion silence timer — if no more output arrives for 3s
  // (and no approval is pending), we consider the response complete.
  if (s.completionTimer) clearTimeout(s.completionTimer)
  s.completionTimer = setTimeout(() => {
    const current = sessions.get(sessionId)
    if (!current || !current.busy) return
    // Don't complete if there's an unresolved tool approval (PTY is waiting for input)
    const hasUnresolved = [...current.approvals.values()].some(a => !a.resolved)
    if (hasUnresolved) return
    current.busy = false
    if (current.timeoutId) clearTimeout(current.timeoutId)
    emit('sdk_result', { sessionId, subtype: 'success' })
  }, 3000)

  s.recentOutput += data
  const clean = stripAnsi(s.recentOutput)

  // Only check the tail of output for approval prompts — Claude's conversational
  // text earlier in the buffer can contain phrases like "[Y/n]" or "allow" that
  // would false-positive if we matched the entire buffer.
  const tail = clean.split('\n').slice(-5).join('\n')

  // Check for tool approval prompts
  for (const pattern of APPROVAL_PATTERNS) {
    if (pattern.test(tail)) {
      // Don't re-detect if we already have an unresolved approval
      const hasUnresolved = [...s.approvals.values()].some(a => !a.resolved)
      if (hasUnresolved) return

      const toolMatch = clean.match(TOOL_NAME_RE)
      const toolName = toolMatch?.[1] || 'unknown'
      const approvalId = crypto.randomUUID()
      // Extract a snippet around the approval for context
      const lines = clean.split('\n').slice(-15).join('\n')

      const approval = {
        approvalId,
        toolName,
        input: { raw: lines },
        resolved: false,
      }
      s.approvals.set(approvalId, approval)
      pendingApprovals.set(approvalId, approval)

      emit('tool_approval_request', {
        sessionId,
        approvalId,
        toolName,
        input: { raw: lines },
      })

      // Auto-deny after 120s
      approval.timeoutId = setTimeout(() => {
        if (!approval.resolved) {
          resolveApproval(sessionId, approvalId, 'deny')
        }
      }, 120_000)

      // Clear recent output to prevent re-detection
      s.recentOutput = ''
      return
    }
  }

  // Trim buffer to prevent unbounded growth (keep last 4KB)
  if (s.recentOutput.length > 4096) {
    s.recentOutput = s.recentOutput.slice(-2048)
  }
}

function handlePtyExit(sessionId, exitCode) {
  const s = sessions.get(sessionId)
  if (!s) return

  s.exited = true
  if (s.timeoutId) clearTimeout(s.timeoutId)
  if (s.completionTimer) clearTimeout(s.completionTimer)

  if (s.busy) {
    s.busy = false
    emit('sdk_result', {
      sessionId,
      subtype: exitCode === 0 ? 'success' : 'error',
    })
  }

  // Kill the PTY process to prevent zombies
  try { s.term.kill() } catch { /* already dead */ }

  // Clean up pending approvals
  for (const [id, approval] of s.approvals) {
    if (!approval.resolved) {
      if (approval.timeoutId) clearTimeout(approval.timeoutId)
      pendingApprovals.delete(id)
    }
  }
  sessions.delete(sessionId)
}
