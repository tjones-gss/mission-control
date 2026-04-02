import fs from 'fs'
import path from 'path'
import os from 'os'
import { calculateCost } from '../utils/cost.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

export function getAllSessions() {
  const sessions = []
  if (!fs.existsSync(CLAUDE_DIR)) return sessions

  const projectDirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

  for (const projectDir of projectDirs) {
    const projectPath = path.join(CLAUDE_DIR, projectDir.name)
    const jsonlFiles = fs.readdirSync(projectPath)
      .filter(f => f.endsWith('.jsonl'))

    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file)
      const session = parseSessionFile(filePath, projectDir.name, file)
      if (session) sessions.push(session)
    }
  }

  return sessions.sort((a, b) => b.lastModified - a.lastModified)
}

export function getSessionById(sessionId) {
  if (!fs.existsSync(CLAUDE_DIR)) return null

  // Search project dirs for the specific session file instead of parsing everything
  const projectDirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())

  const targetFile = `${sessionId}.jsonl`
  for (const projectDir of projectDirs) {
    const filePath = path.join(CLAUDE_DIR, projectDir.name, targetFile)
    if (fs.existsSync(filePath)) {
      return parseSessionFile(filePath, projectDir.name, targetFile)
    }
  }

  return null
}

function parseSessionFile(filePath, projectDirName, filename) {
  try {
    const stat = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const records = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

    if (records.length === 0) return null

    const sessionId = filename.replace('.jsonl', '')
    const slug = records.find(r => r.slug)?.slug || null
    const cwd = records.find(r => r.cwd)?.cwd || null
    const version = records.find(r => r.version)?.version || null
    const firstTimestamp = records[0]?.timestamp
    const lastModified = stat.mtimeMs
    const isActive = (Date.now() - lastModified) < ACTIVE_THRESHOLD_MS

    // Build agent tree from isSidechain + parentUuid + meta files
    const subagentsDir = path.join(path.dirname(filePath), sessionId, 'subagents')
    const agentTree = buildAgentTree(records, subagentsDir)

    // Project name from encoded dir name (replace -- with / and - with \)
    const projectName = decodeProjectDir(projectDirName)

    // Extract rich spy data from records
    let lastThought = null
    let lastAction = null
    let lastText = null
    let model = null
    let gitBranch = null
    let permissionMode = null
    let hasBeenCompacted = false
    let compactionSummary = null
    const toolUseCounts = {}
    const tokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

    // Sum token usage across all assistant records
    for (const r of records) {
      if (r.message?.usage) {
        tokenUsage.input += r.message.usage.input_tokens || 0
        tokenUsage.output += r.message.usage.output_tokens || 0
        tokenUsage.cacheRead += r.message.usage.cache_read_input_tokens || 0
        tokenUsage.cacheWrite += r.message.usage.cache_creation_input_tokens || 0
      }
      // Count tool_use blocks across ALL assistant messages
      if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
        for (const block of r.message.content) {
          if (block.type === 'tool_use') {
            toolUseCounts[block.name] = (toolUseCounts[block.name] || 0) + 1
          }
        }
      }
      // Collect gitBranch from any record
      if (r.gitBranch) gitBranch = r.gitBranch
      // Track most recent permissionMode from user records
      if (r.type === 'user' && r.permissionMode) {
        permissionMode = r.permissionMode
      }
      // Detect compaction via system message preamble
      if (r.type === 'system' || r.role === 'system') {
        const text = typeof r.message === 'string' ? r.message
          : typeof r.message?.content === 'string' ? r.message.content
          : Array.isArray(r.message?.content) ? r.message.content.find(b => b.type === 'text')?.text || ''
          : ''
        if (text.includes('continued from a previous conversation')) {
          hasBeenCompacted = true
          compactionSummary = text.slice(0, 500)
        }
      }
    }

    // Iterate in reverse for "most recent" fields
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i]
      if (r.type === 'assistant' && Array.isArray(r.message?.content)) {
        if (!model && r.message.model) model = r.message.model
        for (const block of r.message.content) {
          if (!lastThought && block.type === 'thinking') {
            lastThought = (block.thinking || '').slice(0, 350)
          }
          if (!lastAction && block.type === 'tool_use') {
            const inp = block.input || {}
            let summary
            if (block.name === 'Bash') summary = (inp.command || '').slice(0, 80)
            else if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(block.name)) summary = inp.file_path || ''
            else if (block.name === 'Agent') summary = (inp.prompt || '').slice(0, 60)
            else if (block.name === 'Skill') summary = inp.skill || ''
            else summary = String(Object.values(inp)[0] || '').slice(0, 80)
            lastAction = { name: block.name, summary }
          }
          if (!lastText && block.type === 'text') {
            lastText = (block.text || '').slice(0, 250)
          }
        }
      }
      if (lastThought && lastAction && lastText && model) break
    }

    // Detect if session is waiting for human input
    const ABANDONED_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours
    let needsInput = false
    if ((Date.now() - lastModified) < ABANDONED_THRESHOLD_MS) {
      // Find the last main-thread record
      for (let i = records.length - 1; i >= 0; i--) {
        const r = records[i]
        if (r.isSidechain) continue
        if (r.type === 'assistant') {
          const stopReason = r.message?.stop_reason || r.stop_reason
          const hasToolUse = Array.isArray(r.message?.content) &&
            r.message.content.some(b => b.type === 'tool_use')
          if (stopReason === 'end_turn' || hasToolUse) {
            needsInput = true
          }
        }
        break // only check the very last main-thread record
      }
    }

    return {
      sessionId,
      slug,
      cwd,
      projectName,
      version,
      firstTimestamp,
      lastModified,
      isActive,
      messageCount: records.length,
      agentTree,
      filePath,
      lastThought,
      lastAction,
      lastText,
      toolUseCounts,
      tokenUsage,
      estimatedCost: calculateCost(tokenUsage, model),
      model,
      gitBranch,
      needsInput,
      permissionMode,
      hasBeenCompacted,
      compactionSummary,
    }
  } catch {
    return null
  }
}

function buildAgentTree(records, subagentsDir) {
  // Main thread = isSidechain false, subagents = isSidechain true
  const mainMessages = records.filter(r => !r.isSidechain)
  const sidechain = records.filter(r => r.isSidechain)

  // Load subagent meta files for type enrichment
  const metaByAgent = {}
  try {
    if (subagentsDir && fs.existsSync(subagentsDir)) {
      const metaFiles = fs.readdirSync(subagentsDir).filter(f => f.endsWith('.meta.json'))
      for (const mf of metaFiles) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, mf), 'utf-8'))
          // agent-a1234.meta.json -> a1234 as a potential toolUseId match key
          const agentId = mf.replace('.meta.json', '').replace('agent-', '')
          metaByAgent[agentId] = meta
        } catch { /* skip unreadable meta files */ }
      }
    }
  } catch { /* subagents dir doesn't exist or can't be read */ }

  // Find unique subagent identifiers via toolUseID grouping
  const subagentGroups = {}
  for (const r of sidechain) {
    const key = r.parentToolUseID || r.toolUseID || 'unknown'
    if (!subagentGroups[key]) subagentGroups[key] = []
    subagentGroups[key].push(r)
  }

  const metaAgentIds = Object.keys(metaByAgent)
  const subagents = Object.entries(subagentGroups).map(([toolUseId, msgs]) => {
    const first = msgs[0]
    const last = msgs[msgs.length - 1]
    const assistantMsg = msgs.find(m => m.type === 'assistant')
    const description = extractSubagentDescription(msgs)

    // Match meta by toolUseId substring (meta agentId is often a prefix of the toolUseId)
    const matchedMeta = metaByAgent[toolUseId]
      || metaAgentIds.reduce((found, id) => found || (toolUseId.includes(id) ? metaByAgent[id] : null), null)

    return {
      toolUseId,
      description: matchedMeta?.description || description,
      agentType: matchedMeta?.agentType || null,
      messageCount: msgs.length,
      startTime: first.timestamp,
      endTime: last.timestamp,
      model: assistantMsg?.message?.model || null,
    }
  })

  // Also add meta-only agents that weren't matched via sidechain records
  const matchedMetaIds = new Set()
  for (const sub of subagents) {
    for (const id of metaAgentIds) {
      if (sub.toolUseId.includes(id) || metaByAgent[id] === sub) {
        matchedMetaIds.add(id)
      }
    }
  }
  for (const [agentId, meta] of Object.entries(metaByAgent)) {
    if (!matchedMetaIds.has(agentId)) {
      subagents.push({
        toolUseId: agentId,
        description: meta.description || 'Subagent',
        agentType: meta.agentType || null,
        messageCount: 0,
        startTime: null,
        endTime: null,
        model: null,
      })
    }
  }

  return {
    mainMessageCount: mainMessages.length,
    subagents,
  }
}

function extractSubagentDescription(msgs) {
  // Try to get the description from the first user message in the sidechain
  const userMsg = msgs.find(m => m.type === 'user')
  if (!userMsg) return 'Subagent'
  const content = userMsg.message?.content
  if (typeof content === 'string') return content.slice(0, 80)
  if (Array.isArray(content)) {
    const textBlock = content.find(b => b.type === 'text')
    return textBlock?.text?.slice(0, 80) || 'Subagent'
  }
  return 'Subagent'
}

function decodeProjectDir(dirName) {
  // C--Users-Travis-Desktop-Projects-foo → C:\Users\Travis\Desktop\Projects\foo
  return dirName.replace(/^([A-Z])--/, '$1:\\').replace(/-/g, '\\')
}
