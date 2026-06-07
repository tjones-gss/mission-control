import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')
const SETTINGS_PATH = path.join(CLAUDE_DIR, 'settings.json')
// Claude Code's `claude mcp add -s user` writes user-scope MCP servers to
// ~/.claude.json (top-level `mcpServers`), not ~/.claude/settings.json.
// Read both so the dashboard reflects what the CLI actually loads.
const CLAUDE_JSON_PATH = path.join(os.homedir(), '.claude.json')

// Mark a servers array as degraded: a config file was present but unparseable,
// so the list may be incomplete. We attach a flag rather than throwing away the
// servers we DID read — a partial-but-flagged list beats both a silent empty
// list (misreports "no servers") and dropping valid servers we parsed fine.
function flagDegraded(servers) {
  servers.degraded = true
  return servers
}

export function getMcpServers() {
  const servers = []
  const seen = new Set()
  let degraded = false

  // ~/.claude.json takes precedence — that's the canonical location used
  // by `claude mcp add -s user`. Fall back to ~/.claude/settings.json for
  // legacy/manual configs.
  for (const sourcePath of [CLAUDE_JSON_PATH, SETTINGS_PATH]) {
    const { config, degraded: srcDegraded } = readConfig(sourcePath, 'user')
    if (srcDegraded) degraded = true
    const mcpServers = config.mcpServers || {}
    for (const [name, entry] of Object.entries(mcpServers)) {
      if (seen.has(name)) continue
      seen.add(name)
      servers.push(buildServer(name, entry, 'user'))
    }
  }

  return degraded ? flagDegraded(servers) : servers
}

export function getMcpServersForSession(cwd) {
  const userServers = getMcpServers()
  let degraded = userServers.degraded === true

  if (!cwd) return userServers

  // Read project-level MCP config
  const projectRead = readConfig(path.join(cwd, '.claude', 'settings.json'), 'project')
  const localRead = readConfig(path.join(cwd, '.claude', 'settings.local.json'), 'local')
  if (projectRead.degraded || localRead.degraded) degraded = true

  const projectMcp = projectRead.config.mcpServers || {}
  for (const [name, entry] of Object.entries(projectMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'project (overrides user)'
    } else {
      userServers.push(buildServer(name, entry, 'project'))
    }
  }

  const localMcp = localRead.config.mcpServers || {}
  for (const [name, entry] of Object.entries(localMcp)) {
    const existing = userServers.find((s) => s.name === name)
    if (existing) {
      existing.scope = 'local (overrides)'
    } else {
      userServers.push(buildServer(name, entry, 'local'))
    }
  }

  return degraded ? flagDegraded(userServers) : userServers
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

// Read + parse an MCP config file, distinguishing ABSENT/EMPTY (normal — no
// MCP configured at this source) from PRESENT-BUT-UNPARSEABLE (degraded — the
// servers it declares silently vanish today). On degradation it emits a
// persistent parser_degraded SSE event and reports `degraded:true` so the
// caller can flag the list instead of misreporting "no servers."
function readConfig(filePath, scope) {
  if (!fs.existsSync(filePath)) return { config: {}, degraded: false }
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch {
    // Present (existsSync said so) but unreadable — degraded, not "none".
    signalDegraded('mcp', 'read-failed', { filePath, scope })
    return { config: {}, degraded: true }
  }
  if (!raw || !raw.trim()) return { config: {}, degraded: false }
  try {
    const parsed = JSON.parse(raw)
    return { config: parsed && typeof parsed === 'object' ? parsed : {}, degraded: false }
  } catch {
    signalDegraded('mcp', 'parse-failed', { filePath, scope })
    return { config: {}, degraded: true }
  }
}

function detectTransport(config) {
  if (config.url) return 'sse'
  if (config.command) return 'stdio'
  if (config.type) return config.type
  return 'unknown'
}
