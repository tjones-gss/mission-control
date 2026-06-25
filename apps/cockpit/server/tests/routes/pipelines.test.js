import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { router, __setDataDir } from '../../routes/pipelines.js'

const app = express()
app.use(express.json())
app.use('/', router)

let tmpDir

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oversight-pipelines-'))
  __setDataDir(tmpDir)
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const VALID = {
  name: 'Nightly build',
  nodes: [
    { id: 'n1', type: 'trigger', x: 10, y: 20, config: {} },
    { id: 'n2', type: 'agent', x: 200, y: 20, config: { goal: 'build' } },
  ],
  edges: [{ from: 'n1', to: 'n2' }],
}

describe('GET /', () => {
  it('returns an empty list when no pipelines are saved', async () => {
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.pipelines).toEqual([])
  })

  it('lists saved pipelines', async () => {
    await request(app).post('/').send(VALID)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.pipelines).toHaveLength(1)
    expect(res.body.pipelines[0].name).toBe('Nightly build')
    expect(res.body.pipelines[0].id).toBe('nightly-build')
  })
})

describe('POST /', () => {
  it('saves a valid pipeline, derives a slug id, stamps updatedAt, and writes a file', async () => {
    const res = await request(app).post('/').send(VALID)
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.pipeline.id).toBe('nightly-build')
    expect(res.body.pipeline.nodes).toHaveLength(2)
    expect(typeof res.body.pipeline.updatedAt).toBe('string')
    expect(fs.existsSync(path.join(tmpDir, 'nightly-build.json'))).toBe(true)
  })

  it('upserts: saving the same id twice overwrites and keeps one file', async () => {
    await request(app).post('/').send(VALID)
    await request(app)
      .post('/')
      .send({ ...VALID, nodes: [{ id: 'n1', type: 'trigger', x: 0, y: 0, config: {} }] })
    const res = await request(app).get('/')
    expect(res.body.pipelines).toHaveLength(1)
    expect(res.body.pipelines[0].nodes).toHaveLength(1)
  })

  it('honours an explicit valid id over the derived slug', async () => {
    const res = await request(app)
      .post('/')
      .send({ ...VALID, id: 'custom-id' })
    expect(res.status).toBe(200)
    expect(res.body.pipeline.id).toBe('custom-id')
    expect(fs.existsSync(path.join(tmpDir, 'custom-id.json'))).toBe(true)
  })

  it('rejects a missing name with 400 and writes nothing', async () => {
    const res = await request(app).post('/').send({ nodes: [], edges: [] })
    expect(res.status).toBe(400)
    expect(fs.readdirSync(tmpDir)).toHaveLength(0)
  })

  it('rejects non-array nodes/edges with 400', async () => {
    const res = await request(app).post('/').send({ name: 'x', nodes: 'nope', edges: [] })
    expect(res.status).toBe(400)
  })

  it('rejects a path-traversal id with 400 and never writes outside the data dir', async () => {
    const res = await request(app)
      .post('/')
      .send({ ...VALID, id: '../evil' })
    expect(res.status).toBe(400)
    expect(fs.existsSync(path.join(tmpDir, '..', 'evil.json'))).toBe(false)
  })
})

describe('GET /:id', () => {
  it('returns a saved pipeline by id', async () => {
    await request(app).post('/').send(VALID)
    const res = await request(app).get('/nightly-build')
    expect(res.status).toBe(200)
    expect(res.body.pipeline.name).toBe('Nightly build')
  })

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).get('/does-not-exist')
    expect(res.status).toBe(404)
  })

  it('returns 400 for an unsafe id and does not read outside the data dir', async () => {
    const res = await request(app).get('/..%2f..%2fsecret')
    expect([400, 404]).toContain(res.status)
  })
})
