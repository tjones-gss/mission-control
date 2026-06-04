vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
    // rename is required by lib/atomic-write.js (writeFile-then-rename pattern).
    // Without it every write path turns into a 500.
    rename: vi.fn(),
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
vi.mock('../../claude-cli.js', () => ({
  runClaudeCancellable: vi.fn().mockImplementation(() => ({
    promise: Promise.resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 }),
    cancel: vi.fn(),
  })),
}))
vi.mock('../../lib/pending-session.js', () => ({
  awaitNewSession: vi.fn().mockResolvedValue('pending-session-id'),
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import { getAllWorkflows } from '../../parsers/workflows.js'
import { runClaudeCancellable } from '../../claude-cli.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { router, __resetInFlight } from '../../routes/workflows.js'

const app = express()
app.use(express.json())
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
  // atomic-write.rename must succeed by default or every write path is 500
  fsp.rename.mockResolvedValue(undefined)
  // Clear the module-level concurrency registry so a test that intentionally
  // leaves a run in flight (pending CLI promise) doesn't leak a held lock key
  // into the next test.
  __resetInFlight()
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

// ─── POST /:name/run ──────────────────────────────────────────────────────────

describe('POST /:name/run', () => {
  it('400 when name is invalid', async () => {
    const res = await request(app).post('/bad name/run').send({})
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/invalid workflow name/i)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404 when the workflow file does not exist', async () => {
    fsp.readFile.mockRejectedValue({ code: 'ENOENT' })
    const res = await request(app).post('/missing/run').send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/workflow not found/i)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('202 started: spawns with the composed prompt built from the steps', async () => {
    const workflow = {
      name: 'deploy',
      description: 'Ship it safely',
      steps: [
        { type: 'instruction', text: 'Review open PRs.', title: 'Review' },
        { type: 'command', command: 'npm run build', title: 'Build' },
      ],
    }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    runClaudeCancellable.mockReturnValue({
      promise: new Promise(() => {}), // stays pending so the ack wins
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('wf-sess-7')

    const res = await request(app).post('/deploy/run').send({})

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true, status: 'started', sessionId: 'wf-sess-7' })

    // Spawned with the workflow name + a prompt composed from the steps.
    const argv = runClaudeCancellable.mock.calls.at(-1)[0]
    expect(argv.args).toContain('--name')
    expect(argv.args[argv.args.indexOf('--name') + 1]).toBe('deploy')
    expect(argv.args).toContain('--output-format')
    expect(argv.args[argv.args.indexOf('--output-format') + 1]).toBe('stream-json')
    const prompt = argv.args[argv.args.indexOf('-p') + 1]
    expect(prompt).toContain('Run the "deploy" workflow.')
    expect(prompt).toContain('Ship it safely')
    expect(prompt).toContain('## Step 1: Review')
    expect(prompt).toContain('Review open PRs.')
    expect(prompt).toContain('## Step 2: Build')
    expect(prompt).toContain('Run: `npm run build`')
  })

  it('202 started when the CLI completes before the watcher ack', async () => {
    const workflow = { name: 'wf', description: '', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post('/wf/run').send({})
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe('started')
  })

  it('409 in_progress for a concurrent run of the same workflow — does NOT spawn twice', async () => {
    const workflow = { name: 'wf', description: '', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    // First run stays in flight (CLI promise pending) and the ack also never
    // resolves, so the first request holds the lock while the second arrives.
    let releaseCli
    runClaudeCancellable.mockReturnValue({
      promise: new Promise((resolve) => {
        releaseCli = () => resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 })
      }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('wf-sess-1')

    const first = await request(app).post('/wf/run').send({})
    expect(first.status).toBe(202)

    const second = await request(app).post('/wf/run').send({})
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)

    // Settle the first CLI run so the lock releases (no leak).
    releaseCli()
    await new Promise((r) => setImmediate(r))
  })

  it('releases the lock after the CLI settles — a later run of the same workflow spawns again', async () => {
    const workflow = { name: 'wf', description: '', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves; CLI wins

    const first = await request(app).post('/wf/run').send({})
    expect(first.status).toBe(202)
    // Let the taggedCli.finally release the lock.
    await new Promise((r) => setImmediate(r))

    const second = await request(app).post('/wf/run').send({})
    expect(second.status).toBe(202)
    expect(runClaudeCancellable).toHaveBeenCalledTimes(2)
  })

  it('502 when the spawn rejects before any ack', async () => {
    const workflow = { name: 'wf', description: '', steps: [] }
    fsp.readFile.mockResolvedValue(JSON.stringify(workflow))
    const err = Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
      stderrOutput: 'spawn boom',
    })
    const p = Promise.reject(err)
    p.catch(() => {}) // suppress unhandledRejection at the vitest process level
    runClaudeCancellable.mockReturnValue({ promise: p, cancel: vi.fn() })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post('/wf/run').send({})
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/code=1/)
  })
})
