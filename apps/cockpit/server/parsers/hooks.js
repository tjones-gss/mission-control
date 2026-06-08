import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const HOOKS_DIR = path.join(CLAUDE_DIR, 'hooks')
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')

export function getHooksConfig() {
  const { settings, degraded } = readSettings()
  const scripts = readHookScripts()
  const matrix = buildMatrix(settings)

  // `degraded` is critical: a present-but-unparseable settings.json must NOT be
  // rendered as "no hooks active." When degraded, config:{} means "unknown",
  // not "none" — the UI keys off the degraded flag to say so.
  return { config: settings.hooks || {}, scripts, matrix, degraded }
}

function readSettings() {
  let raw
  try {
    if (!fs.existsSync(SETTINGS_PATH)) return { settings: {}, degraded: false }
    raw = fs.readFileSync(SETTINGS_PATH, 'utf-8')
  } catch {
    // Present (existsSync true) but unreadable → degraded, not "none".
    signalDegraded('hooks', 'read-failed', { filePath: SETTINGS_PATH })
    return { settings: {}, degraded: true }
  }
  if (!raw || !raw.trim()) return { settings: {}, degraded: false }
  try {
    const parsed = JSON.parse(raw)
    return { settings: parsed && typeof parsed === 'object' ? parsed : {}, degraded: false }
  } catch {
    signalDegraded('hooks', 'parse-failed', { filePath: SETTINGS_PATH })
    return { settings: {}, degraded: true }
  }
}

function readHookScripts() {
  const scripts = []
  try {
    if (!fs.existsSync(HOOKS_DIR)) return scripts
    const files = fs
      .readdirSync(HOOKS_DIR)
      .filter(
        (f) => f.endsWith('.sh') || f.endsWith('.js') || f.endsWith('.py') || f.endsWith('.bat'),
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
      } catch {
        /* skip unreadable */
      }
    }
  } catch {
    /* dir doesn't exist */
  }
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
