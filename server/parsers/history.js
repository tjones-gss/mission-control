import fs from 'fs'
import path from 'path'
import os from 'os'

const HISTORY_FILE = path.join(os.homedir(), '.claude', 'history.jsonl')

export function getHistory(limit = 100) {
  if (!fs.existsSync(HISTORY_FILE)) return []
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').filter(Boolean)
  return lines
    .slice(-limit)
    .map(l => { try { return JSON.parse(l) } catch { return null } })
    .filter(Boolean)
    .reverse() // newest first
}
