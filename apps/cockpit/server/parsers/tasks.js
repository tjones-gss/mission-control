import fs from 'fs'
import path from 'path'
import os from 'os'

const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks')

export function getTasksForSession(sessionId) {
  const dir = path.join(TASKS_DIR, sessionId)
  if (!fs.existsSync(dir)) return []

  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.id) - Number(b.id))
}

export function getAllTaskSessions() {
  if (!fs.existsSync(TASKS_DIR)) return []
  return fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}
