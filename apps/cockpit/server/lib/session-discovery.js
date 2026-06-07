import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from './claude-format.js'

// Neutral discovery primitive: which working directories have Claude Code
// sessions? Both the harness parser (to find governed projects) and the
// conductor parser (to find ADR-driven runs) build on this. It lives here — in
// a feature-agnostic lib module — rather than inside either feature's parser, so
// neither feature secretly depends on the other for its project discovery.
const CLAUDE_PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const CWD_SCAN_BYTES = 8192

// Sentinel returned when the prefix scan READ bytes (a real, non-empty file)
// and found complete lines, but none carried a `cwd`. Distinct from null (file
// empty/unreadable) so the caller can flag the scan-miss as a degraded signal
// instead of silently dropping the project.
const SCAN_MISS = Symbol('cwd-scan-miss')

// Extract `cwd` from a session JSONL by scanning the first ~8KB. The first
// line is often a `last-prompt` or `ai-title` metadata stub without `cwd`;
// `cwd` lives on the conversation records that follow. Reading the full file
// the way parsers/sessions.js does is too expensive for hundreds of sessions,
// so we slurp a fixed prefix and parse line-by-line until we hit a record
// with `cwd`. If 8KB doesn't cover it, that's a SCAN_MISS — surfaced as a
// degraded diagnostic rather than a silent drop.
function readSessionCwd(filePath) {
  let fd
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(CWD_SCAN_BYTES)
    const bytes = fs.readSync(fd, buf, 0, CWD_SCAN_BYTES, 0)
    if (!bytes) return null // empty file — normal, nothing to scan
    const text = buf.toString('utf-8', 0, bytes)
    // Drop the trailing partial line — it could be a half-written record
    // we're racing the writer for. The leading complete lines are safe.
    const lines = text.split('\n').slice(0, -1)
    let sawCompleteLine = false
    for (const line of lines) {
      if (!line.trim()) continue
      sawCompleteLine = true
      try {
        const rec = JSON.parse(line)
        if (rec && typeof rec.cwd === 'string') return rec.cwd
      } catch {
        // Skip malformed records; the prefix may still contain a valid one.
      }
    }
    // Real content, complete lines, but no cwd in the first 8KB → a miss, not
    // an empty file. The session vanishes from discovery; flag why.
    return sawCompleteLine ? SCAN_MISS : null
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
      const filePath = path.join(dir, f)
      const cwd = readSessionCwd(filePath)
      if (cwd === SCAN_MISS) {
        // A non-empty session whose cwd fell outside the fixed 8KB prefix is a
        // diagnostic blind spot, not a fact. Surface it (deduped) rather than
        // silently omitting the project.
        signalDegraded('session-discovery', 'cwd-scan-miss', {
          filePath,
          scanBytes: CWD_SCAN_BYTES,
        })
      } else if (cwd) {
        cwds.add(cwd)
      }
    }
  }
  return [...cwds]
}
