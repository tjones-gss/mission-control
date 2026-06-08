import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const USER_CONFIG = path.join(os.homedir(), '.claude', 'settings.json')

/**
 * Deep merge b into a, returning a new object. b values win.
 * Arrays are replaced (not concatenated).
 */
export function deepMerge(a, b) {
  const result = { ...a }
  for (const key of Object.keys(b)) {
    if (
      b[key] !== null &&
      typeof b[key] === 'object' &&
      !Array.isArray(b[key]) &&
      a[key] !== null &&
      typeof a[key] === 'object' &&
      !Array.isArray(a[key])
    ) {
      result[key] = deepMerge(a[key], b[key])
    } else {
      result[key] = b[key]
    }
  }
  return result
}

/**
 * Track which source each top-level key came from.
 * Returns { key: 'user'|'project'|'local' } based on which level set each key last.
 */
export function trackSources(userConfig, projectConfig, localConfig) {
  const sources = {}
  for (const key of Object.keys(userConfig)) {
    sources[key] = 'user'
  }
  for (const key of Object.keys(projectConfig)) {
    sources[key] = 'project'
  }
  for (const key of Object.keys(localConfig)) {
    sources[key] = 'local'
  }
  return sources
}

/**
 * Read + parse a config JSON file, distinguishing ABSENT (missing — normal,
 * yields {}) from PRESENT-BUT-UNPARSEABLE (degraded). On degradation it emits a
 * persistent parser_degraded SSE event and reports it via `degraded:true` so
 * the caller never silently treats a broken settings.json as "none
 * configured" — which would misreport the safety posture as "no guardrails."
 *
 * @param {string} level  'user' | 'project' | 'local' (for the SSE detail)
 * @param {string} filePath
 * @returns {{ value: object, degraded: boolean }}
 */
function readConfigLevel(level, filePath) {
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    // ENOENT / unreadable — absent. Normal: nothing configured at this level.
    return { value: {}, degraded: false }
  }
  if (!raw || !raw.trim()) {
    return { value: {}, degraded: false }
  }
  try {
    const parsed = JSON.parse(raw)
    return { value: parsed && typeof parsed === 'object' ? parsed : {}, degraded: false }
  } catch {
    // Present but unparseable → degraded, NOT "none configured".
    signalDegraded('config', 'parse-failed', { level, filePath })
    return { value: {}, degraded: true }
  }
}

/**
 * Read and merge config from all 3 levels for a given working directory.
 * Returns { merged, sources, files }. Each file entry carries a `degraded` flag
 * when that level was present-but-unparseable, so the UI can distinguish a
 * broken settings.json from one that simply isn't there.
 */
export function getConfigForSession(cwd) {
  const projectConfig = path.join(cwd, '.claude', 'settings.json')
  const localConfig = path.join(cwd, '.claude', 'settings.local.json')

  const userRead = readConfigLevel('user', USER_CONFIG)
  const projectRead = readConfigLevel('project', projectConfig)
  const localRead = readConfigLevel('local', localConfig)

  const user = userRead.value
  const project = projectRead.value
  const local = localRead.value

  const merged = deepMerge(deepMerge(user, project), local)
  const sources = trackSources(user, project, local)

  return {
    merged,
    sources,
    files: [
      {
        level: 'user',
        path: USER_CONFIG,
        exists: fileExists(USER_CONFIG),
        degraded: userRead.degraded,
      },
      {
        level: 'project',
        path: projectConfig,
        exists: fileExists(projectConfig),
        degraded: projectRead.degraded,
      },
      {
        level: 'local',
        path: localConfig,
        exists: fileExists(localConfig),
        degraded: localRead.degraded,
      },
    ],
  }
}

/**
 * Read just the user-level config (~/.claude/settings.json). Returns {} when
 * absent (normal), or a degraded marker (NOT a bare {}) when present-but-
 * unparseable so callers reading the safety posture never mistake a broken
 * file for "no guardrails configured."
 */
export function getUserConfig() {
  let raw
  try {
    raw = fs.readFileSync(USER_CONFIG, 'utf-8')
  } catch {
    return {}
  }
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return signalDegraded('config', 'parse-failed', { level: 'user', filePath: USER_CONFIG })
  }
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath)
    return true
  } catch {
    return false
  }
}
