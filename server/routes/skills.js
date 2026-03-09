import { Router } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { getAllSkills } from '../parsers/skills.js'

export const router = Router()

const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const NAME_RE = /^[a-zA-Z0-9_:-]+$/

function validateName(name, res) {
  if (!NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid skill name. Only letters, digits, underscores, colons, and hyphens are allowed.' })
    return false
  }
  return true
}

router.get('/', (req, res) => res.json(getAllSkills()))

router.get('/:name/raw', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  const filePath = path.join(SKILLS_DIR, `${name}.md`)
  try {
    const content = await fs.readFile(filePath, 'utf8')
    res.type('text/plain').send(content)
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Skill not found.' })
    throw err
  }
})

router.post('/', async (req, res) => {
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
  await fs.mkdir(SKILLS_DIR, { recursive: true })
  await fs.writeFile(filePath, content, 'utf8')
  res.status(201).json({ ok: true, name })
})

router.put('/:name', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  const { content } = req.body ?? {}
  if (typeof content !== 'string') return res.status(400).json({ error: 'content is required.' })
  const filePath = path.join(SKILLS_DIR, `${name}.md`)
  try {
    await fs.access(filePath)
  } catch {
    return res.status(404).json({ error: 'Skill not found.' })
  }
  await fs.writeFile(filePath, content, 'utf8')
  res.json({ ok: true, name })
})

router.delete('/:name', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return
  const filePath = path.join(SKILLS_DIR, `${name}.md`)
  // Ensure the resolved path is inside SKILLS_DIR (user skills only)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(SKILLS_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Cannot delete skills outside the user skills directory.' })
  }
  try {
    await fs.unlink(resolved)
    res.json({ ok: true, name })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Skill not found.' })
    throw err
  }
})
