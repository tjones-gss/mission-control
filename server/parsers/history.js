import fs from 'fs'
import path from 'path'
import os from 'os'

const HISTORY_FILE = path.join(os.homedir(), '.claude', 'history.jsonl')

function parseAll() {
  if (!fs.existsSync(HISTORY_FILE)) return []
  const lines = fs.readFileSync(HISTORY_FILE, 'utf-8').trim().split('\n').filter(Boolean)
  return lines
    .map((l) => {
      try {
        return JSON.parse(l)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function getHistory(limit = 100, offset = 0, { project, from, to } = {}) {
  let entries = parseAll()
  if (project) entries = entries.filter((e) => e.project === project)
  if (from != null) entries = entries.filter((e) => e.timestamp >= from)
  if (to != null) entries = entries.filter((e) => e.timestamp <= to)
  entries = entries.reverse() // newest first
  return entries.slice(offset, offset + limit)
}

export function getHistoryStats() {
  const entries = parseAll()
  const empty = {
    total: 0,
    topCommand: null,
    topProject: null,
    today: 0,
    dailyActivity: Array.from({ length: 7 }, (_, i) => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - (6 - i))
      return { date: d.toISOString().slice(0, 10), count: 0 }
    }),
  }
  if (!entries.length) return empty

  const commandCounts = {}
  const projectCounts = {}
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  let today = 0

  for (const e of entries) {
    const cmd = (e.display || '').split('\n')[0].slice(0, 50)
    if (cmd) commandCounts[cmd] = (commandCounts[cmd] || 0) + 1
    if (e.project) projectCounts[e.project] = (projectCounts[e.project] || 0) + 1
    if (e.timestamp >= todayStart.getTime()) today++
  }

  const topCommand = Object.entries(commandCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const topProject = Object.entries(projectCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const dailyActivity = Array.from({ length: 7 }, (_, i) => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - (6 - i))
    const next = new Date(d)
    next.setDate(next.getDate() + 1)
    const count = entries.filter(
      (e) => e.timestamp >= d.getTime() && e.timestamp < next.getTime(),
    ).length
    return { date: d.toISOString().slice(0, 10), count }
  })

  return { total: entries.length, topCommand, topProject, today, dailyActivity }
}
