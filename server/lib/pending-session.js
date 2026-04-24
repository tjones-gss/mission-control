import fs from 'fs'
import path from 'path'
import os from 'os'
import { onEvent } from '../sse.js'
import { logger } from './logger.js'

const PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects')
const IS_WIN32 = process.platform === 'win32'

/**
 * Encode a filesystem CWD path to the encoded project-dir name that Claude
 * uses under ~/.claude/projects/.
 *
 * Forward-encoding (inverse of decodeProjectDir in parsers/sessions.js):
 *   Windows: C:\Users\foo\bar  →  C--Users-foo-bar
 *   POSIX:   /Users/foo/bar    →  -Users-foo-bar
 *
 * Rules:
 *   - On Windows, the drive letter and its colon are kept, the colon becomes
 *     nothing (dropped), the first backslash becomes --, remaining separators
 *     become -.  e.g. C:\ → C--, then each \ → -
 *   - On POSIX, the leading / becomes -, then each / → -
 */
export function encodeProjectDir(cwd) {
  if (IS_WIN32) {
    // Normalise to forward slashes first so we only deal with one separator type.
    const norm = cwd.replace(/\\/g, '/')
    // norm looks like "C:/Users/foo/bar"
    const driveMatch = norm.match(/^([A-Za-z]):\/(.*)$/)
    if (driveMatch) {
      const driveLetter = driveMatch[1]
      const rest = driveMatch[2].replace(/\//g, '-')
      return `${driveLetter}--${rest}`
    }
    // UNC or other format — fall through to POSIX-style
    return norm.replace(/^\//, '-').replace(/\//g, '-')
  }
  // POSIX
  return cwd.replace(/^\//, '-').replace(/\//g, '-')
}

/**
 * Read all existing JSONL session IDs inside the encoded project directory for
 * a given cwd. Returns a Set<string> of session IDs (without .jsonl suffix).
 *
 * Exported as an internal helper so tests can spy/mock the filesystem read.
 */
export function _existingSessionIdsInCwd(cwd) {
  const encoded = encodeProjectDir(cwd)
  const ids = new Set()

  // On Windows match case-insensitively
  let targetDir = null
  try {
    const entries = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const match = IS_WIN32
        ? entry.name.toLowerCase() === encoded.toLowerCase()
        : entry.name === encoded
      if (match) {
        targetDir = path.join(PROJECTS_DIR, entry.name)
        break
      }
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.warn({ err, dir: PROJECTS_DIR }, 'pending_session_projects_read_failed')
    }
    return ids
  }

  if (!targetDir) return ids

  try {
    for (const f of fs.readdirSync(targetDir)) {
      if (f.endsWith('.jsonl')) ids.add(f.slice(0, -6))
    }
  } catch {
    /* ignore */
  }

  return ids
}

/**
 * Subscribe to SSE new_session events and resolve with the sessionId of the
 * first new JSONL file that appears inside the watch-dir for the given cwd.
 *
 * Snapshots existing IDs at subscribe time so a pre-existing file does not
 * resolve the promise for the wrong spawn.
 *
 * @param {string} cwd - The working directory passed to the new-session CLI spawn.
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<string>} Resolves with the new sessionId string.
 */
export function awaitNewSession(cwd, { timeoutMs = 15_000 } = {}) {
  const encodedCwd = encodeProjectDir(cwd)
  const existingIds = _existingSessionIdsInCwd(cwd)

  return new Promise((resolve, reject) => {
    let done = false
    let timer = null
    let removeListener = null

    function cleanup() {
      done = true
      clearTimeout(timer)
      if (removeListener) removeListener()
    }

    removeListener = onEvent((event, data) => {
      if (done) return
      if (event !== 'new_session') return
      if (!data?.filePath) return

      // filePath is relative to ~/.claude, e.g. "projects/<encodedDir>/<id>.jsonl"
      // Normalise to forward slashes for consistent splitting on Windows
      const parts = data.filePath.replace(/\\/g, '/').split('/')
      // Expect exactly ["projects", "<encodedDir>", "<id>.jsonl"]
      if (parts.length < 3 || parts[0] !== 'projects') return

      const eventEncodedDir = parts[1]
      const dirMatch = IS_WIN32
        ? eventEncodedDir.toLowerCase() === encodedCwd.toLowerCase()
        : eventEncodedDir === encodedCwd
      if (!dirMatch) return

      const sessionId = parts[parts.length - 1].replace(/\.jsonl$/, '')
      if (!sessionId) return

      // Ignore sessions that already existed before this spawn
      if (existingIds.has(sessionId)) return

      cleanup()
      resolve(sessionId)
    })

    timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout_waiting_for_session'))
    }, timeoutMs)
  })
}
