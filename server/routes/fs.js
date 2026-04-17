import { Router } from 'express'
import os from 'os'
import path from 'path'
import fs from 'fs'

export const router = Router()

router.get('/home', (_req, res) => {
  res.json({ path: os.homedir(), sep: path.sep })
})

// This endpoint performs an unrestricted directory listing of the host filesystem.
// Oversight is a local-only dashboard run by a single user against their own
// machine; the trust boundary is the listen port (bound to localhost by default),
// not per-request path sandboxing. Do not expose this server to other machines
// without adding an allowlist or authentication in front of it.
router.get('/list', async (req, res) => {
  const requested = req.query.path
  if (!requested || typeof requested !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }
  if (requested.includes('\u0000')) {
    return res.status(400).json({ error: 'path contains NUL byte' })
  }
  if (!path.isAbsolute(requested)) {
    return res.status(400).json({ error: 'path must be absolute' })
  }

  const abs = path.normalize(requested)

  let stat
  try {
    stat = await fs.promises.stat(abs)
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'not found' })
    }
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'permission denied' })
    }
    return res.status(500).json({ error: 'stat failed', detail: err.message })
  }

  if (!stat.isDirectory()) {
    return res.status(400).json({ error: 'not a directory' })
  }

  let entries
  try {
    const dirents = await fs.promises.readdir(abs, { withFileTypes: true })
    entries = dirents
      .filter((d) => d.isDirectory())
      .map((d) => ({ name: d.name, type: 'dir' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  } catch (err) {
    if (err.code === 'EACCES') {
      return res.status(403).json({ error: 'permission denied' })
    }
    return res.status(500).json({ error: 'readdir failed', detail: err.message })
  }

  const parentCandidate = path.dirname(abs)
  const parent = parentCandidate === abs ? null : parentCandidate

  res.json({ path: abs, parent, sep: path.sep, entries })
})
