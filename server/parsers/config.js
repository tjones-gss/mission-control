import fs from 'fs'
import path from 'path'
import os from 'os'

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
 * Safely read and parse a JSON file. Returns {} if the file is missing or malformed.
 */
function readJsonSafe(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/**
 * Read and merge config from all 3 levels for a given working directory.
 * Returns { merged, sources, files }.
 */
export function getConfigForSession(cwd) {
  const projectConfig = path.join(cwd, '.claude', 'settings.json')
  const localConfig = path.join(cwd, '.claude', 'settings.local.json')

  const user = readJsonSafe(USER_CONFIG)
  const project = readJsonSafe(projectConfig)
  const local = readJsonSafe(localConfig)

  const merged = deepMerge(deepMerge(user, project), local)
  const sources = trackSources(user, project, local)

  return {
    merged,
    sources,
    files: [
      { level: 'user', path: USER_CONFIG, exists: fileExists(USER_CONFIG) },
      { level: 'project', path: projectConfig, exists: fileExists(projectConfig) },
      { level: 'local', path: localConfig, exists: fileExists(localConfig) },
    ],
  }
}

/**
 * Read just the user-level config (~/.claude/settings.json).
 */
export function getUserConfig() {
  return readJsonSafe(USER_CONFIG)
}

function fileExists(filePath) {
  try {
    fs.accessSync(filePath)
    return true
  } catch {
    return false
  }
}
