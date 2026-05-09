import { Router } from 'express'
import { getConductorRuns, getConductorRunById, readRunFile } from '../parsers/conductor.js'

export const router = Router()

const ADR_RE = /^\d{4}$/

router.get('/', (_req, res) => {
  res.json(getConductorRuns())
})

router.get('/:projectKey/:adr', (req, res) => {
  const { projectKey, adr } = req.params
  if (!ADR_RE.test(adr)) {
    return res.status(400).json({ error: 'invalid_adr', detail: 'ADR must be 4 digits' })
  }
  let projectPath
  try {
    projectPath = decodeURIComponent(projectKey)
  } catch {
    return res.status(400).json({ error: 'invalid_project_key' })
  }
  const run = getConductorRunById(projectPath, adr)
  if (!run) return res.status(404).json({ error: 'not_found' })
  res.json(run)
})

const FILE_KIND_BY_PARAM = {
  journal: 'journalDraft',
  ratification: 'ratificationProposal',
  'skill-diff': 'skillDiffProposal',
  plan: 'plan',
  status: 'status',
}

router.get('/:projectKey/:adr/:kind', (req, res) => {
  const { projectKey, adr, kind } = req.params
  const fileKind = FILE_KIND_BY_PARAM[kind]
  if (!fileKind) {
    return res.status(404).json({ error: 'unknown_kind' })
  }
  if (!ADR_RE.test(adr)) {
    return res.status(400).json({ error: 'invalid_adr' })
  }
  let projectPath
  try {
    projectPath = decodeURIComponent(projectKey)
  } catch {
    return res.status(400).json({ error: 'invalid_project_key' })
  }
  const content = readRunFile(projectPath, adr, fileKind)
  if (content === null) return res.status(404).json({ error: 'not_found' })
  // Plain text response — the client renders journal/ratification/skill-diff
  // as markdown, and plan/status as JSON-formatted text. Keeping this as
  // text/plain avoids tripping JSON parsing on malformed content.
  res.type('text/plain').send(content)
})
