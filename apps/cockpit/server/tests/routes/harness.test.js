import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../parsers/harness.js', () => ({
  getHarnessProjects: vi.fn().mockReturnValue([]),
  getHarnessProjectByPath: vi.fn().mockReturnValue(null),
  getKnownHarnessRoots: vi.fn().mockReturnValue([]),
}))
vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn().mockResolvedValue({
    stdout: '{"type":"result","result":"ok"}\n',
    stderr: '',
    exitCode: 0,
  }),
  runClaudeCancellable: vi.fn().mockImplementation(() => ({
    promise: Promise.resolve({
      stdout: '{"type":"result","result":"ok"}\n',
      stderr: '',
      exitCode: 0,
    }),
    cancel: vi.fn(),
  })),
}))
vi.mock('../../lib/atomic-write.js', () => ({
  atomicWrite: vi.fn().mockResolvedValue(undefined),
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/pending-session.js', () => ({
  awaitNewSession: vi.fn().mockResolvedValue('pending-session-id'),
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
vi.mock('fs', () => {
  const mkdir = vi.fn().mockResolvedValue(undefined)
  const writeFile = vi.fn().mockResolvedValue(undefined)
  const promises = { mkdir, writeFile, rename: vi.fn(), unlink: vi.fn() }
  // sessions.js (imported transitively for parseStreamJsonStdout) runs sync fs
  // side effects at module load (mkdirSync/readdirSync for its upload dir), so
  // the mock must provide those too or the import throws.
  const sync = {
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ mtimeMs: Date.now() })),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(() => '{}'),
    writeFileSync: vi.fn(),
    existsSync: vi.fn(() => true),
  }
  return { promises, default: { promises, ...sync }, ...sync }
})
vi.mock('multer', () => {
  const instance = { single: () => (_req, _res, next) => next() }
  const fn = () => instance
  fn.diskStorage = () => ({})
  return { default: fn }
})
vi.mock('../../pty-session.js', () => ({
  startQuery: vi.fn(),
  spawnNewSession: vi.fn(),
  isQueryActive: vi.fn(() => false),
  getQueryStatus: vi.fn(() => ({ active: false, pendingApprovals: [] })),
  resolveApproval: vi.fn(() => true),
  cancelQuery: vi.fn(() => true),
  VALID_PERMISSION_MODES: new Set(['plan', 'auto', 'default']),
  VALID_MODEL_SHORTCUTS: new Set(['sonnet', 'opus', 'haiku']),
}))

import express from 'express'
import request from 'supertest'
import { promises as fsp } from 'fs'
import {
  getHarnessProjects,
  getHarnessProjectByPath,
  getKnownHarnessRoots,
} from '../../parsers/harness.js'
import { runClaude, runClaudeCancellable } from '../../claude-cli.js'
import { atomicWrite } from '../../lib/atomic-write.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { router } from '../../routes/harness.js'

const app = express()
app.use(express.json())
app.use('/', router)

const PROJECT = 'C:/proj'
const KEY = encodeURIComponent(PROJECT)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('GET /', () => {
  it('returns 200 with a projects array', async () => {
    getHarnessProjects.mockReturnValue([])
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.projects)).toBe(true)
  })

  it('wraps the parser output under { projects }', async () => {
    const projects = [{ projectPath: 'C:/x', available: true }]
    getHarnessProjects.mockReturnValue(projects)
    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ projects })
  })
})

describe('GET /:projectKey', () => {
  it('404 when the path is not a known harness root (whitelist miss)', async () => {
    getHarnessProjectByPath.mockReturnValue(null)
    const res = await request(app).get(`/${encodeURIComponent('C:/unknown')}`)
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })

  it('200 with the detail object when the parser hits', async () => {
    const detail = { projectPath: 'C:/x', projectLabel: 'x', project: { mode: 'idea-to-mvp' } }
    getHarnessProjectByPath.mockReturnValue(detail)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(detail)
  })

  it('200 passing through an available:false detail (available:false is a valid contract result)', async () => {
    const detail = {
      available: false,
      error: 'harness unavailable: python/python3 not found or harness script missing',
      projectPath: 'C:/x',
      projectLabel: 'x',
    }
    getHarnessProjectByPath.mockReturnValue(detail)
    const res = await request(app).get(`/${encodeURIComponent('C:/x')}`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(detail)
  })
})

// ─── POST /:projectKey/roadmap/compile ───────────────────────────────────────

describe('POST /:projectKey/roadmap/compile', () => {
  it('200 happy path: writes spec, runs mission-writer, returns summary', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({
      stdout: '{"type":"result","result":"Sliced into 3 missions (draft)"}\n',
      stderr: '',
      exitCode: 0,
    })

    const res = await request(app)
      .post(`/${KEY}/roadmap/compile`)
      .send({ roadmap: 'Build auth, then billing, then dashboards.', title: 'Q3 Plan' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.specPath).toMatch(/SPEC-q3-plan\.md$/)
    expect(res.body.summary).toMatch(/Sliced into 3 missions/)

    // The spec file write was attempted.
    expect(atomicWrite).toHaveBeenCalledTimes(1)
    const [writtenPath, writtenBody] = atomicWrite.mock.calls[0]
    expect(writtenPath).toMatch(/SPEC-q3-plan\.md$/)
    expect(writtenBody).toContain('roadmap compiler')
    expect(writtenBody).toContain('Build auth, then billing')
    expect(fsp.mkdir).toHaveBeenCalled()

    // The prompt invokes the mission-writer skill and pins draft status.
    const argv = runClaude.mock.calls.at(-1)[0]
    expect(argv.cwd).toBe(PROJECT)
    const prompt = argv.args[argv.args.indexOf('-p') + 1]
    expect(prompt).toContain('/mission-writer')
    expect(prompt).toContain('status: draft')
    expect(prompt).toMatch(/do not implement/i)
    expect(argv.args).toContain('--output-format')
    expect(argv.args[argv.args.indexOf('--output-format') + 1]).toBe('stream-json')
  })

  it('uses a timestamp slug when no title is given', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({ stdout: '{"type":"result","result":"ok"}\n', stderr: '', exitCode: 0 })
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: 'Do the thing.' })
    expect(res.status).toBe(200)
    expect(res.body.specPath).toMatch(/SPEC-\d{4}-\d{2}-\d{2}T/)
  })

  it('400 when roadmap is missing', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ title: 'x' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/roadmap is required/i)
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('400 when roadmap is an empty string', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: '   ' })
    expect(res.status).toBe(400)
  })

  it('404 when projectKey is not a known harness root', async () => {
    getKnownHarnessRoots.mockReturnValue([]) // whitelist miss
    const res = await request(app)
      .post(`/${encodeURIComponent('C:/evil')}/roadmap/compile`)
      .send({ roadmap: 'rm everything' })
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
    // Never wrote or spawned into a non-whitelisted path.
    expect(atomicWrite).not.toHaveBeenCalled()
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('502 when the claude run fails', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockRejectedValue(
      Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
        stderrOutput: 'boom',
      }),
    )
    const res = await request(app)
      .post(`/${KEY}/roadmap/compile`)
      .send({ roadmap: 'Build it.' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/code=1/)
  })
})

// ─── POST /:projectKey/missions/:missionId/execute ───────────────────────────

describe('POST /:projectKey/missions/:missionId/execute', () => {
  const MISSION = 'MISSION-001-auth'

  function mockMissions(missions) {
    getHarnessProjectByPath.mockResolvedValue({
      projectPath: PROJECT,
      projectLabel: 'proj',
      missions,
    })
  }

  it('202 started happy path with sessionId from the watcher ack', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ [MISSION]: { file: 'runs/missions/MISSION-001-auth.md', status: 'draft' } })
    runClaudeCancellable.mockReturnValue({
      promise: new Promise(() => {}), // stays pending so the ack wins
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('impl-sess-9')

    const res = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})

    expect(res.status).toBe(202)
    expect(res.body).toEqual({ ok: true, status: 'started', sessionId: 'impl-sess-9' })

    // Spawned on-rails in the project cwd with the mission name + file in prompt.
    const argv = runClaudeCancellable.mock.calls.at(-1)[0]
    expect(argv.cwd).toBe(PROJECT)
    expect(argv.args).toContain('--name')
    expect(argv.args[argv.args.indexOf('--name') + 1]).toBe(MISSION)
    const prompt = argv.args[argv.args.indexOf('-p') + 1]
    expect(prompt).toContain(MISSION)
    expect(prompt).toContain('runs/missions/MISSION-001-auth.md')
    expect(prompt).toMatch(/on-rails/i)
    expect(prompt).toMatch(/Validation Commands/i)
  })

  it('202 started when the CLI completes before the watcher ack', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ [MISSION]: { file: 'runs/missions/MISSION-001-auth.md' } })
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe('started')
  })

  it('404 when the missionId is unknown', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ 'MISSION-other': { file: 'runs/missions/other.md' } })
    const res = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404 when the project has no missions map', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    getHarnessProjectByPath.mockResolvedValue({ projectPath: PROJECT, available: false })
    const res = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(res.status).toBe(404)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404 when the projectKey is not a known harness root', async () => {
    getKnownHarnessRoots.mockReturnValue([]) // whitelist miss
    const res = await request(app)
      .post(`/${encodeURIComponent('C:/evil')}/missions/${MISSION}/execute`)
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
    expect(getHarnessProjectByPath).not.toHaveBeenCalled()
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('502 when the spawn rejects before any ack', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ [MISSION]: { file: 'runs/missions/MISSION-001-auth.md' } })
    const err = Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
      stderrOutput: 'spawn boom',
    })
    const p = Promise.reject(err)
    p.catch(() => {}) // suppress unhandledRejection at the vitest process level
    runClaudeCancellable.mockReturnValue({ promise: p, cancel: vi.fn() })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves

    const res = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/code=1/)
  })
})
