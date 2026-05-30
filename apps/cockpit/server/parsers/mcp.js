import fs from 'fs'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')
// Claude Code's `claude mcp add -s user` writes user-scope MCP servers to
// ~/.claude.json (top-level `mcpServers`), not ~/.claude/settings.json.
// Read both so the dashboard reflects what the CLI actually loads.
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json')

export function getMcpServers() {
  const servers = []
  const seen = new Set()

  // ~/.claude.json takes precedence — that's the canonical location used
  // by `claude mcp add -s user`. Fall back to ~/.claude/settings.json for
  // legacy/manual configs.
  for (const sourcePath of [CLAUDE_JSON_PATH, SETTINGS_PATH]) {
    const config = readConfig(sourcePath)
    const mcpServers = config.mcpServers || {}
    for (const [name, entry] of Object.entries(mcpServers)) {
      if (seen.has(name)) continue
      seen.add(name)
      servers.push(buildServer(name, entry, 'user'))
    }
  }

  return servers
}

export function getMcpServersForSession(cwd) {
  const userServers = getMcpServers()

  if (!cwd) return userServers

  // Read project-level MCP config
  const projectConfig = readConfig(path.join(cwd, '.claude', 'settings.json'))
  const localConfig = readConfig(path.join(cwd, '.claude', 'settings.local.json'))

  const projectMcp = projectConfig.mcpServers || {}
  for (const [name, entry] of Object.entries(projectMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'project (overrides user)'
    } else {
      userServers.push(buildServer(name, entry, 'project'))
    }
  }

  const localMcp = localConfig.mcpServers || {}
  for (const [name, entry] of Object.entries(localMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'local (overrides)'
    } else {
      userServers.push(buildServer(name, entry, 'local'))
    }
  }

  return userServers
}

function buildServer(name, config, scope) {
  return {
    name,
    transportType: detectTransport(config),
    command: config.command || null,
    args: config.args || [],
    url: config.url || null,
    env: config.env ? Object.keys(config.env) : [],
    toolPrefix: `mcp__${name}__`,
    scope,
  }
}

function readConfig(filePath) {
  try {
    if (!fs.existsSync(filePath)) return {}
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return {}
  }
}

function detectTransport(config) {
  if (config.url) return 'sse'
  if (config.command) return 'stdio'
  if (config.type) return config.type
  return 'unknown'
}
