// Pipeline persistence routes — store/load drag-drop pipeline canvas state.
//
// SCOPE: this router ONLY persists canvas definitions to server/data/pipelines/
// as one JSON per pipeline. It does NOT run anything. Running a pipeline is the
// client's job: it serialises the canvas to a Fleet batch spec ({ goal, children,
// policy }) and POSTs to the EXISTING /api/fleet route. No new runner, no new
// execution path here (V2 constraint: "No new API routes" for execution).

import { Router } from 'express'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteJson } from '../lib/atomic-write.js'
import { logger } from '../lib/logger.js'

export const router = Router()

// Persisted alongside the server (server/data/pipelines), resolved relative to
// this file so cwd doesn't matter. Tests override via __setDataDir.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
let DATA_DIR = path.resolve(__dirname, '..', 'data', 'pipelines')

// Test-only: point persistence at a temp dir between cases.
export function __setDataDir(dir) {
  DATA_DIR = dir
}

// A filesystem-safe id: lowercase slug, no separators, no traversal. This is the
// only thing that ever touches the filesystem path, so it is the security
// boundary — anything not matching is rejected before a read/write is attempted.
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function isSafeId(id) {
  return typeof id === 'string' && SAFE_ID.test(id) && id.length <= 128
}

function readPipeline(id) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, `${id}.json`), 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

// GET /api/pipelines — list saved pipeline definitions.
router.get('/', (_req, res) => {
  let names = []
  try {
    names = fs.readdirSync(DATA_DIR).filter((n) => n.endsWith('.json'))
  } catch {
    names = []
  }
  const pipelines = []
  for (const name of names) {
    const def = readPipeline(name.slice(0, -'.json'.length))
    if (def) pipelines.push(def)
  }
  res.json({ pipelines })
})

// GET /api/pipelines/:id — load one definition.
router.get('/:id', (req, res) => {
  const { id } = req.params
  if (!isSafeId(id)) return res.status(400).json({ error: 'invalid id' })
  const def = readPipeline(id)
  if (!def) return res.status(404).json({ error: 'not found' })
  res.json({ pipeline: def })
})

// POST /api/pipelines — save (upsert) a canvas definition.
router.post('/', async (req, res) => {
  const body = req.body || {}
  const { name, nodes, edges } = body

  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' })
  }
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return res.status(400).json({ error: 'nodes and edges must be arrays' })
  }

  // Explicit id wins; otherwise derive from the name. Either way it must be safe.
  const id = body.id != null ? body.id : slugify(name)
  if (!isSafeId(id)) {
    return res.status(400).json({ error: 'invalid id' })
  }

  const pipeline = { id, name, nodes, edges, updatedAt: new Date().toISOString() }

  try {
    await fsp.mkdir(DATA_DIR, { recursive: true })
    await atomicWriteJson(path.join(DATA_DIR, `${id}.json`), pipeline)
  } catch (err) {
    logger.warn({ detail: err.message }, 'pipeline_save_failed')
    return res.status(502).json({ ok: false, error: err.message })
  }

  res.status(200).json({ ok: true, pipeline })
})
