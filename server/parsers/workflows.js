import fs from 'fs'
import path from 'path'
import os from 'os'

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')

export function getAllWorkflows() {
  if (!fs.existsSync(WORKFLOWS_DIR)) return []
  return fs
    .readdirSync(WORKFLOWS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, f), 'utf-8'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}
