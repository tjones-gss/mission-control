import { Router } from 'express'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { getAllWorkflows } from '../parsers/workflows.js'

export const router = Router()

const WORKFLOWS_DIR = path.join(os.homedir(), '.claude', 'workflows')
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'skills')
const NAME_RE = /^[a-zA-Z0-9_-]+$/

function validateName(name, res) {
  if (!NAME_RE.test(name)) {
    res.status(400).json({ error: 'Invalid workflow name. Only letters, digits, underscores, and hyphens are allowed.' })
    return false
  }
  return true
}

function generateSkillMd(workflow) {
  const lines = [
    '---',
    `name: ${workflow.name}`,
    `description: ${workflow.description || ''}`,
    '---',
    '',
    'Follow these steps in order. Complete each step fully before moving to the next.',
    '',
  ]

  workflow.steps.forEach((step, i) => {
    lines.push(`## Step ${i + 1}: ${step.title || stepDefaultTitle(step)}`)
    lines.push('')
    lines.push(stepContent(step))
    lines.push('')
  })

  return lines.join('\n')
}

function stepDefaultTitle(step) {
  if (step.type === 'skill') return `Invoke /${step.skillName}`
  if (step.type === 'agent') return `Spawn ${step.agentType} agent`
  if (step.type === 'instruction') return 'Instruction'
  if (step.type === 'command') return `Run: ${step.command}`
  return step.type
}

function stepContent(step) {
  if (step.type === 'skill') {
    const note = step.note ? `\n\n${step.note}` : ''
    return `Invoke the \`/${step.skillName}\` skill.${note}`
  }
  if (step.type === 'agent') {
    return `Spawn a \`${step.agentType}\` agent with this prompt: "${step.prompt}"`
  }
  if (step.type === 'instruction') {
    return step.text || ''
  }
  if (step.type === 'command') {
    return `Run: \`${step.command}\``
  }
  return ''
}

router.get('/', (req, res) => res.json(getAllWorkflows()))

router.post('/', async (req, res) => {
  const body = req.body ?? {}
  const { name } = body
  if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name is required.' })
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  try {
    await fs.access(filePath)
    return res.status(409).json({ error: 'A workflow with that name already exists.' })
  } catch {
    // file does not exist — proceed
  }

  const now = Date.now()
  const workflow = {
    name,
    description: body.description || '',
    steps: body.steps || [],
    createdAt: now,
    updatedAt: now,
  }

  await fs.mkdir(WORKFLOWS_DIR, { recursive: true })
  await fs.writeFile(filePath, JSON.stringify(workflow, null, 2), 'utf8')
  res.status(201).json(workflow)
})

router.put('/:name', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Path traversal not allowed.' })
  }

  let existing = {}
  try {
    existing = JSON.parse(await fs.readFile(filePath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    throw err
  }

  const body = req.body ?? {}
  const updated = {
    ...existing,
    ...body,
    name, // name stays canonical from URL param
    updatedAt: Date.now(),
  }

  await fs.writeFile(filePath, JSON.stringify(updated, null, 2), 'utf8')
  res.json(updated)
})

router.delete('/:name', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const filePath = path.join(WORKFLOWS_DIR, `${name}.json`)
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(path.resolve(WORKFLOWS_DIR) + path.sep)) {
    return res.status(403).json({ error: 'Path traversal not allowed.' })
  }

  try {
    await fs.unlink(resolved)
    res.json({ ok: true, name })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    throw err
  }
})

router.post('/:name/export', async (req, res) => {
  const { name } = req.params
  if (!validateName(name, res)) return

  const workflowPath = path.join(WORKFLOWS_DIR, `${name}.json`)
  let workflow
  try {
    workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8'))
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Workflow not found.' })
    throw err
  }

  const skillPath = path.join(SKILLS_DIR, `${name}.md`)
  const overwrite = req.body?.overwrite === true

  if (!overwrite) {
    try {
      await fs.access(skillPath)
      return res.status(409).json({ error: `Skill /${name} already exists.` })
    } catch {
      // file does not exist — proceed
    }
  }

  const content = generateSkillMd(workflow)
  await fs.mkdir(SKILLS_DIR, { recursive: true })
  await fs.writeFile(skillPath, content, 'utf8')
  res.json({ ok: true, name, skillPath })
})
