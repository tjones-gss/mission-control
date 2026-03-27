import { Router } from 'express'
import { getTasksForSession, getAllTaskSessions } from '../parsers/tasks.js'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

export const router = Router()

const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks')
const VALID_ID = /^[a-zA-Z0-9_-]+$/

router.get('/', (req, res) => {
  res.json(getAllTaskSessions())
})

router.get('/:sessionId', (req, res) => {
  res.json(getTasksForSession(req.params.sessionId))
})

router.post('/:sessionId', async (req, res) => {
  const { sessionId } = req.params
  if (!VALID_ID.test(sessionId)) {
    return res.status(400).json({ error: 'Invalid sessionId' })
  }

  const sessionDir = path.join(TASKS_DIR, sessionId)
  await fs.mkdir(sessionDir, { recursive: true })

  // Find max existing id to auto-increment
  let maxId = 0
  try {
    const files = await fs.readdir(sessionDir)
    for (const file of files) {
      if (file.endsWith('.json')) {
        const num = parseInt(file.replace('.json', ''), 10)
        if (!isNaN(num) && num > maxId) maxId = num
      }
    }
  } catch {
    // dir may be empty
  }

  const newId = String(maxId + 1)
  const task = {
    id: newId,
    subject: req.body.subject || '',
    description: req.body.description || '',
    activeForm: req.body.activeForm || '',
    status: req.body.status || 'pending',
    owner: req.body.owner || '',
    blocks: req.body.blocks || [],
    blockedBy: req.body.blockedBy || [],
  }

  const filePath = path.join(sessionDir, `${newId}.json`)
  await fs.writeFile(filePath, JSON.stringify(task, null, 2))
  res.status(201).json(task)
})

router.put('/:sessionId/:taskId', async (req, res) => {
  const { sessionId, taskId } = req.params
  if (!VALID_ID.test(sessionId) || !VALID_ID.test(taskId)) {
    return res.status(400).json({ error: 'Invalid sessionId or taskId' })
  }

  const filePath = path.join(TASKS_DIR, sessionId, `${taskId}.json`)
  try {
    await fs.access(filePath)
  } catch {
    return res.status(404).json({ error: 'Task not found' })
  }

  const task = {
    id: taskId,
    subject: req.body.subject || '',
    description: req.body.description || '',
    activeForm: req.body.activeForm || '',
    status: req.body.status || 'pending',
    owner: req.body.owner || '',
    blocks: req.body.blocks || [],
    blockedBy: req.body.blockedBy || [],
  }

  await fs.writeFile(filePath, JSON.stringify(task, null, 2))
  res.json(task)
})

router.delete('/:sessionId/:taskId', async (req, res) => {
  const { sessionId, taskId } = req.params
  if (!VALID_ID.test(sessionId) || !VALID_ID.test(taskId)) {
    return res.status(400).json({ error: 'Invalid sessionId or taskId' })
  }

  const filePath = path.join(TASKS_DIR, sessionId, `${taskId}.json`)
  try {
    await fs.unlink(filePath)
    res.json({ ok: true })
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Task not found' })
    throw err
  }
})
