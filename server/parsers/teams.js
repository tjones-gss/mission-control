import fs from 'fs'
import path from 'path'
import os from 'os'

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams')

export function getAllTeams() {
  if (!fs.existsSync(TEAMS_DIR)) return []

  return fs
    .readdirSync(TEAMS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const teamPath = path.join(TEAMS_DIR, d.name)
      const configPath = path.join(teamPath, 'config.json')
      if (!fs.existsSync(configPath)) return null
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        const inboxes = readInboxes(path.join(teamPath, 'inboxes'))
        return { ...config, inboxes }
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function readInboxes(inboxesPath) {
  if (!fs.existsSync(inboxesPath)) return {}
  const inboxes = {}
  for (const file of fs.readdirSync(inboxesPath).filter((f) => f.endsWith('.json'))) {
    const agentName = file.replace('.json', '')
    try {
      inboxes[agentName] = JSON.parse(fs.readFileSync(path.join(inboxesPath, file), 'utf-8'))
    } catch {
      inboxes[agentName] = []
    }
  }
  return inboxes
}
