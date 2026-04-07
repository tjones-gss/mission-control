import { Router } from 'express'
import { getTasksForSession, getAllTaskSessions } from '../parsers/tasks.js'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { validateSessionId } from '../utils/validate.js'

export const router = Router()

const TASKS_DIR = path.join(os.homedir(), '.claude', 'tasks')
const VALID_ID = /^[a-zA-Z0-9_-]+$/

// Atomic write helper — write to a unique temp file then rename onto the
// final path. Two concurrent writers using plain fs.writeFile against the
// same path can interleave their bytes and produce a malformed JSON file
// that getTasksForSession then silently drops (caught by Run #20 race
// probe: 10 parallel PUTs all 200'd but the resulting file had `}}` at
// the end). rename() is atomic on the same filesystem on every modern OS.
//
// On Windows, fs.rename can fail with EPERM/EBUSY/EEXIST when another
// process is currently renaming TO the same destination or holding it
// open. Retry a few times with small backoff to ride out the race. If
// the retries are exhausted the error propagates and the route returns
// 500 — at that point the client can retry from its end.
async function atomicWriteJson(filePath, data) {
  const tmp = filePath + '.tmp.' + randomUUID().slice(0, 8)
  await fs.writeFile(tmp, JSON.stringify(data, null, 2))
  const delays = [0, 8, 24, 60]
  let lastErr
  for (const delay of delays) {
    if (delay) await new Promise((r) => setTimeout(r, delay))
    try {
      await fs.rename(tmp, filePath)
      return
    } catch (err) {
      lastErr = err
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EEXIST') break
    }
  }
  // Best-effort cleanup of the orphaned temp file
  try {
    await fs.unlink(tmp)
  } catch {
    /* ignore */
  }
  throw lastErr
}

router.get('/', (req, res) => {
  res.json(getAllTaskSessions())
})

router.get('/:sessionId', (req, res) => {
  res.json(getTasksForSession(req.params.sessionId))
})

router.post('/:sessionId', async (req, res, next) => {
  const { sessionId } = req.params
  if (!validateSessionId(sessionId, res)) return

  // Reject empty subject — without this, the user could create a task
  // with no title that's impossible to identify in the board.
  const subject = typeof req.body.subject === 'string' ? req.body.subject.trim() : ''
  if (!subject) {
    return res.status(400).json({ error: 'subject is required' })
  }

  try {
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
      subject,
      description: req.body.description || '',
      activeForm: req.body.activeForm || '',
      status: req.body.status || 'pending',
      owner: req.body.owner || '',
      blocks: Array.isArray(req.body.blocks) ? req.body.blocks : [],
      blockedBy: Array.isArray(req.body.blockedBy) ? req.body.blockedBy : [],
    }

    const filePath = path.join(sessionDir, `${newId}.json`)
    await atomicWriteJson(filePath, task)
    res.status(201).json(task)
  } catch (err) {
    // Express 4 does NOT auto-catch async rejections — must call next(err)
    // to reach the shared errorHandler. The previous `throw err` here
    // bubbled to process.unhandledRejection and the client request hung
    // until the 30s timeout.
    next(err)
  }
})

router.put('/:sessionId/:taskId', async (req, res, next) => {
  const { sessionId, taskId } = req.params
  if (!VALID_ID.test(sessionId) || !VALID_ID.test(taskId)) {
    return res.status(400).json({ error: 'Invalid sessionId or taskId' })
  }

  const filePath = path.join(TASKS_DIR, sessionId, `${taskId}.json`)
  try {
    await fs.access(filePath)
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'Task not found' })
    return next(err)
  }

  try {
    const task = {
      id: taskId,
      subject: req.body.subject || '',
      description: req.body.description || '',
      activeForm: req.body.activeForm || '',
      status: req.body.status || 'pending',
      owner: req.body.owner || '',
      blocks: Array.isArray(req.body.blocks) ? req.body.blocks : [],
      blockedBy: Array.isArray(req.body.blockedBy) ? req.body.blockedBy : [],
    }

    await atomicWriteJson(filePath, task)
    res.json(task)
  } catch (err) {
    next(err)
  }
})

router.delete('/:sessionId/:taskId', async (req, res, next) => {
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
    next(err)
  }
})
