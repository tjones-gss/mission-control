import fs from 'fs'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')

export function getMcpServers() {
  const userConfig = readConfig(SETTINGS_PATH)
  const servers = []

  const mcpServers = userConfig.mcpServers || {}
  for (const [name, config] of Object.entries(mcpServers)) {
    servers.push({
      name,
      transportType: detectTransport(config),
      command: config.command || null,
      args: config.args || [],
      url: config.url || null,
      env: config.env ? Object.keys(config.env) : [],
      toolPrefix: `mcp__${name}__`,
      scope: 'user',
    })
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
  for (const [name, config] of Object.entries(projectMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'project (overrides user)'
    } else {
      userServers.push({
        name,
        transportType: detectTransport(config),
        command: config.command || null,
        args: config.args || [],
        url: config.url || null,
        env: config.env ? Object.keys(config.env) : [],
        toolPrefix: `mcp__${name}__`,
        scope: 'project',
      })
    }
  }

  const localMcp = localConfig.mcpServers || {}
  for (const [name, config] of Object.entries(localMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'local (overrides)'
    } else {
      userServers.push({
        name,
        transportType: detectTransport(config),
        command: config.command || null,
        args: config.args || [],
        url: config.url || null,
        env: config.env ? Object.keys(config.env) : [],
        toolPrefix: `mcp__${name}__`,
        scope: 'local',
      })
    }
  }

  return userServers
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
