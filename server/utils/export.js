// Session export formatters — markdown and JSON

export function formatAsMarkdown(session, messages) {
  const lines = []

  // Header
  lines.push(`# Session: ${session.slug || session.sessionId}`)
  lines.push('')
  lines.push(`**Model:** ${session.model || 'unknown'} | **Started:** ${session.firstTimestamp || 'unknown'} | **Messages:** ${messages.length}`)
  lines.push(`**Project:** ${session.cwd || 'unknown'}`)
  lines.push('')
  lines.push('---')
  lines.push('')

  for (const msg of messages) {
    if (msg.type === 'user') {
      lines.push('## User')
      lines.push('')
      formatBlocks(msg.blocks, lines)
    } else if (msg.type === 'assistant') {
      lines.push('## Assistant')
      lines.push('')
      formatBlocks(msg.blocks, lines)
    }
  }

  return lines.join('\n')
}

function formatBlocks(blocks, lines) {
  if (!blocks || blocks.length === 0) return

  for (const block of blocks) {
    switch (block.type) {
      case 'text':
        lines.push(block.text || '')
        lines.push('')
        break

      case 'thinking':
        lines.push('<details><summary>Thinking</summary>')
        lines.push('')
        lines.push(block.text || '')
        lines.push('')
        lines.push('</details>')
        lines.push('')
        break

      case 'tool_use':
        lines.push(`### Tool: ${block.name}`)
        lines.push('')
        lines.push('```json')
        lines.push(JSON.stringify(block.input, null, 2))
        lines.push('```')
        lines.push('')
        break

      case 'tool_result':
        lines.push('#### Result')
        lines.push('')
        lines.push('```')
        lines.push(block.content || '')
        lines.push('```')
        lines.push('')
        break

      case 'image':
        lines.push('*[Image]*')
        lines.push('')
        break

      default:
        break
    }
  }
}

export function formatAsJson(session, messages) {
  return JSON.stringify({
    sessionId: session.sessionId,
    slug: session.slug || null,
    model: session.model || null,
    cwd: session.cwd || null,
    firstTimestamp: session.firstTimestamp || null,
    messageCount: messages.length,
    messages,
  }, null, 2)
}
