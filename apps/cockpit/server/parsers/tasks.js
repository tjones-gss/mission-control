import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks')

export function getTasksForSession(sessionId) {
  const dir = path.join(TASKS_DIR, sessionId)
  if (!fs.existsSync(dir)) return []

  const jsonFiles = fs.readdirSync(dir).filter((f) => f.endsWith('.json'))
  const tasks = jsonFiles
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)

  if (tasks.length === 0 && jsonFiles.length > 0) {
    // Task files are on disk but every one failed to parse → a format change
    // under us. An empty dir, by contrast, yields zero .json files and is
    // normal. Surface this as a PERSISTENT degraded signal (deduped per process)
    // so the dashboard can show a banner instead of silently reading as "this
    // session has no tasks."
    signalDegraded('tasks', 'format-change', {
      dir,
      fileCount: jsonFiles.length,
    })
  }

  return tasks.sort((a, b) => Number(a.id) - Number(b.id))
}

export function getAllTaskSessions() {
  if (!fs.existsSync(TASKS_DIR)) return []
  return fs
    .readdirSync(TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
}
