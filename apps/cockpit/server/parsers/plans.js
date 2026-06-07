import fs from 'fs'
import path from 'path'
import os from 'os'
import { signalDegraded } from '../lib/claude-format.js'

const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans')

export function getAllPlans() {
  if (!fs.existsSync(PLANS_DIR)) return []

  const plans = []
  try {
    const files = fs.readdirSync(PLANS_DIR).filter((f) => f.endsWith('.md'))
    for (const file of files) {
      try {
        const filePath = path.join(PLANS_DIR, file)
        const stat = fs.statSync(filePath)
        const content = fs.readFileSync(filePath, 'utf-8')
        const name = extractName(content, file)
        plans.push({
          filename: file,
          name,
          lastModified: stat.mtimeMs,
        })
      } catch {
        // skip files that fail to read
      }
    }
  } catch (err) {
    // The dir EXISTS (existsSync passed) but listing it threw — a permission
    // flip or a race, not "no plans." An absent dir returns above and stays
    // silent; this present-but-unreadable case is DEGRADED, surfaced as a
    // persistent signal rather than a silent empty list.
    signalDegraded('plans', 'read-failed', { dir: PLANS_DIR, err: String(err) })
    return []
  }

  plans.sort((a, b) => b.lastModified - a.lastModified)
  return plans
}

export function getPlanByFilename(filename) {
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return null
  }

  const filePath = path.join(PLANS_DIR, filename)
  try {
    const stat = fs.statSync(filePath)
    const content = fs.readFileSync(filePath, 'utf-8')
    const name = extractName(content, filename)
    return { filename, name, content, lastModified: stat.mtimeMs }
  } catch {
    return null
  }
}

function extractName(content, fallback) {
  const match = content.match(/^#\s+(.+)$/m)
  return match ? match[1].trim() : fallback
}
