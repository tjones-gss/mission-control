import fs from 'fs'
import path from 'path'
import os from 'os'

const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return {}
  const result = {}
  for (const line of match[1].split('\n')) {
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const val = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
    result[key] = val
  }
  return result
}

function parseSkillFile(filePath, source, pluginKey = null) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8')
    const fm = parseFrontmatter(content)
    const name = fm.name || path.basename(filePath, '.md')
    const argumentHint = fm['argument-hint'] || fm['argumentHint'] || null
    const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').trim()
    return {
      name,
      description: fm.description || null,
      argumentHint,
      command: '/' + name,
      source,
      body: body || null,
      ...(pluginKey ? { pluginKey } : {}),
    }
  } catch {
    return null
  }
}

function getPluginInfo(installPath) {
  try {
    const pluginJsonPath = path.join(installPath, '.claude-plugin', 'plugin.json')
    const raw = fs.readFileSync(pluginJsonPath, 'utf-8')
    const data = JSON.parse(raw)
    return {
      name: data.name || null,
      description: data.description || null,
      version: data.version || null,
      author: data.author?.name || data.author || null,
    }
  } catch {
    return { name: null, description: null, version: null, author: null }
  }
}

function getPluginSkills(installPath, pluginKey) {
  const skillsDir = path.join(installPath, 'skills')
  if (!fs.existsSync(skillsDir)) return []

  const skills = []
  try {
    const subdirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
    for (const subdir of subdirs) {
      const skillFile = path.join(skillsDir, subdir.name, 'SKILL.md')
      if (fs.existsSync(skillFile)) {
        const skill = parseSkillFile(skillFile, 'plugin', pluginKey)
        if (skill) skills.push(skill)
      }
    }
  } catch {
    // ignore
  }
  return skills
}

export function getAllSkills() {
  const userSkills = []
  const userCommands = []
  const plugins = []

  // User skills — supports BOTH layouts:
  //   ~/.claude/skills/<name>.md           (flat file)
  //   ~/.claude/skills/<name>/SKILL.md     (subdirectory, the standard
  //                                          layout used by every plugin)
  // The flat layout is rarely used in practice — most people have the
  // subdirectory layout. The previous parser only matched flat .md files,
  // so all subdirectory-style user skills were silently invisible.
  try {
    const userSkillsDir = path.join(CLAUDE_DIR, 'skills')
    if (fs.existsSync(userSkillsDir)) {
      for (const entry of fs.readdirSync(userSkillsDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) {
          const skill = parseSkillFile(path.join(userSkillsDir, entry.name), 'user')
          if (skill) userSkills.push(skill)
        } else if (entry.isDirectory()) {
          const skillFile = path.join(userSkillsDir, entry.name, 'SKILL.md')
          if (fs.existsSync(skillFile)) {
            const skill = parseSkillFile(skillFile, 'user')
            if (skill) {
              // Make sure the displayed name matches the directory if the
              // frontmatter doesn't specify one — otherwise it'd show as
              // "SKILL" for every subdirectory entry.
              if (!skill.name || skill.name === 'SKILL') {
                skill.name = entry.name
                skill.command = '/' + entry.name
              }
              userSkills.push(skill)
            }
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // User slash commands — ~/.claude/commands/<name>.md. These are
  // functionally identical to skills (you invoke them as /<name>) but
  // live in a different directory and are authored differently. The
  // dashboard previously didn't show them at all.
  try {
    const commandsDir = path.join(CLAUDE_DIR, 'commands')
    if (fs.existsSync(commandsDir)) {
      const walk = (dir, prefix = '') => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.isFile() && entry.name.endsWith('.md')) {
            const filePath = path.join(dir, entry.name)
            const cmd = parseSkillFile(filePath, 'user-command')
            if (cmd) {
              // Namespace by relative path so nested commands like
              // git/commit.md become /git:commit
              const baseName = entry.name.replace(/\.md$/, '')
              const fullName = prefix ? `${prefix}:${baseName}` : baseName
              cmd.name = fullName
              cmd.command = '/' + fullName
              userCommands.push(cmd)
            }
          } else if (entry.isDirectory()) {
            walk(path.join(dir, entry.name), prefix ? `${prefix}:${entry.name}` : entry.name)
          }
        }
      }
      walk(commandsDir)
    }
  } catch {
    // ignore
  }

  // Plugin skills
  try {
    const settingsPath = path.join(CLAUDE_DIR, 'settings.json')
    const installedPath = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')

    if (!fs.existsSync(settingsPath) || !fs.existsSync(installedPath)) {
      return buildResponse(userSkills, plugins, userCommands)
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    const installed = JSON.parse(fs.readFileSync(installedPath, 'utf-8'))
    const enabledPlugins = settings.enabledPlugins || {}

    for (const [key, enabled] of Object.entries(enabledPlugins)) {
      if (!enabled) continue
      const pluginVersions = installed.plugins?.[key]
      if (!pluginVersions?.length) continue
      const installPath = pluginVersions[0].installPath
      if (!installPath) continue

      const info = getPluginInfo(installPath)
      const skills = getPluginSkills(installPath, key)

      if (skills.length === 0) continue

      plugins.push({
        key,
        name: info.name || key.split('@')[0],
        description: info.description,
        version: info.version,
        author: info.author,
        skillCount: skills.length,
        skills,
      })
    }
  } catch {
    // ignore
  }

  return buildResponse(userSkills, plugins, userCommands)
}

function buildResponse(userSkills, plugins, userCommands = []) {
  const totalSkillCount =
    userSkills.length + userCommands.length + plugins.reduce((sum, p) => sum + p.skillCount, 0)
  return { userSkills, userCommands, plugins, totalSkillCount }
}
