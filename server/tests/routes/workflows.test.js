vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises,
  }
})
vi.mock('../../parsers/workflows.js', () => ({ getAllWorkflows: vi.fn().mockReturnValue([]) }))

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import { getAllWorkflows } from '../../parsers/workflows.js'
import { router } from '../../routes/workflows.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── GET / ──────────────────────────────────────────────────────────────────

describe('GET /', () => {
  it('returns the result of getAllWorkflows()', async () => {
    getAllWorkflows.mockReturnValue([{ name: 'a' }])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ name: 'a' }])
  })
})

// ─── POST / ─────────────────────────────────────────────────────────────────

describe('POST /', () => {
  it('400 when name is missing', async () => {
    const res = await request(app).post('/').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/name is required/i)
  })

  it('400 when name contains a space', async () => {
    const res = await request(app).post('/').send({ name: 'my workflow' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('400 when name contains a slash', async () => {
    const res = await request(app).post('/').send({ name: 'my/workflow' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('400 when name is ".."', async () => {
    const res = await request(app).post('/').send({ name: '..' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('409 when file already exists (access resolves)', async () => {
    fsp.access.mockResolvedValue(undefined)
    const res = await request(app).post('/').send({ name: 'myworkflow' })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('201 with correct body shape on success', async () => {
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)
    getAllWorkflows.mockReturnValue([])

    const res = await request(app)
      .post('/')
      .send({
        name: 'myworkflow',
        description: 'A test workflow',
        steps: [{ title: 'Step A', type: 'instruction', text: 'Do something' }],
      })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      name: 'myworkflow',
      description: 'A test workflow',
      steps: expect.any(Array),
    })
    expect(typeof res.body.createdAt).toBe('number')
    expect(typeof res.body.updatedAt).toBe('number')
  })
})

// ─── PUT /:name ──────────────────────────────────────────────────────────────

describe('PUT /:name', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).put('/bad name').send({ description: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('404 when file not found', async () => {
    const err = new Error('not found')
    err.code = 'ENOENT'
    fsp.readFile.mockRejectedValue(err)
    const res = await request(app).put('/missing').send({ description: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('200 with merged body; name comes from URL not body', async () => {
    const existing = {
      name: 'myworkflow',
      description: 'old',
      steps: [],
      createdAt: 1000,
      updatedAt: 1000,
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(existing))
    fsp.writeFile.mockResolvedValue(undefined)

    const res = await request(app).put('/myworkflow').send({ name: 'sneaky', description: 'new' })
    expect(res.status).toBe(200)
    expect(res.body.name).toBe('myworkflow')
    expect(res.body.description).toBe('new')
  })

  it('updatedAt is updated', async () => {
    const before = Date.now() - 1000
    const existing = {
      name: 'wf',
      description: 'old',
      steps: [],
      createdAt: before,
      updatedAt: before,
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(existing))
    fsp.writeFile.mockResolvedValue(undefined)

    const res = await request(app).put('/wf').send({ description: 'newer' })
    expect(res.status).toBe(200)
    expect(res.body.updatedAt).toBeGreaterThan(before)
  })
})

// ─── DELETE /:name ───────────────────────────────────────────────────────────

describe('DELETE /:name', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).delete('/bad name')
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('404 when not found', async () => {
    const err = new Error('not found')
    err.code = 'ENOENT'
    fsp.unlink.mockRejectedValue(err)
    const res = await request(app).delete('/missing')
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
  })

  it('200 with {ok: true, name} on success', async () => {
    fsp.unlink.mockResolvedValue(undefined)
    const res = await request(app).delete('/myworkflow')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, name: 'myworkflow' })
  })
})

// ─── POST /:name/export ──────────────────────────────────────────────────────

describe('POST /:name/export', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).post('/bad name/export').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
  })

  it('404 when workflow file not found', async () => {
    const err = new Error('not found')
    err.code = 'ENOENT'
    fsp.readFile.mockRejectedValue(err)
    const res = await request(app).post('/missing/export').send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/workflow not found/i)
  })

  it('409 when skill already exists', async () => {
    const workflow = { name: 'myworkflow', description: 'desc', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockResolvedValue(undefined) // skill file exists
    const res = await request(app).post('/myworkflow/export').send({})
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/already exists/i)
  })

  it('200 success when workflow found and skill not found', async () => {
    const workflow = { name: 'myworkflow', description: 'desc', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' }) // skill does not exist
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    const res = await request(app).post('/myworkflow/export').send({})
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, name: 'myworkflow' })
  })

  it('overwrite: true bypasses 409 check', async () => {
    const workflow = { name: 'myworkflow', description: 'desc', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    // access would resolve (file exists) but overwrite bypasses check
    fsp.access.mockResolvedValue(undefined)
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    const res = await request(app).post('/myworkflow/export').send({ overwrite: true })
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  // ── stepContent tests via generateSkillMd output ───────────────────────────

  it('skill step without note → content includes Invoke the `/foo` skill.', async () => {
    const workflow = {
      name: 'wf',
      description: '',
      steps: [{ type: 'skill', skillName: 'foo', title: 'Use foo' }],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    await request(app).post('/wf/export').send({})

    const written = fsp.writeFile.mock.calls[0][1]
    expect(written).toContain('Invoke the `/foo` skill.')
  })

  it('skill step with note → note appended after skill invocation line', async () => {
    const workflow = {
      name: 'wf',
      description: '',
      steps: [{ type: 'skill', skillName: 'foo', note: 'Pay attention!', title: 'Use foo' }],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    await request(app).post('/wf/export').send({})

    const written = fsp.writeFile.mock.calls[0][1]
    expect(written).toContain('Invoke the `/foo` skill.')
    expect(written).toContain('Pay attention!')
  })

  it('agent step → content includes Spawn a `general-purpose` agent', async () => {
    const workflow = {
      name: 'wf',
      description: '',
      steps: [
        {
          type: 'agent',
          agentType: 'general-purpose',
          prompt: 'Do the thing',
          title: 'Agent step',
        },
      ],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    await request(app).post('/wf/export').send({})

    const written = fsp.writeFile.mock.calls[0][1]
    expect(written).toContain('Spawn a `general-purpose` agent with this prompt:')
  })

  it('instruction step → raw step.text in content', async () => {
    const workflow = {
      name: 'wf',
      description: '',
      steps: [
        {
          type: 'instruction',
          text: 'Review all open PRs before proceeding.',
          title: 'Instruction',
        },
      ],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    await request(app).post('/wf/export').send({})

    const written = fsp.writeFile.mock.calls[0][1]
    expect(written).toContain('Review all open PRs before proceeding.')
  })

  it('command step → content includes Run: `npm run build`', async () => {
    const workflow = {
      name: 'wf',
      description: '',
      steps: [{ type: 'command', command: 'npm run build', title: 'Build' }],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    fsp.access.mockRejectedValue({ code: 'ENOENT' })
    fsp.mkdir.mockResolvedValue(undefined)
    fsp.writeFile.mockResolvedValue(undefined)

    await request(app).post('/wf/export').send({})

    const written = fsp.writeFile.mock.calls[0][1]
    expect(written).toContain('Run: `npm run build`')
  })
})
