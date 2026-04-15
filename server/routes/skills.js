import { Router } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { getAllSkills } from '../parsers/skills.js'
import { validateSkillName as validateName } from '../utils/validate.js'
import { atomicWrite } from '../lib/atomic-write.js'

export const router = Router()

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')

// User skills can live in either of two on-disk layouts:
//   ~/.claude/skills/<name>.md             (flat file — uncommon)
//   ~/.claude/skills/<name>/SKILL.md       (subdirectory — the standard
//                                            layout used by every plugin)
// Prefer the subdirectory form when both exist, matching Claude Code's
// own resolution order. The parser in parsers/skills.js makes the same
// choice and emits a console.warn for the collision so the user can
// clean up the duplicate.
async function resolveSkillPath(name) {
  const subdir = path.join(SKILLS_DIR, name, 'SKILL.md')
  try {
    await fs.access(subdir)
    return subdir
  } catch {
    /* try flat */
  }
  const flat = path.join(SKILLS_DIR, `${name}.md`)
  try {
    await fs.access(flat)
    return flat
  } catch {
    return null
  }
}

// Memoize getAllSkills() with a short TTL. Scanning ~/.claude/skills,
// commands, and every installed plugin's SKILL.md files is fully
// synchronous and can take 500ms-2s with many plugins. The dashboard
// fires this from multiple useApi consumers on first paint and on tab
// switches, which can saturate the single-threaded event loop and make
// e2e tests time out under parallel workers.
let skillsCache = { data: null, expiresAt: 0 }
const SKILLS_CACHE_TTL_MS = 5_000
function getCachedSkills() {
  const now = Date.now()
  if (skillsCache.data && skillsCache.expiresAt > now) return skillsCache.data
  const data = getAllSkills()
  skillsCache = { data, expiresAt: now + SKILLS_CACHE_TTL_MS }
  return data
}
function invalidateSkillsCache() {
  skillsCache = { data: null, expiresAt: 0 }
}

router.get('/', (req, res) => res.json(getCachedSkills()))

router.get('/:name/raw', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  try {
    const filePath = await resolveSkillPath(name)
    if (!filePath) return res.status(404).json({ error: 'Skill not found.' })
    // Defense-in-depth: confirm the resolved path is inside SKILLS_DIR
    // before reading. PUT and DELETE already do this; GET should too.
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(SKILLS_DIR) + path.sep)) {
      return res
        .status(403)
        .json({ error: 'Cannot read skills outside the user skills directory.' })
    }
    const content = await fs.readFile(resolved, 'utf8')
    res.type('text/plain').send(content)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  const { name, content } = req.body ?? {}
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required.' })
  if (!validateName(name, res)) return
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required.' })
  const filePath = path.join(SKILLS_DIR, `${name}.md`)
  try {
    await fs.access(filePath)
    return res.status(409).json({ error: 'A skill with that name already exists.' })
  } catch {
    // file does not exist — proceed
  }
  try {
    await fs.mkdir(SKILLS_DIR, { recursive: true })
    await atomicWrite(filePath, content)
  } catch (err) {
    return next(err)
  }
  invalidateSkillsCache()
  res.status(201).json({ ok: true, name })
})

router.put('/:name', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  const { content } = req.body ?? {}
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required.' })
  try {
    const filePath = await resolveSkillPath(name)
    if (!filePath) return res.status(404).json({ error: 'Skill not found.' })
    // Defense-in-depth: make sure we never write outside SKILLS_DIR
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(SKILLS_DIR) + path.sep)) {
      return res
        .status(403)
        .json({ error: 'Cannot edit skills outside the user skills directory.' })
    }
    await atomicWrite(resolved, content)
    invalidateSkillsCache()
    res.json({ ok: true, name })
  } catch (err) {
    next(err)
  }
})

router.delete('/:name', async (req, res, next) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  try {
    const filePath = await resolveSkillPath(name)
    if (!filePath) return res.status(404).json({ error: 'Skill not found.' })
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(path.resolve(SKILLS_DIR) + path.sep)) {
      return res
        .status(403)
        .json({ error: 'Cannot delete skills outside the user skills directory.' })
    }
    await fs.unlink(resolved)
    // For subdirectory-style skills, also remove the empty parent dir
    // (only if it's empty — preserve sibling files like helper docs).
    if (path.basename(resolved) === 'SKILL.md') {
      const parent = path.dirname(resolved)
      try {
        const remaining = await fs.readdir(parent)
        if (remaining.length === 0) await fs.rmdir(parent)
      } catch {
        /* best-effort cleanup */
      }
    }
    invalidateSkillsCache()
    res.json({ ok: true, name })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Skill not found.' })
    next(err)
  }
})
