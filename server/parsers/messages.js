import fs from 'fs'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')

function findSessionFile(sessionId) {
  if (!fs.existsSync(CLAUDE_DIR)) return null

  const projectDirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

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
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
  }
  return String(content ?? '')
}

function mapAssistantBlocks(content) {
  if (!Array.isArray(content)) return []

  return content.map(block => {
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
  }).filter(Boolean)
}

function mapUserBlocks(content) {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }

  if (!Array.isArray(content)) return []

  return content.map(block => {
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
  }).filter(Boolean)
}

export function getSessionMessages(sessionId) {
  try {
    const filePath = findSessionFile(sessionId)
    if (!filePath) return null

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const records = lines
      .map(l => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)

    // Main thread only
    const mainRecords = records.filter(r => !r.isSidechain)

    const messages = mainRecords
      .filter(r => r.uuid) // skip metadata/summary lines without uuid
      .map(r => {
        if (r.type === 'assistant') {
          return {
            uuid: r.uuid,
            type: 'assistant',
            timestamp: r.timestamp,
            model: r.message?.model || null,
            blocks: mapAssistantBlocks(r.message?.content),
          }
        }

        if (r.type === 'user') {
          return {
            uuid: r.uuid,
            type: 'user',
            timestamp: r.timestamp,
            blocks: mapUserBlocks(r.message?.content),
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
