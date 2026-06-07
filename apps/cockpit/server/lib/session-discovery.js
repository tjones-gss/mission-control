import fs from 'fs'
import path from 'path'
import os from 'os'

// Neutral discovery primitive: which working directories have Claude Code
// sessions? Both the harness parser (to find governed projects) and the
// conductor parser (to find ADR-driven runs) build on this. It lives here — in
// a feature-agnostic lib module — rather than inside either feature's parser, so
// neither feature secretly depends on the other for its project discovery.
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const CWD_SCAN_BYTES = 8192

// Extract `cwd` from a session JSONL by scanning the first ~8KB. The first
// line is often a `last-prompt` or `ai-title` metadata stub without `cwd`;
// `cwd` lives on the conversation records that follow. Reading the full file
// the way parsers/sessions.js does is too expensive for hundreds of sessions,
// so we slurp a fixed prefix and parse line-by-line until we hit a record
// with `cwd`. If 8KB doesn't cover it, the session is pathological and we
// drop it — that's strictly better than reading every record.
function readSessionCwd(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(CWD_SCAN_BYTES)
    const bytes = fs.readSync(fd, buf, 0, CWD_SCAN_BYTES, 0)
    const text = buf.toString('utf-8', 0, bytes)
    // Drop the trailing partial line — it could be a half-written record
    // we're racing the writer for. The leading complete lines are safe.
    const lines = text.split('\n').slice(0, -1)
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.cwd === 'string') return rec.cwd
      } catch {
        // Skip malformed records; the prefix may still contain a valid one.
      }
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

// All distinct session working directories under ~/.claude/projects. Tolerant:
// any scan failure yields [] rather than throwing.
export function getSessionCwds() {
  if (!fs.existsSync(CLAUDE_PROJECTS)) return []
  const cwds = new Set()
  let projectDirs = []
  try {
    projectDirs = fs
      .readdirSync(CLAUDE_PROJECTS, { withFileTypes: true })
      .filter((d) => d.isDirectory())
  } catch {
    return []
  }
  for (const pd of projectDirs) {
    const dir = path.join(CLAUDE_PROJECTS, pd.name)
    let files = []
    try {
      files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const f of files) {
      const cwd = readSessionCwd(path.join(dir, f))
      if (cwd) cwds.add(cwd)
    }
  }
  return [...cwds]
}
