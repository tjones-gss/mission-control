// Smart Triage replies — derive a context-aware suggested reply for a session
// that is blocking on the user, from the tail of its transcript.
//
// Input is the normalized message array MessageList consumes (most recent last):
//   { type: 'user' | 'assistant', blocks: [{ type, text | content | name | ... }] }
// Output is a short suggested instruction string, or null when nothing
// confident can be offered (the card then falls back to the generic chips).
//
// The suggestion is only ever PRE-FILLED for a human to send — never sent
// automatically — so a conservative heuristic that returns null when unsure is
// the right call.

const ERROR_RE =
  /\b(error|errored|failed|failure|exception|traceback|fatal|denied|not found|cannot|unable to|exit code\s*[1-9])\b/i

// Question phrasings the user can safely answer with a plain "go ahead".
const YESNO_RE =
  /\b(should i|shall i|can i|may i|do you want|would you like|ok to|is it ok|want me to|proceed)\b/i

// How far back from the tail to look — a blocked agent's relevant signal is
// always in the last turn or two.
const WINDOW = 6

export function suggestReply(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return null
  const recent = messages.slice(-WINDOW)

  // 1) An error in the most recent tool_result → propose a recovery instruction.
  for (let i = recent.length - 1; i >= 0; i--) {
    const results = (recent[i].blocks || []).filter((b) => b.type === 'tool_result')
    if (results.length === 0) continue
    const content = results.map((b) => b.content || '').join('\n')
    if (ERROR_RE.test(content)) {
      return 'That step failed — please look at the error and try a different approach.'
    }
    break // the most recent tool_result was clean; don't keep digging
  }

  // 2) The latest assistant turn: a yes/no question, or a paused tool call.
  const lastAssistant = [...recent].reverse().find((m) => m.type === 'assistant')
  if (lastAssistant) {
    const blocks = lastAssistant.blocks || []
    const lastText = [...blocks].reverse().find((b) => b.type === 'text')?.text || ''
    const trimmed = lastText.trim()
    if (trimmed.endsWith('?')) {
      return YESNO_RE.test(trimmed) ? 'Yes — go ahead.' : null
    }
    if (blocks[blocks.length - 1]?.type === 'tool_use') {
      return 'Approved — go ahead.'
    }
  }

  return null
}
