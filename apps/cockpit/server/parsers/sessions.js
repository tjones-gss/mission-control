import fs from 'fs'
import path from 'path'
import os from 'os'
import { calculateCost } from '../utils/cost.js'
import { signalDegraded } from '../lib/claude-format.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects')
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes
const ABANDONED_THRESHOLD_MS = 4 * 60 * 60 * 1000 // 4 hours

/**
 * ADR-0008: isActive/needsInput are functions of Date.now(), so a cached
 * summary can never serve them verbatim — the SQLite session index recomputes
 * them at read time through this same pure helper the parser uses.
 *
 * A session "needs input" only if (a) it's not currently active, (b) it was
 * modified within the abandoned threshold, AND (c) the very last main-thread
 * record was an assistant message with stop_reason === 'end_turn'
 * (lastMainEndTurn). See the needsInput history note in parseSessionFile.
 */
export function computeSessionTimeFields(lastModified, lastMainEndTurn, now = Date.now()) {
  const isActive = now - lastModified < ACTIVE_THRESHOLD_MS
  const needsInput =
    !isActive && now - lastModified < ABANDONED_THRESHOLD_MS && Boolean(lastMainEndTurn)
  return { isActive, needsInput }
}

/**
 * One-line summary of a tool_use input — the canonical shape used both for a
 * session's lastAction and (ADR-0008 Phase 2) the searchable tool-input docs
 * in the message index. Keep the two surfaces identical by construction.
 */
export function summarizeToolUse(name, input = {}) {
  if (name === 'Bash') return (input.command || '').slice(0, 80)
  if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(name)) return input.file_path || ''
  if (name === 'Agent') return (input.prompt || '').slice(0, 60)
  if (name === 'Skill') return input.skill || ''
  return String(Object.values(input)[0] || '').slice(0, 80)
}

export function getAllSessions() {
  const sessions = []
  if (!fs.existsSync(CLAUDE_DIR)) return sessions

  // Wrap each readdirSync in try/catch — chokidar may rename/delete files
  // mid-scan, and a single ENOENT/EBUSY would otherwise bubble up and turn
  // GET /api/sessions into a 500. We'd rather show a partial list.
  let projectDirs = []
  try {
    projectDirs = fs.readdirSync(CLAUDE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {
    return sessions
  }

  for (const projectDir of projectDirs) {
    const projectPath = path.join(CLAUDE_DIR, projectDir.name)
    let jsonlFiles = []
    try {
      jsonlFiles = fs.readdirSync(projectPath).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }

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
  const projectDirs = fs
    .readdirSync(CLAUDE_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  const targetFile = `${sessionId}.jsonl`
  for (const projectDir of projectDirs) {
    const filePath = path.join(CLAUDE_DIR, projectDir.name, targetFile)
    if (fs.existsSync(filePath)) {
      return parseSessionFile(filePath, projectDir.name, targetFile)
    }
  }

  return null
}

/**
 * ADR-0008: parse a session file straight from its path, returning both the
 * summary (the verbatim shape parseSessionFile produces — what the session
 * index stores as summary_json), the raw lastMainEndTurn signal the index
 * needs to recompute needsInput at read time, and the parsed records so the
 * message index (Phase 2) can reindex without a second file read. Returns
 * null for unparseable or metadata-only files, same as parseSessionFile.
 */
export function parseSessionRecord(filePath) {
  const filename = path.basename(filePath)
  const projectDirName = path.basename(path.dirname(filePath))
  return parseSessionFileDetailed(filePath, projectDirName, filename)
}

function parseSessionFile(filePath, projectDirName, filename) {
  const parsed = parseSessionFileDetailed(filePath, projectDirName, filename)
  return parsed ? parsed.summary : null
}

function parseSessionFileDetailed(filePath, projectDirName, filename) {
  try {
    const stat = fs.statSync(filePath)
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

    if (records.length === 0) {
      // Lines present but none parsed → the JSONL shape likely changed under us
      // (an empty file, by contrast, yields zero lines and is unremarkable).
      // Surface this as a PERSISTENT degraded signal (deduped per process) so
      // the dashboard can show a banner instead of silently rendering an empty
      // session list with no clue why.
      if (lines.length > 0) {
        signalDegraded('sessions', 'format-change', {
          filePath,
          lineCount: lines.length,
        })
      }
      return null
    }
    // Claude writes metadata-only JSONL files (e.g. ai-title stubs) that are
    // not real conversations. Ignore those so they do not flood the dashboard.
    const hasConversation = records.some(isConversationRecord)
    if (!hasConversation) return null

    const sessionId = filename.replace('.jsonl', '')
    const slug = records.find((r) => r.slug)?.slug || null
    const cwd = records.find((r) => r.cwd)?.cwd || null
    const version = records.find((r) => r.version)?.version || null
    const firstTimestamp = records[0]?.timestamp
    const lastModified = stat.mtimeMs

    // Build agent tree from isSidechain + parentUuid + meta files
    const subagentsDir = path.join(path.dirname(filePath), sessionId, 'subagents')
    const agentTree = buildAgentTree(records, subagentsDir)

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
        const text =
          typeof r.message === 'string'
            ? r.message
            : typeof r.message?.content === 'string'
              ? r.message.content
              : Array.isArray(r.message?.content)
                ? r.message.content.find((b) => b.type === 'text')?.text || ''
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
            lastAction = {
              name: block.name,
              summary: summarizeToolUse(block.name, block.input || {}),
            }
          }
          if (!lastText && block.type === 'text') {
            lastText = (block.text || '').slice(0, 250)
          }
        }
      }
      if (lastThought && lastAction && lastText && model) break
    }

    // Detect if session is waiting for human input.
    //
    // Two earlier bugs caused the dashboard to fire false-positive
    // "session needs your input" notifications constantly:
    //
    //   1. The previous heuristic flagged ANY assistant message with
    //      tool_use blocks as needsInput=true. But tool_use means the
    //      assistant is mid-turn, waiting for tool RESULTS, not for the
    //      user. The correct stop_reason for "waiting on user" is
    //      'end_turn'; tool_use turns produce stop_reason='tool_use'.
    //
    //   2. needsInput could be true even on an isActive session, which
    //      is contradictory — an active session is currently running, so
    //      it cannot also be waiting for the user. We now require !isActive.
    //
    // The raw signal (lastMainEndTurn: the very last main-thread record is an
    // assistant message with stop_reason === 'end_turn') is extracted here;
    // the time gating lives in computeSessionTimeFields so the session index
    // can recompute isActive/needsInput at read time (ADR-0008).
    let lastMainEndTurn = false
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i]
      if (r.isSidechain) continue
      if (r.type === 'assistant') {
        const stopReason = r.message?.stop_reason || r.stop_reason
        if (stopReason === 'end_turn') {
          lastMainEndTurn = true
        }
      }
      break // only check the very last main-thread record
    }
    const { isActive, needsInput } = computeSessionTimeFields(lastModified, lastMainEndTurn)

    const summary = {
      sessionId,
      slug,
      cwd,
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
    return { summary, lastMainEndTurn, records }
  } catch {
    return null
  }
}

function isConversationRecord(record) {
  if (!record || typeof record !== 'object') return false
  if (record.type === 'user' || record.type === 'assistant' || record.type === 'system') return true
  const role = record.role || record.message?.role
  return role === 'user' || role === 'assistant' || role === 'system'
}

function buildAgentTree(records, subagentsDir) {
  // Main thread = isSidechain false, subagents = isSidechain true
  const mainMessages = records.filter((r) => !r.isSidechain)
  const sidechain = records.filter((r) => r.isSidechain)

  // Load subagent meta files for type enrichment
  const metaByAgent = {}
  try {
    if (subagentsDir && fs.existsSync(subagentsDir)) {
      const metaFiles = fs.readdirSync(subagentsDir).filter((f) => f.endsWith('.meta.json'))
      for (const mf of metaFiles) {
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(subagentsDir, mf), 'utf-8'))
          // agent-a1234.meta.json -> a1234 as a potential toolUseId match key
          const agentId = mf.replace('.meta.json', '').replace('agent-', '')
          metaByAgent[agentId] = meta
        } catch {
          /* skip unreadable meta files */
        }
      }
    }
  } catch {
    /* subagents dir doesn't exist or can't be read */
  }

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
    const assistantMsg = msgs.find((m) => m.type === 'assistant')
    const description = extractSubagentDescription(msgs)

    // Match meta by toolUseId substring (meta agentId is often a prefix of the toolUseId)
    const matchedMeta =
      metaByAgent[toolUseId] ||
      metaAgentIds.reduce(
        (found, id) => found || (toolUseId.includes(id) ? metaByAgent[id] : null),
        null,
      )

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
  const userMsg = msgs.find((m) => m.type === 'user')
  if (!userMsg) return 'Subagent'
  const content = userMsg.message?.content
  if (typeof content === 'string') return content.slice(0, 80)
  if (Array.isArray(content)) {
    const textBlock = content.find((b) => b.type === 'text')
    return textBlock?.text?.slice(0, 80) || 'Subagent'
  }
  return 'Subagent'
}
