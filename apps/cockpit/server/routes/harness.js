import { Router } from 'express'
import { getHarnessProjects, getHarnessProjectByPath } from '../parsers/harness.js'

export const router = Router()

router.get('/', async (_req, res) => {
  res.json({ projects: await getHarnessProjects() })
})

router.get('/:projectKey', async (req, res) => {
  const { projectKey } = req.params
  let projectPath
  try {
    projectPath = decodeURIComponent(projectKey)
  } catch {
    return res.status(400).json({ error: 'invalid_project_key' })
  }
  // Whitelist check lives in the parser: getHarnessProjectByPath returns null
  // when projectPath is not a known harness root, so we never shell out to an
  // arbitrary path.
  const detail = await getHarnessProjectByPath(projectPath)
  if (!detail) return res.status(404).json({ error: 'not_found' })
  res.json(detail)
})
