import fs from 'fs'
import path from 'path'
import os from 'os'
import { config } from '../lib/config.js'
import { redact, hasSecrets } from '../utils/secretScanner.js'
import { signalDegraded } from '../lib/claude-format.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')

function findSessionFile(sessionId) {
  if (!fs.existsSync(CLAUDE_DIR)) return null

  const projectDirs = fs
    .readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const projectDir of projectDirs) {
    const filePath = path.join(CLAUDE_DIR, projectDir.name, `${sessionId}.jsonl`)
    if (fs.existsSync(filePath)) return filePath
  }

  return null
}

function stringifyContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('\n')
  }
  return String(content ?? '')
}

function mapAssistantBlocks(content) {
  if (!Array.isArray(content)) return []

  return content
    .map((block) => {
      if (block.type === 'thinking') {
        return { type: 'thinking', text: block.thinking }
      }
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'tool_use') {
        return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
      }
      return null
    })
    .filter(Boolean)
}

function mapUserBlocks(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  if (!Array.isArray(content)) return []

  return content
    .map((block) => {
      if (block.type === 'text') {
        return { type: 'text', text: block.text }
      }
      if (block.type === 'image') {
        return {
          type: 'image',
          source: block.source,
        }
      }
      if (block.type === 'tool_result') {
        return {
          type: 'tool_result',
          toolUseId: block.tool_use_id,
          content: stringifyContent(block.content),
        }
      }
      return null
    })
    .filter(Boolean)
}

/**
 * Apply secret redaction to message blocks.
 * Redacts text in 'text' and 'tool_result' blocks but NOT 'thinking' blocks.
 */
function redactBlocks(blocks) {
  if (!config.secretScanning) return blocks

  return blocks.map((block) => {
    if (block.type === 'text' && block.text) {
      if (config.secretScanLogOnly) {
        if (hasSecrets(block.text)) {
          console.warn('[secret-scanner] Secret detected in text block (log-only mode)')
        }
        return block
      }
      return { ...block, text: redact(block.text) }
    }
    if (block.type === 'tool_result' && block.content) {
      if (config.secretScanLogOnly) {
        if (hasSecrets(block.content)) {
          console.warn('[secret-scanner] Secret detected in tool_result block (log-only mode)')
        }
        return block
      }
      return { ...block, content: redact(block.content) }
    }
    // thinking blocks and other types pass through unmodified
    return block
  })
}

export function getSessionMessages(sessionId, { limit, offset = 0 } = {}) {
  try {
    const filePath = findSessionFile(sessionId)
    if (!filePath) return null

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const records = lines
      .map((l) => {
        try {
          return JSON.parse(l)
        } catch {
          return null
        }
      })
      .filter(Boolean)

    // Lines present but NONE parsed → the JSONL shape likely changed under us.
    // (An empty file yields zero lines and is unremarkable — that falls through
    // to the normal empty-messages response below.) Returning messages:[] here
    // would render "no messages" when the conversation is in fact there but
    // unreadable. Surface a distinguishable degraded marker + persistent SSE.
    if (records.length === 0 && lines.length > 0) {
      return signalDegraded('messages', 'format-change', {
        filePath,
        sessionId,
        lineCount: lines.length,
      })
    }

    // Main thread only
    const mainRecords = records.filter((r) => !r.isSidechain).filter((r) => r.uuid)

    // Total count BEFORE slicing — clients need this for pagination UI
    const totalCount = mainRecords.length

    // Apply paging window. The most useful default for the dashboard is
    // "last N messages" since that's what the user is looking at, so when
    // a limit is given without an explicit offset we slice from the END.
    let windowStart = 0
    let windowEnd = mainRecords.length
    if (typeof limit === 'number' && limit > 0) {
      if (offset > 0) {
        windowStart = offset
        windowEnd = offset + limit
      } else {
        windowStart = Math.max(0, mainRecords.length - limit)
        windowEnd = mainRecords.length
      }
    }

    const messages = mainRecords
      .slice(windowStart, windowEnd)
      .map((r) => {
        if (r.type === 'assistant') {
          const usage = r.message?.usage
            ? {
                input: r.message.usage.input_tokens || 0,
                output: r.message.usage.output_tokens || 0,
                cacheRead: r.message.usage.cache_read_input_tokens || 0,
                cacheWrite: r.message.usage.cache_creation_input_tokens || 0,
              }
            : null

          return {
            uuid: r.uuid,
            type: 'assistant',
            timestamp: r.timestamp,
            model: r.message?.model || null,
            usage,
            blocks: redactBlocks(mapAssistantBlocks(r.message?.content)),
          }
        }

        if (r.type === 'user') {
          return {
            uuid: r.uuid,
            type: 'user',
            timestamp: r.timestamp,
            blocks: redactBlocks(mapUserBlocks(r.message?.content)),
          }
        }

        return null
      })
      .filter(Boolean)

    return {
      sessionId,
      messages,
      totalCount,
      offset: windowStart,
      // hasMore is true if ANY records were excluded — either older
      // (windowStart > 0, the common "last N" slice case) OR newer
      // (windowEnd < totalCount, the offset paging case). The previous
      // version only checked the offset case, so a default last-N
      // request always reported hasMore=false even when 1,800+ older
      // messages had been excluded.
      hasMore: windowStart > 0 || windowEnd < totalCount,
    }
  } catch {
    return null
  }
}
