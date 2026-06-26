import { describe, it, expect } from 'vitest'
import { suggestReply } from '../../utils/suggestReply.js'

// Helper builders for the normalized message shape MessageList consumes:
// { type: 'user' | 'assistant', blocks: [{ type, text | content | name | ... }] }
const assistantText = (text) => ({ type: 'assistant', blocks: [{ type: 'text', text }] })
const assistantToolUse = (name) => ({
  type: 'assistant',
  blocks: [
    { type: 'text', text: 'Running a tool.' },
    { type: 'tool_use', name, input: {} },
  ],
})
const toolResult = (content) => ({ type: 'user', blocks: [{ type: 'tool_result', content }] })

describe('suggestReply', () => {
  it('returns null for empty or invalid input', () => {
    expect(suggestReply([])).toBeNull()
    expect(suggestReply(null)).toBeNull()
    expect(suggestReply(undefined)).toBeNull()
    expect(suggestReply('nope')).toBeNull()
  })

  it('proposes a recovery instruction when the last tool_result is an error', () => {
    const out = suggestReply([
      assistantToolUse('Bash'),
      toolResult('npm ERR! something failed with exit code 1'),
    ])
    expect(out).toMatch(/failed/i)
    expect(out).toMatch(/different approach|try/i)
  })

  it('treats a clean (non-error) tool_result as not needing recovery', () => {
    const out = suggestReply([assistantToolUse('Read'), toolResult('file contents look fine')])
    // Falls through to the tool_use/question heuristics, not the error path.
    expect(out).not.toMatch(/failed/i)
  })

  it('suggests an affirmative for a yes/no question', () => {
    expect(suggestReply([assistantText('Should I proceed with the migration?')])).toMatch(
      /go ahead|yes/i,
    )
    expect(suggestReply([assistantText('Do you want me to delete the temp files?')])).toMatch(
      /go ahead|yes/i,
    )
  })

  it('stays silent (null) for an open-ended question it cannot answer for the user', () => {
    expect(suggestReply([assistantText('Which database should we target?')])).toBeNull()
  })

  it('suggests approval when the agent paused on a tool call', () => {
    expect(suggestReply([assistantToolUse('Bash')])).toMatch(/go ahead|approv/i)
  })

  it('returns null when the agent just made a plain statement', () => {
    expect(
      suggestReply([assistantText('Done — the feature is implemented and tests pass.')]),
    ).toBeNull()
  })

  it('prioritizes a recent error over a trailing question', () => {
    const out = suggestReply([
      assistantText('Should I retry?'),
      toolResult('fatal: repository not found'),
    ])
    expect(out).toMatch(/failed/i)
  })
})
