import fs from 'fs'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks')
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')

export function getHooksConfig() {
  const config = readSettings()
  const scripts = readHookScripts()
  const matrix = buildMatrix(config)

  return { config: config.hooks || {}, scripts, matrix }
}

function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return {}
    return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

function readHookScripts() {
  const scripts = []
  try {
    if (!fs.existsSync(HOOKS_DIR)) return scripts
    const files = fs.readdirSync(HOOKS_DIR).filter(f =>
      f.endsWith('.sh') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.bat')
    )
    for (const file of files) {
      try {
        const filePath = path.join(HOOKS_DIR, file)
        const stat = fs.statSync(filePath)
        const content = fs.readFileSync(filePath, 'utf-8')
        scripts.push({
          filename: file,
          content: content.slice(0, 2000),
          lastModified: stat.mtimeMs,
          size: stat.size,
        })
      } catch { /* skip unreadable */ }
    }
  } catch { /* dir doesn't exist */ }
  return scripts
}

function buildMatrix(settings) {
  const hooks = settings.hooks || {}
  const rows = []

  for (const [event, matchers] of Object.entries(hooks)) {
    if (!Array.isArray(matchers)) continue
    for (const entry of matchers) {
      const matcher = entry.matcher || '*'
      const hookList = entry.hooks || []
      for (const hook of hookList) {
        rows.push({
          event,
          matcher,
          type: hook.type || 'command',
          command: hook.command || '',
        })
      }
    }
  }

  return rows
}
