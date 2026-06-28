// Sprint 2 — semantic alerting: tight-loop detection. An agent that fires the
// same tool call over and over with no progress is a governance event a human
// should see. This is the pure, synchronous counterpart to the window-based
// `loop` heuristic in anomaly-detector.js: it looks at the *trailing* streak of
// consecutive identical tool calls and reports the current state, so a human
// turn immediately clears it (UNIVERSAL CONSTRAINT: no LLM in the alert path).
//
// "Looping" = THRESHOLD+ consecutive tool calls of the same type, with the same
// content hash, spanning no more than `windowMs`, and with no genuine human turn
// breaking the streak. tool_result user records (the harness echoing tool output)
// sit between every pair of calls and are skipped — they do not break a loop.

import crypto from 'node:crypto'

export const DEFAULT_THRESHOLD = 3
export const DEFAULT_WINDOW_MS = 90_000 // 90s

function resolveThreshold(opt) {
  if (Number.isFinite(opt) && opt > 0) return opt
  const env = parseInt(process.env.LOOP_DETECTION_THRESHOLD ?? '', 10)
  return Number.isFinite(env) && env > 0 ? env : DEFAULT_THRESHOLD
}

// A genuine human turn (string content or a text block) breaks the streak; a
// tool_result-only user record is the harness, not the human, and does not.
function isHumanUser(r) {
  if (r?.type !== 'user') return false
  const content = r?.message?.content
  if (typeof content === 'string') return content.trim().length > 0
  if (Array.isArray(content)) return content.some((b) => b?.type === 'text')
  return false
}

// The (tool, hash, ts) signature of an assistant tool-use turn, or null if the
// turn made no tool call. A turn with several tool_use blocks (parallel tool use)
// collapses to one composite event, so legitimate parallelism can't itself form a
// 3-deep run of one repeated call.
function toolCallSignature(r) {
  const content = r?.message?.content
  if (!Array.isArray(content)) return null
  const toolUses = content.filter((b) => b?.type === 'tool_use')
  if (toolUses.length === 0) return null
  const tool = toolUses.length === 1 ? toolUses[0].name : toolUses.map((b) => b.name).join('+')
  const hash = crypto
    .createHash('sha1')
    .update(JSON.stringify(toolUses.map((b) => ({ name: b.name, input: b.input ?? null }))))
    .digest('hex')
  const ts = r?.timestamp ? Date.parse(r.timestamp) : NaN
  return { tool, hash, ts }
}

export function detectLoop(session, options = {}) {
  const threshold = resolveThreshold(options.threshold)
  const windowMs = Number.isFinite(options.windowMs) ? options.windowMs : DEFAULT_WINDOW_MS
  const messages = Array.isArray(session?.messages) ? session.messages : []

  // Walk backwards from the most recent record, accumulating the trailing run of
  // identical consecutive tool calls.
  const run = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const r = messages[i]
    if (r?.type === 'user') {
      if (isHumanUser(r)) break // a human stepped in — streak is broken
      continue // tool_result echo — skip, does not break the streak
    }
    if (r?.type !== 'assistant') continue // system / meta records are transparent
    const sig = toolCallSignature(r)
    if (!sig) break // a non-tool assistant turn (pure text) ends the streak
    if (run.length === 0 || (run[0].tool === sig.tool && run[0].hash === sig.hash)) {
      run.push(sig)
    } else {
      break // a different tool or different content ends the streak
    }
  }

  if (run.length < threshold) return { looping: false }
  const times = run.map((s) => s.ts).filter(Number.isFinite)
  const duration_ms = times.length ? Math.max(...times) - Math.min(...times) : 0
  if (duration_ms > windowMs) return { looping: false }
  return { looping: true, tool: run[0].tool, count: run.length, duration_ms }
}
