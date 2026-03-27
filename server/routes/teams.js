import { Router } from 'express'
import { getAllTeams } from '../parsers/teams.js'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'

const TEAMS_DIR = path.join(os.homedir(), '.claude', 'teams')

export const router = Router()

router.get('/', (req, res) => res.json(getAllTeams()))

router.post('/:name/inbox', (req, res) => {
  const { name } = req.params
  const { content, sender = 'user' } = req.body

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'content is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  if (!fs.existsSync(teamPath)) {
    return res.status(404).json({ error: 'team not found' })
  }

  const inboxesPath = path.join(teamPath, 'inboxes')
  if (!fs.existsSync(inboxesPath)) fs.mkdirSync(inboxesPath, { recursive: true })

  const dashboardFile = path.join(inboxesPath, 'dashboard.json')
  let messages = []
  if (fs.existsSync(dashboardFile)) {
    try { messages = JSON.parse(fs.readFileSync(dashboardFile, 'utf-8')) } catch { messages = [] }
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
  fs.writeFileSync(dashboardFile, JSON.stringify(messages, null, 2))
  res.status(201).json(message)
})

router.patch('/:name/inbox/:messageId', (req, res) => {
  const { name, messageId } = req.params
  const updates = req.body

  if (typeof updates.read === 'undefined' && typeof updates.archived === 'undefined') {
    return res.status(400).json({ error: 'read or archived is required' })
  }

  const teamPath = path.join(TEAMS_DIR, name)
  if (!fs.existsSync(teamPath)) {
    return res.status(404).json({ error: 'team not found' })
  }

  const inboxesPath = path.join(teamPath, 'inboxes')
  if (!fs.existsSync(inboxesPath)) {
    return res.status(404).json({ error: 'message not found' })
  }

  for (const file of fs.readdirSync(inboxesPath).filter(f => f.endsWith('.json'))) {
    const filePath = path.join(inboxesPath, file)
    let messages
    try { messages = JSON.parse(fs.readFileSync(filePath, 'utf-8')) } catch { continue }

    const idx = messages.findIndex(m => m.id === messageId)
    if (idx === -1) continue

    if (typeof updates.read !== 'undefined') messages[idx].read = updates.read
    if (typeof updates.archived !== 'undefined') messages[idx].archived = updates.archived

    fs.writeFileSync(filePath, JSON.stringify(messages, null, 2))
    return res.json(messages[idx])
  }

  res.status(404).json({ error: 'message not found' })
})
