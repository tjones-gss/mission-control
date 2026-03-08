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
    const val = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, '')
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
    const subdirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
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
  const plugins = []

  // User skills
  try {
    const userSkillsDir = path.join(CLAUDE_DIR, 'skills')
    if (fs.existsSync(userSkillsDir)) {
      const files = fs.readdirSync(userSkillsDir).filter(f => f.endsWith('.md'))
      for (const file of files) {
        const skill = parseSkillFile(path.join(userSkillsDir, file), 'user')
        if (skill) userSkills.push(skill)
      }
    }
  } catch {
    // ignore
  }

  // Plugin skills
  try {
    const settingsPath = path.join(CLAUDE_DIR, 'settings.json')
    const installedPath = path.join(CLAUDE_DIR, 'plugins', 'installed_plugins.json')

    if (!fs.existsSync(settingsPath) || !fs.existsSync(installedPath)) {
      return buildResponse(userSkills, plugins)
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

  return buildResponse(userSkills, plugins)
}

function buildResponse(userSkills, plugins) {
  const totalSkillCount = userSkills.length + plugins.reduce((sum, p) => sum + p.skillCount, 0)
  return { userSkills, plugins, totalSkillCount }
}
