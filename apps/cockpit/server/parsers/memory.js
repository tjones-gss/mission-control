import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

// Parse simple YAML-ish frontmatter from markdown (between --- delimiters).
// Returns { frontmatter: { key: value, ... } | null, body: string }
export function parseFrontmatter(content) {
  if (!content || typeof content !== 'string') {
    return { frontmatter: null, body: content || '' }
  }

  const trimmed = content.trimStart()
  if (!trimmed.startsWith('---')) {
    return { frontmatter: null, body: content }
  }

  // Find the closing ---
  const endIndex = trimmed.indexOf('---', 3)
  if (endIndex === -1) {
    return { frontmatter: null, body: content }
  }

  const fmBlock = trimmed.slice(3, endIndex).trim()
  const body = trimmed.slice(endIndex + 3).trimStart()

  const frontmatter = {}
  for (const line of fmBlock.split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const value = line.slice(colonIdx + 1).trim()
    if (key) frontmatter[key] = value
  }

  return { frontmatter, body }
}

// Find the project dir name that contains a given session JSONL file.
function findProjectDirForSession(sessionId) {
  if (!fs.existsSync(PROJECTS_DIR)) return null

  const projectDirs = fs
    .readdirSync(PROJECTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const dir of projectDirs) {
    const sessionFile = path.join(PROJECTS_DIR, dir.name, `${sessionId}.jsonl`)
    if (fs.existsSync(sessionFile)) {
      return dir.name
    }
  }

  return null
}

// Read the session's cwd from its JSONL file (first record with a cwd field).
//
// Returns { cwd, degraded }:
//   - cwd: the resolved working directory, or null.
//   - degraded: true when the file was PRESENT with non-empty lines but NONE
//     parsed — the JSONL shape likely changed under us. A valid JSONL that
//     simply lacks a cwd record is NOT degraded (cwd:null, degraded:false).
function getSessionCwd(projectDirName, sessionId) {
  const filePath = path.join(PROJECTS_DIR, projectDirName, `${sessionId}.jsonl`)
  let content
  try {
    content = fs.readFileSync(filePath, 'utf-8')
  } catch {
    // File unreadable/absent — normal; nothing to surface.
    return { cwd: null, degraded: false }
  }
  const lines = content.trim().split('\n').filter(Boolean)
  if (lines.length === 0) {
    // Present-but-empty session file — normal.
    return { cwd: null, degraded: false }
  }
  let parsedAny = false
  for (const line of lines) {
    try {
      const record = JSON.parse(line)
      parsedAny = true
      if (record.cwd) return { cwd: record.cwd, degraded: false }
    } catch {
      /* skip unparseable lines; a later line may still parse */
    }
  }
  if (!parsedAny) {
    // Lines present but none parsed → format drift. Surface it (deduped) so the
    // project's CLAUDE.md/memory doesn't silently vanish with no explanation.
    signalDegraded('memory', 'session-jsonl-unparseable', {
      filePath,
      lineCount: lines.length,
    })
    return { cwd: null, degraded: true }
  }
  return { cwd: null, degraded: false }
}

// Safely read a file and return { content, path, lastModified } or null.
function readFileInfo(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null
    const stat = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    return { content, path: filePath, lastModified: stat.mtimeMs }
  } catch {
    return null
  }
}

// Get all memory/CLAUDE.md data associated with a session.
// Returns { global, project, memories, memoryIndex }
export function getMemoryForSession(sessionId) {
  // 1. Find the session's project dir
  const projectDirName = findProjectDirForSession(sessionId)
  if (!projectDirName) return null

  // 2. Read the session's cwd from the JSONL
  const { cwd, degraded } = getSessionCwd(projectDirName, sessionId)

  // 3. Read global CLAUDE.md
  const globalClaudeMd = readFileInfo(path.join(CLAUDE_DIR, 'CLAUDE.md'))

  // 4. Read project CLAUDE.md files
  const project = []
  if (cwd) {
    const rootClaudeMd = readFileInfo(path.join(cwd, 'CLAUDE.md'))
    if (rootClaudeMd) project.push(rootClaudeMd)

    const dotClaudeMd = readFileInfo(path.join(cwd, '.claude', 'CLAUDE.md'))
    if (dotClaudeMd) project.push(dotClaudeMd)
  }

  // 5. Read memory files
  const memoryDir = path.join(PROJECTS_DIR, projectDirName, 'memory')
  const memories = []
  try {
    if (fs.existsSync(memoryDir)) {
      const files = fs.readdirSync(memoryDir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')

      for (const file of files) {
        const filePath = path.join(memoryDir, file)
        const info = readFileInfo(filePath)
        if (info) {
          const { frontmatter, body } = parseFrontmatter(info.content)
          memories.push({
            filename: file,
            frontmatter,
            body,
            path: info.path,
            lastModified: info.lastModified,
          })
        }
      }
    }
  } catch {
    /* memory dir unreadable */
  }

  // 6. Read memory index
  const memoryIndex = readFileInfo(path.join(memoryDir, 'MEMORY.md'))

  return {
    global: globalClaudeMd,
    project,
    memories,
    memoryIndex,
    // True when the session JSONL was present but unparseable, so the resolved
    // cwd (and therefore project-level CLAUDE.md/memory) may be missing. The UI
    // can distinguish this from "this session genuinely has no project memory."
    degraded,
  }
}
