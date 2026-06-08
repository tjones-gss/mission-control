import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams')

export function getAllTeams() {
  if (!fs.existsSync(TEAMS_DIR)) return []

  return fs
    .readdirSync(TEAMS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const teamPath = path.join(TEAMS_DIR, d.name)
      const configPath = path.join(teamPath, 'config.json')
      // No config.json → the dir isn't a configured team. Normal, stay silent.
      if (!fs.existsSync(configPath)) return null
      let config
      try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
      } catch {
        // config.json is PRESENT but unparseable. Dropping the team to null
        // would render "no teams"/"one fewer team" — a blank that looks like a
        // fact. Surface a distinguishable degraded marker + persistent SSE so
        // the dashboard can show a banner instead of silently hiding the team.
        return signalDegraded('teams', 'parse-failed', { team: d.name, filePath: configPath })
      }
      const inboxes = readInboxes(path.join(teamPath, 'inboxes'))
      return { ...config, inboxes }
    })
    .filter(Boolean)
}

function readInboxes(inboxesPath) {
  if (!fs.existsSync(inboxesPath)) return {}
  const inboxes = {}
  for (const file of fs.readdirSync(inboxesPath).filter((f) => f.endsWith('.json'))) {
    const agentName = file.replace('.json', '')
    const filePath = path.join(inboxesPath, file)
    try {
      inboxes[agentName] = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    } catch {
      // PRESENT but unparseable inbox. Defaulting to [] would misreport it as
      // "no messages waiting" when messages may in fact be queued. Surface a
      // distinguishable degraded marker (NOT []) + persistent SSE.
      inboxes[agentName] = signalDegraded('teams', 'parse-failed', {
        agent: agentName,
        filePath,
      })
    }
  }
  return inboxes
}
