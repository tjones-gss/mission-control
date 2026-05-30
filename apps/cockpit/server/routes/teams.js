import { Router } from 'express'
import { getAllTeams } from '../parsers/teams.js'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { validateTeamName, validateMessageId, sanitizeSender } from '../utils/validate.js'
import { atomicWriteJson } from '../lib/atomic-write.js'

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams')

export const router = Router()

router.get('/', (req, res) => res.json(getAllTeams()))

router.post('/:name/inbox', async (req, res, next) => {
  const { name } = req.params
  if (!validateTeamName(name, res)) return

  const { content, sender: rawSender } = req.body
  const sender = sanitizeSender(rawSender)

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  try {
    await fs.access(teamPath)
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'team not found' })
    return next(err)
  }

  try {
    const inboxesPath = path.join(teamPath, 'inboxes')
    await fs.mkdir(inboxesPath, { recursive: true })

    const dashboardFile = path.join(inboxesPath, 'dashboard.json')
    let messages = []
    try {
      const raw = await fs.readFile(dashboardFile, 'utf-8')
      messages = JSON.parse(raw)
    } catch (err) {
      if (err.code !== 'ENOENT') messages = []
    }

    const message = {
      id: randomUUID(),
      sender,
      content: content.trim(),
      timestamp: new Date().toISOString(),
      read: false,
      archived: false,
    }

    messages.push(message)
    await atomicWriteJson(dashboardFile, messages)
    res.status(201).json(message)
  } catch (err) {
    next(err)
  }
})

router.patch('/:name/inbox/:messageId', async (req, res, next) => {
  const { name, messageId } = req.params
  if (!validateTeamName(name, res)) return
  if (!validateMessageId(messageId, res)) return

  const updates = req.body

  if (typeof updates.read === 'undefined' && typeof updates.archived === 'undefined') {
    return res.status(400).json({ error: 'read or archived is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  try {
    await fs.access(teamPath)
  } catch (err) {
    if (err.code === 'ENOENT') return res.status(404).json({ error: 'team not found' })
    return next(err)
  }

  try {
    const inboxesPath = path.join(teamPath, 'inboxes')
    try {
      await fs.access(inboxesPath)
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'message not found' })
      return next(err)
    }

    const files = (await fs.readdir(inboxesPath)).filter((f) => f.endsWith('.json'))

    for (const file of files) {
      const filePath = path.join(inboxesPath, file)
      let messages
      try {
        messages = JSON.parse(await fs.readFile(filePath, 'utf-8'))
      } catch {
        continue
      }

      const idx = messages.findIndex((m) => m.id === messageId)
      if (idx === -1) continue

      if (typeof updates.read !== 'undefined') messages[idx].read = updates.read
      if (typeof updates.archived !== 'undefined') messages[idx].archived = updates.archived

      await atomicWriteJson(filePath, messages)
      return res.json(messages[idx])
    }

    res.status(404).json({ error: 'message not found' })
  } catch (err) {
    next(err)
  }
})
