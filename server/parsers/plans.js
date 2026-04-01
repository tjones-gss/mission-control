import fs from 'fs'
import path from 'path'
import os from 'os'

const PLANS_DIR = path.join(os.homedir(), '.claude', 'plans')

export function getAllPlans() {
  if (!fs.existsSync(PLANS_DIR)) return []

  const plans = []
  try {
    const files = fs.readdirSync(PLANS_DIR).filter(f => f.endsWith('.md'))
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
  } catch {
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
