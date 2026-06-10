import * as pty from 'node-pty'
import crypto from 'crypto'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { emit, onEvent } from './sse.js'
import { classify as classifyCommand } from './utils/commandClassifier.js'
import { getClaudeBin } from './lib/claude-bin.js'
import { isCwdTrusted } from './lib/trust-store.js'

// Validation whitelists (shared with routes/sessions.js)
export const VALID_PERMISSION_MODES = new Set([
  'plan',
  'auto',
  'default',
  'acceptEdits',
  'dontAsk',
  'bypassPermissions',
])
export const VALID_MODEL_SHORTCUTS = new Set(['sonnet', 'opus', 'haiku'])

// Decide the permission CLI args for a NEW interactive session (the front door).
// Policy (default-DENY): an explicit, valid permissionMode is honored as-is. Otherwise
// we run GUARDED (--permission-mode acceptEdits) — never disabling prompts by default —
// and only escalate to --dangerously-skip-permissions when the operator has granted a
// deliberate, persisted per-cwd trust (trust-store.js). Choosing a cwd is NOT consent to
// run unattended with full Bash/Write against a possibly prompt-injected repo.
export function resolvePermissionArgs(sdkOptions = {}, cwd) {
  if (sdkOptions.permissionMode && VALID_PERMISSION_MODES.has(sdkOptions.permissionMode)) {
    return ['--permission-mode', sdkOptions.permissionMode]
  }
  if (cwd && isCwdTrusted(cwd)) return ['--dangerously-skip-permissions']
  return ['--permission-mode', 'acceptEdits']
}

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

// Collect all existing session IDs from ~/.claude/projects/ (quick fs scan)
function getExistingSessionIds() {
  const ids = new Set()
  const projectsDir = path.join(os.homedir(), '.claude', 'projects')
  try {
    for (const dir of fs.readdirSync(projectsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue
      const dirPath = path.join(projectsDir, dir.name)
      for (const f of fs.readdirSync(dirPath)) {
        if (f.endsWith('.jsonl')) ids.add(f.replace('.jsonl', ''))
      }
    }
  } catch {
    /* projects dir may not exist */
  }
  return ids
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
      .filter((a) => !a.resolved)
      .map((a) => ({
        approvalId: a.approvalId,
        toolName: a.toolName,
        input: a.input,
        // Risk classification (Bash commands only today); null means
        // "not classified", never a fabricated default.
        riskLevel: a.riskLevel ?? null,
        riskDescription: a.riskDescription ?? null,
      })),
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
  try {
    s.term.write(decision === 'allow' ? 'y\r' : 'n\r')
  } catch {
    return false
  }
  // Reset output buffer so we don't re-detect the same prompt
  s.recentOutput = ''

  emit('tool_approval_resolved', { sessionId, approvalId, ts: Date.now() })
  // Return the approval itself (truthy, so existing boolean callers keep
  // working) — callers audit the decision and need its risk classification.
  return approval
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
      emit('tool_approval_resolved', { sessionId, approvalId: id, ts: Date.now() })
    }
  }

  if (s.timeoutId) clearTimeout(s.timeoutId)
  if (s.completionTimer) clearTimeout(s.completionTimer)
  if (s.removeCompletionListener) s.removeCompletionListener()
  if (s._completionState?.promptDetectTimer) {
    clearTimeout(s._completionState.promptDetectTimer)
  }
  s._completionState = null
  s.term.kill()
  s.busy = false
  s.exited = true
  sessions.delete(sessionId)
  emit('sdk_result', { sessionId, subtype: 'cancelled', ts: Date.now() })
  return true
}

/**
 * Mark a query as complete — idempotent so both detection mechanisms can race safely.
 */
function markComplete(sessionId, subtype) {
  const s = sessions.get(sessionId)
  if (!s || !s.busy) return

  s.busy = false
  if (s.timeoutId) clearTimeout(s.timeoutId)
  if (s.completionTimer) clearTimeout(s.completionTimer)
  if (s.removeCompletionListener) s.removeCompletionListener()
  if (s._completionState?.promptDetectTimer) {
    clearTimeout(s._completionState.promptDetectTimer)
  }
  s._completionState = null
  s.recentOutput = ''

  emit('sdk_result', { sessionId, subtype, ts: Date.now() })
}

/**
 * Set up dual completion detection for an active query:
 * 1. JSONL silence fallback — 8s of no file-watcher updates
 * 2. PTY output silence — 3s of no PTY data (handled in handlePtyData)
 * 3. Safety timeout — 10 minutes hard cap
 */
function setupCompletionDetection(sessionId) {
  const s = sessions.get(sessionId)
  if (!s) return

  // State for PTY silence-based detection (consumed by handlePtyData).
  // Each PTY data chunk resets the 3s timer; when PTY goes quiet, response is done.
  s._completionState = { promptDetectTimer: null }

  // Mechanism 1: JSONL silence fallback (8s)
  const removeJsonlListener = onEvent((event, data) => {
    if (event !== 'session_update') return
    if (!data?.filePath?.includes(sessionId)) return
    const current = sessions.get(sessionId)
    if (!current || !current.busy) {
      removeJsonlListener()
      return
    }

    if (current.completionTimer) clearTimeout(current.completionTimer)
    current.completionTimer = setTimeout(() => {
      const c = sessions.get(sessionId)
      if (!c || !c.busy) return
      const hasUnresolved = [...c.approvals.values()].some((a) => !a.resolved)
      if (hasUnresolved) return
      markComplete(sessionId, 'success')
    }, 8000)
  })
  s.removeCompletionListener = removeJsonlListener

  // Mechanism 3: Safety timeout (10 min)
  const timeoutId = setTimeout(() => {
    const current = sessions.get(sessionId)
    if (current?.busy) {
      markComplete(sessionId, 'timeout')
    }
  }, 600_000)
  s.timeoutId = timeoutId
}

/**
 * Spawn a brand-new interactive session via PTY (subscription auth, no API credits).
 * Detects the created session ID by listening for `new_session` SSE events from the watcher.
 * Returns the session ID so the client can track it.
 */
export async function spawnNewSession({ prompt, cwd, name, sdkOptions = {} }) {
  const args = []
  if (name && typeof name === 'string' && name.trim()) {
    args.push('--name', name.trim())
  }
  args.push(...resolvePermissionArgs(sdkOptions, cwd))
  if (
    sdkOptions.model &&
    (VALID_MODEL_SHORTCUTS.has(sdkOptions.model) || /^claude-/.test(sdkOptions.model))
  ) {
    args.push('--model', sdkOptions.model)
  }

  const bin = getClaudeBin()
  let term
  try {
    term = pty.spawn(bin, args, {
      cwd: cwd || undefined,
      env: cleanEnv(),
      cols: 200,
      rows: 50,
    })
  } catch (spawnErr) {
    throw new Error(`Failed to spawn PTY (${bin}): ${spawnErr.message}`)
  }

  // Use a temporary key until we discover the real session ID
  const tempId = `_new_${crypto.randomUUID()}`
  const s = {
    term,
    sessionId: tempId,
    busy: true,
    exited: false,
    recentOutput: '',
    approvals: new Map(),
  }
  sessions.set(tempId, s)

  term.onData((data) => handlePtyData(s.sessionId, data))
  term.onExit(({ exitCode }) => handlePtyExit(s.sessionId, exitCode))

  try {
    await waitForReady(s)
  } catch (readyErr) {
    // PTY exited during initialization (e.g., untrusted folder, missing API key)
    sessions.delete(tempId)
    try {
      term.kill()
    } catch {
      /* ignore */
    }
    throw new Error(`PTY initialization failed: ${readyErr.message}`)
  }
  if (s.exited) {
    sessions.delete(tempId)
    throw new Error('PTY exited before message could be sent')
  }

  // Listen for watcher events to discover the real session ID.
  // On Windows, chokidar's awaitWriteFinish can cause `change` to fire instead
  // of `add`, so we listen for both `new_session` and `session_update`.
  // Snapshot ALL existing session IDs from the filesystem before spawning,
  // then detect the first truly new one.
  const existingIds = getExistingSessionIds()
  const sessionIdPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => {
      removeListener()
      resolve(null)
    }, 30_000)
    const removeListener = onEvent((event, data) => {
      if (event !== 'new_session' && event !== 'session_update') return
      if (!data?.filePath) return
      const parts = data.filePath.replace(/\\/g, '/').split('/')
      if (parts.length < 3 || parts[0] !== 'projects') return
      const id = path.basename(data.filePath, '.jsonl')
      if (id && !existingIds.has(id)) {
        clearTimeout(timeout)
        removeListener()
        resolve(id)
      }
    })
  })

  // Send the prompt
  const sanitized = sanitizePrompt(prompt)
  s.term.write(`\x1b[200~${sanitized}\x1b[201~`)
  await new Promise((resolve) => setTimeout(resolve, 100))
  s.term.write('\r')

  // Wait for the session ID (the watcher fires new_session when the JSONL appears)
  const realId = await sessionIdPromise

  if (realId) {
    // Re-key the PTY under the real session ID
    sessions.delete(tempId)
    s.sessionId = realId
    sessions.set(realId, s)

    emit('sdk_message', {
      sessionId: realId,
      ts: Date.now(),
      msg: { type: 'system', subtype: 'message_sent' },
    })

    setupCompletionDetection(realId)
  } else {
    // Couldn't detect session ID — kill PTY, let client retry
    try {
      s.term.kill()
    } catch {
      /* node-pty ConPTY can throw on Windows */
    }
    sessions.delete(tempId)
    throw new Error('New session created but session ID could not be detected')
  }

  return { ok: true, sessionId: realId, streaming: true }
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
    if (
      sdkOptions.model &&
      (VALID_MODEL_SHORTCUTS.has(sdkOptions.model) || /^claude-/.test(sdkOptions.model))
    ) {
      args.push('--model', sdkOptions.model)
    }

    const bin = getClaudeBin()
    let term
    try {
      term = pty.spawn(bin, args, {
        cwd: cwd || undefined,
        env: cleanEnv(),
        cols: 200,
        rows: 50,
      })
    } catch (spawnErr) {
      throw new Error(`Failed to spawn PTY (${bin}): ${spawnErr.message}`)
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

    term.onData((data) => handlePtyData(sessionId, data))
    term.onExit(({ exitCode }) => handlePtyExit(sessionId, exitCode))

    // Wait for the CLI to initialize before sending the message
    await waitForReady(s)

    // If PTY crashed during init, abort
    if (s.exited) {
      throw new Error('PTY exited before message could be sent')
    }
  } else {
    // Reuse the existing PTY — send Ctrl+C first to reset the TUI input focus.
    // After a response cycle the cursor may be stuck in the response view;
    // Ctrl+C returns focus to the input prompt without killing the process.
    s.busy = true
    s.recentOutput = ''
  }

  // Set up completion detection BEFORE sending the message so that PTY output
  // from the Ctrl+C re-render is tracked (sawActivity, prompt detection).
  setupCompletionDetection(sessionId)

  // Send the message using bracketed paste mode.
  // Ctrl+C resets TUI focus to the input field (must be a separate write call
  // so it bypasses sanitizePrompt, which strips \x03).
  const sanitized = sanitizePrompt(prompt)
  try {
    s.term.write('\x03')
    await new Promise((resolve) => setTimeout(resolve, 50))
    s.term.write(`\x1b[200~${sanitized}\x1b[201~`)
    await new Promise((resolve) => setTimeout(resolve, 100))
    s.term.write('\r')
  } catch (writeErr) {
    s.busy = false
    throw new Error(`PTY write failed (session may have exited): ${writeErr.message}`)
  }
  emit('sdk_message', {
    sessionId,
    ts: Date.now(),
    msg: { type: 'system', subtype: 'message_sent' },
  })

  return { ok: true, streaming: true }
}

/**
 * Wait for the CLI to be ready for input.
 * Strategy: watch for the status bar / input prompt to appear.
 * The CLI goes through: separator → trust prompt → MCP loading → full UI.
 *
 * The trust prompt ("Yes, I trust this folder") appears early and must be
 * accepted with Enter before the full UI loads. We detect it by looking for
 * the "trust" keyword after the initial bracketed paste enable, send Enter,
 * then wait for "Claude Code" to confirm the full UI has loaded.
 */
function waitForReady(s) {
  return new Promise((resolve, reject) => {
    let silenceTimer = null
    let accumulated = ''
    let trustAccepted = false

    const cleanup = () => {
      if (silenceTimer) clearTimeout(silenceTimer)
      s.term.removeListener('data', onData)
      s.term.removeListener('exit', onExit)
    }

    const onData = (data) => {
      accumulated += data
      // Phase 1: Accept the trust prompt if it appears.
      // The trust prompt shows "trust this folder" with a selection menu.
      // Send Enter to accept the default "Yes, I trust this folder".
      // Reset the silence timer since the UI will take a few seconds to load
      // after trust is accepted (MCP servers connect, full UI renders).
      if (!trustAccepted && accumulated.includes('trust')) {
        trustAccepted = true
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = null
        s.term.write('\r')
        return // Wait for more data before starting any timer
      }

      // Phase 2: Detect the message input prompt.
      // After trust is accepted and MCP servers connect, the TUI renders the
      // full UI with the input prompt character. We detect the prompt by looking
      // for the status bar indicators (model info, effort level) which only
      // appear when the full UI is loaded and the input field is ready.
      const clean = stripAnsi(accumulated)
      // Detect the input prompt — look for indicators that the full UI is loaded:
      // "Claude Code" in raw output, or "ClaudeCode" after ANSI strip, or the prompt arrow
      const hasClaudeCode = accumulated.includes('Claude Code') || clean.includes('ClaudeCode')
      const hasPromptReady = clean.includes('/effort') || clean.includes('❯') || clean.includes('>')
      if (hasClaudeCode && hasPromptReady) {
        if (silenceTimer) clearTimeout(silenceTimer)
        silenceTimer = setTimeout(() => {
          cleanup()
          resolve()
        }, 500)
        return
      }

      // Fallback: silence-based detection (covers cases where the UI text
      // changes in future versions). Set to 10s because the TUI takes 4-10s
      // to fully initialize (trust prompt → MCP servers → full UI render).
      if (silenceTimer) clearTimeout(silenceTimer)
      silenceTimer = setTimeout(() => {
        cleanup()
        resolve()
      }, 10000)
    }

    const onExit = () => {
      cleanup()
      reject(new Error('PTY exited during initialization'))
    }

    s.term.on('data', onData)
    s.term.on('exit', onExit)

    // Hard timeout: resolve after 15 seconds regardless
    setTimeout(() => {
      cleanup()
      resolve()
    }, 15000)
  })
}

function handlePtyData(sessionId, data) {
  const s = sessions.get(sessionId)
  if (!s || !s.busy) return

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
      const hasUnresolved = [...s.approvals.values()].some((a) => !a.resolved)
      if (hasUnresolved) return

      const toolMatch = clean.match(TOOL_NAME_RE)
      const toolName = toolMatch?.[1] || 'unknown'
      const approvalId = crypto.randomUUID()
      // Extract a snippet around the approval for context
      const lines = clean.split('\n').slice(-15).join('\n')

      // Classify bash commands for risk-level indicators in the UI. Stored ON
      // the approval (not just the SSE event) so the polled status and the
      // session-list summary surface the same classification.
      let riskLevel = null
      let riskDescription = null
      if (toolName === 'Bash' || toolName === 'bash') {
        // Try to extract the actual command from the raw approval text
        const cmdMatch = lines.match(/(?:command|Command):\s*(.+)/m)
        const cmd = cmdMatch ? cmdMatch[1].trim() : lines.split('\n').pop()?.trim() || ''
        if (cmd) {
          const result = classifyCommand(cmd)
          riskLevel = result.classification
          riskDescription = result.description
        }
      }

      const approval = {
        approvalId,
        toolName,
        input: { raw: lines },
        riskLevel,
        riskDescription,
        resolved: false,
      }
      s.approvals.set(approvalId, approval)
      pendingApprovals.set(approvalId, approval)
      if (s._completionState) s._completionState.sawActivity = true

      emit('tool_approval_request', {
        sessionId,
        approvalId,
        toolName,
        input: { raw: lines },
        riskLevel,
        riskDescription,
        ts: Date.now(),
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

  // --- PTY-based completion detection ---
  // Use PTY output silence: during a response the TUI constantly redraws.
  // When the response finishes, PTY output stops. 3s of silence = likely done.
  // This is faster and more reliable than the 8s JSONL silence fallback,
  // and specific to THIS PTY (unaffected by other sessions writing to JSONL).
  const state = s._completionState
  if (state) {
    state.sawActivity = true
    if (state.promptDetectTimer) clearTimeout(state.promptDetectTimer)
    state.promptDetectTimer = setTimeout(() => {
      const c = sessions.get(sessionId)
      if (!c || !c.busy) return
      const hasUnresolved = [...c.approvals.values()].some((a) => !a.resolved)
      if (hasUnresolved) return
      markComplete(sessionId, 'success')
    }, 3000)
  }
}

function handlePtyExit(sessionId, exitCode) {
  const s = sessions.get(sessionId)
  if (!s) return

  s.exited = true
  if (s.timeoutId) clearTimeout(s.timeoutId)
  if (s.completionTimer) clearTimeout(s.completionTimer)
  if (s.removeCompletionListener) s.removeCompletionListener()
  if (s._completionState?.promptDetectTimer) {
    clearTimeout(s._completionState.promptDetectTimer)
  }
  s._completionState = null

  if (s.busy) {
    s.busy = false
    emit('sdk_result', {
      sessionId,
      subtype: exitCode === 0 ? 'success' : 'error',
      ts: Date.now(),
    })
  }

  // Kill the PTY process to prevent zombies
  try {
    s.term.kill()
  } catch {
    /* already dead */
  }

  // Clean up pending approvals
  for (const [id, approval] of s.approvals) {
    if (!approval.resolved) {
      if (approval.timeoutId) clearTimeout(approval.timeoutId)
      pendingApprovals.delete(id)
    }
  }
  sessions.delete(sessionId)
}
