import fs from 'fs'
import path from 'path'
import os from 'os'

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
  const all = getAllSessions()
  return all.find(s => s.sessionId === sessionId) || null
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

    // Build agent tree from isSidechain + parentUuid
    const agentTree = buildAgentTree(records)

    // Project name from encoded dir name (replace -- with / and - with \)
    const projectName = decodeProjectDir(projectDirName)

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
    }
  } catch {
    return null
  }
}

function buildAgentTree(records) {
  // Main thread = isSidechain false, subagents = isSidechain true
  const mainMessages = records.filter(r => !r.isSidechain)
  const sidechain = records.filter(r => r.isSidechain)

  // Find unique subagent identifiers via toolUseID grouping
  const subagentGroups = {}
  for (const r of sidechain) {
    const key = r.parentToolUseID || r.toolUseID || 'unknown'
    if (!subagentGroups[key]) subagentGroups[key] = []
    subagentGroups[key].push(r)
  }

  const subagents = Object.entries(subagentGroups).map(([toolUseId, msgs]) => {
    const first = msgs[0]
    const last = msgs[msgs.length - 1]
    const assistantMsg = msgs.find(m => m.type === 'assistant')
    const description = extractSubagentDescription(msgs)
    return {
      toolUseId,
      description,
      messageCount: msgs.length,
      startTime: first.timestamp,
      endTime: last.timestamp,
      model: assistantMsg?.message?.model || null,
    }
  })

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
