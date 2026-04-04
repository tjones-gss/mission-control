import fs from 'fs'
import path from 'path'
import os from 'os'
import { config } from '../lib/config.js'
import { redact, hasSecrets } from '../utils/secretScanner.js'

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

export function getSessionMessages(sessionId) {
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

    // Main thread only
    const mainRecords = records.filter((r) => !r.isSidechain)

    const messages = mainRecords
      .filter((r) => r.uuid) // skip metadata/summary lines without uuid
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

    return { sessionId, messages }
  } catch {
    return null
  }
}
