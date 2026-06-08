import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../parsers/harness.js', () => ({
  getHarnessProjects: vi.fn().mockReturnValue([]),
  getHarnessProjectByPath: vi.fn().mockReturnValue(null),
  getKnownHarnessRoots: vi.fn().mockReturnValue([]),
  getScaffoldCandidates: vi.fn().mockReturnValue([]),
  runHarnessScaffold: vi.fn().mockResolvedValue({ ok: true }),
  // The route imports this as a real array (used in an .includes() check), so
  // the mock must provide the literal, not a vi.fn().
  VALID_HARNESS_MODES: [
    'idea-to-mvp',
    'mvp-sketch',
    'existing-repo-retrofit',
    'feature-development',
    'bugfix',
    'refactor',
    'release-readiness',
  ],
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
  const promises = { mkdir, writeFile, rename: vi.fn(), unlink: vi.fn(), access: vi.fn() }
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
import { readFileSync } from 'node:fs'
import nodePath from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { promises as fsp } from 'fs'
import {
  getHarnessProjects,
  getHarnessProjectByPath,
  getKnownHarnessRoots,
  getScaffoldCandidates,
  runHarnessScaffold,
} from '../../parsers/harness.js'
import { runClaude, runClaudeCancellable } from '../../claude-cli.js'
import { atomicWrite } from '../../lib/atomic-write.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { router, __resetInFlight } from '../../routes/harness.js'

const app = express()
app.use(express.json())
app.use('/', router)

const PROJECT = 'C:/proj'
const KEY = encodeURIComponent(PROJECT)

beforeEach(() => {
  vi.resetAllMocks()
  // Default: the spec file does NOT pre-exist (fresh compile). Tests that need a
  // pre-existing spec override fsp.access to resolve.
  fsp.access.mockRejectedValue(new Error('ENOENT'))
  // Clear the module-level concurrency registry so a test that intentionally
  // leaves a run in flight (pending CLI promise) doesn't leak a held lock key
  // into the next test.
  __resetInFlight()
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

describe('GET /scaffold-candidates', () => {
  it('returns the candidate directories under { candidates }', async () => {
    getScaffoldCandidates.mockReturnValue(['C:/work/a', 'C:/work/b'])
    const res = await request(app).get('/scaffold-candidates')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ candidates: ['C:/work/a', 'C:/work/b'] })
  })

  it('is NOT captured by the /:projectKey param route', async () => {
    // If '/:projectKey' shadowed this, getHarnessProjectByPath would run instead.
    getScaffoldCandidates.mockReturnValue([])
    const res = await request(app).get('/scaffold-candidates')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('candidates')
    expect(getHarnessProjectByPath).not.toHaveBeenCalled()
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

    // The prompt is SELF-CONTAINED: it must NOT rely on the /mission-writer
    // slash command (unrecognized in projects without the Claude adapter →
    // silent no-op), but must still inline the mission-writing directives.
    const argv = runClaude.mock.calls.at(-1)[0]
    expect(argv.cwd).toBe(PROJECT)
    const prompt = argv.args[argv.args.indexOf('-p') + 1]
    expect(prompt).not.toContain('/mission-writer')
    expect(prompt.toLowerCase()).toContain('mission-writer') // acts AS one, inline
    expect(prompt).toContain('status: draft')
    expect(prompt).toContain('agents/templates/mission-template.md')
    expect(prompt).toMatch(/do not implement/i)
    expect(argv.args).toContain('--output-format')
    expect(argv.args[argv.args.indexOf('--output-format') + 1]).toBe('stream-json')
    // A headless claude -p denies file edits by default — without a permission
    // mode the mission-writer cannot write any missions. Must request acceptEdits.
    expect(argv.args).toContain('--permission-mode')
    expect(argv.args[argv.args.indexOf('--permission-mode') + 1]).toBe('acceptEdits')
  })

  it('uses a timestamp slug when no title is given', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({
      stdout: '{"type":"result","result":"ok"}\n',
      stderr: '',
      exitCode: 0,
    })
    const res = await request(app)
      .post(`/${KEY}/roadmap/compile`)
      .send({ roadmap: 'Do the thing.' })
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

  it('502 when the claude run fails — and surfaces the real stderr to the client', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockRejectedValue(
      Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
        stderrOutput: 'Error: When using --print, --output-format=stream-json requires --verbose\n',
      }),
    )
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: 'Build it.' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/code=1/)
    // The actionable cause must reach the client, not just the server log.
    expect(res.body.stderr).toMatch(/requires --verbose/)
  })

  it('504 (not 502) when the claude run times out', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockRejectedValue(
      Object.assign(new Error('claude CLI timed out after 300s'), { stderrOutput: '' }),
    )
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: 'Build it.' })
    expect(res.status).toBe(504)
    expect(res.body.ok).toBe(false)
  })

  it('502 when the run completes but produced NO result event (silent no-op guard)', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    // stream-json with only an assistant event, no type:"result" — e.g. an
    // unrecognized slash command or an interrupted run. Must NOT be reported as
    // a fake ok:true success.
    runClaude.mockResolvedValue({
      stdout: '{"type":"assistant","message":{}}\n',
      stderr: '',
      exitCode: 0,
    })
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: 'Build it.' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/did not complete/i)
    // A freshly-created spec with no missions is orphaned → cleaned up.
    expect(fsp.unlink).toHaveBeenCalled()
  })

  it('does NOT delete a PRE-EXISTING spec when a re-compile fails', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    fsp.access.mockResolvedValue(undefined) // the spec already exists on disk
    runClaude.mockRejectedValue(
      Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
        stderrOutput: 'boom',
      }),
    )
    const res = await request(app)
      .post(`/${KEY}/roadmap/compile`)
      .send({ roadmap: 'Build it.', title: 'Existing Plan' })
    expect(res.status).toBe(502)
    // A prior successful compile's missions reference this spec — it must survive.
    expect(fsp.unlink).not.toHaveBeenCalled()
  })

  it('502 when the result event is itself an error (is_error:true)', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({
      stdout: '{"type":"result","is_error":true,"result":"Unknown command: /mission-writer"}\n',
      stderr: '',
      exitCode: 0,
    })
    const res = await request(app).post(`/${KEY}/roadmap/compile`).send({ roadmap: 'Build it.' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.detail).toMatch(/Unknown command/)
  })

  it('409 in_progress for a concurrent compile of the same spec — does NOT spawn twice', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    // Hold the first compile in flight: runClaude resolves only when we signal.
    // A gate promise lets the test wait until runClaude has actually been entered
    // (i.e. the first request holds the lock) before firing the second request.
    let releaseRun
    let runEntered
    const entered = new Promise((r) => {
      runEntered = r
    })
    runClaude.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({ stdout: '{"type":"result","result":"ok"}\n', stderr: '', exitCode: 0 })
          runEntered()
        }),
    )

    // Same title → same resolved specPath → same lock key.
    const body = { roadmap: 'Build auth.', title: 'Same Plan' }
    // supertest dispatches lazily on .then — kick the request off and capture
    // its eventual response.
    const first = request(app)
      .post(`/${KEY}/roadmap/compile`)
      .send(body)
      .then((r) => r)
    // Wait until the first request has entered runClaude (lock held) before the
    // second arrives — deterministic, no reliance on tick counts.
    await entered
    const second = await request(app).post(`/${KEY}/roadmap/compile`).send(body)

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    // Release the first run and let it settle.
    releaseRun()
    const firstRes = await first
    expect(firstRes.status).toBe(200)

    // Only ONE spawn happened despite two concurrent requests.
    expect(runClaude).toHaveBeenCalledTimes(1)
  })

  it('releases the lock after settle — a later compile of the same spec succeeds', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({
      stdout: '{"type":"result","result":"ok"}\n',
      stderr: '',
      exitCode: 0,
    })
    const body = { roadmap: 'Build it.', title: 'Sequential Plan' }
    const first = await request(app).post(`/${KEY}/roadmap/compile`).send(body)
    expect(first.status).toBe(200)
    const second = await request(app).post(`/${KEY}/roadmap/compile`).send(body)
    expect(second.status).toBe(200)
    expect(runClaude).toHaveBeenCalledTimes(2)
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

  it('409 in_progress for a concurrent execute of the same mission — does NOT spawn twice', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ [MISSION]: { file: 'runs/missions/MISSION-001-auth.md', status: 'draft' } })
    // First run stays in flight (CLI promise pending) and the ack also never
    // resolves, so the first request holds the lock while the second arrives.
    let releaseCli
    runClaudeCancellable.mockReturnValue({
      promise: new Promise((resolve) => {
        releaseCli = () => resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 })
      }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockResolvedValue('impl-sess-1')

    const first = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(first.status).toBe(202)

    // Second concurrent execute for the same mission while the first is live.
    const second = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    // Only ONE implementer was spawned.
    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)

    // Settle the first CLI run so the lock releases (no leak).
    releaseCli()
    await new Promise((r) => setImmediate(r))
  })

  it('releases the lock after the CLI settles — a later execute of the same mission spawns again', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    mockMissions({ [MISSION]: { file: 'runs/missions/MISSION-001-auth.md', status: 'draft' } })
    // CLI resolves immediately → lock releases via taggedCli.finally.
    runClaudeCancellable.mockReturnValue({
      promise: Promise.resolve({ stdout: '{"type":"result"}\n', stderr: '', exitCode: 0 }),
      cancel: vi.fn(),
    })
    awaitNewSession.mockReturnValue(new Promise(() => {})) // never resolves; CLI wins

    const first = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(first.status).toBe(202)
    // Let the taggedCli.finally release the lock.
    await new Promise((r) => setImmediate(r))

    const second = await request(app).post(`/${KEY}/missions/${MISSION}/execute`).send({})
    expect(second.status).toBe(202)
    expect(runClaudeCancellable).toHaveBeenCalledTimes(2)
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

// ─── POST /create ────────────────────────────────────────────────────────────

describe('POST /create', () => {
  const NEW_DIR = 'C:/work/fresh-app'

  // Compile the shared scaffold contract once so we can bind the route's success
  // response to it (drift between the route and the schema fails loudly).
  const __dirname = nodePath.dirname(fileURLToPath(import.meta.url))
  const scaffoldSchema = JSON.parse(
    readFileSync(
      nodePath.resolve(
        __dirname,
        '../../../../../packages/contracts/schemas/harness-scaffold.schema.json',
      ),
      'utf-8',
    ),
  )
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const validateScaffold = ajv.compile(scaffoldSchema)

  it('201 happy path: scaffolds and returns a contract-valid result', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    const result = {
      ok: true,
      root: NEW_DIR,
      mode: 'idea-to-mvp',
      stage: 'intake',
      phase: 'intake',
      created: ['.harness/project-state.yml', 'pipelines/idea-to-mvp.yml', 'AGENTS.md'],
    }
    runHarnessScaffold.mockResolvedValue(result)

    const res = await request(app)
      .post('/create')
      .send({ projectPath: NEW_DIR, mode: 'idea-to-mvp' })

    expect(res.status).toBe(201)
    expect(res.body).toEqual(result)
    // The route's response conforms to the shared contract.
    if (!validateScaffold(res.body)) {
      throw new Error(`response failed schema: ${JSON.stringify(validateScaffold.errors)}`)
    }
    // Shelled out with the validated path + mode.
    expect(runHarnessScaffold).toHaveBeenCalledWith(NEW_DIR, 'idea-to-mvp')
  })

  it('400 invalid_mode for an unknown mode — never shells out', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    const res = await request(app).post('/create').send({ projectPath: NEW_DIR, mode: 'wonky' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_mode')
    expect(runHarnessScaffold).not.toHaveBeenCalled()
  })

  it('400 invalid_target when projectPath is missing', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    const res = await request(app).post('/create').send({ mode: 'bugfix' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_target')
    expect(runHarnessScaffold).not.toHaveBeenCalled()
  })

  it('403 path_not_allowed when the target is not a scaffold candidate — never shells out', async () => {
    getScaffoldCandidates.mockReturnValue([]) // whitelist miss
    const res = await request(app).post('/create').send({ projectPath: 'C:/evil', mode: 'bugfix' })
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('path_not_allowed')
    expect(runHarnessScaffold).not.toHaveBeenCalled()
  })

  it('409 already_initialized when the CLI refuses an existing project', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    runHarnessScaffold.mockResolvedValue({
      ok: false,
      error: 'already_initialized',
      root: NEW_DIR,
    })
    const res = await request(app).post('/create').send({ projectPath: NEW_DIR, mode: 'bugfix' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('already_initialized')
  })

  it('502 when the CLI scaffold fails', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    runHarnessScaffold.mockResolvedValue({
      ok: false,
      error: 'scaffold_failed',
      message: 'python/python3 not found',
    })
    const res = await request(app).post('/create').send({ projectPath: NEW_DIR, mode: 'bugfix' })
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toBe('scaffold_failed')
  })

  it('409 in_progress for a concurrent create of the same path — does NOT scaffold twice', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    let releaseRun
    let runEntered
    const entered = new Promise((r) => {
      runEntered = r
    })
    runHarnessScaffold.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({
              ok: true,
              root: NEW_DIR,
              mode: 'bugfix',
              stage: 'reproduce',
              phase: 'reproduce',
              created: ['.harness/project-state.yml'],
            })
          runEntered()
        }),
    )

    const body = { projectPath: NEW_DIR, mode: 'bugfix' }
    const first = request(app)
      .post('/create')
      .send(body)
      .then((r) => r)
    await entered // first request now holds the lock
    const second = await request(app).post('/create').send(body)

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    releaseRun()
    const firstRes = await first
    expect(firstRes.status).toBe(201)
    expect(runHarnessScaffold).toHaveBeenCalledTimes(1)
  })

  it('releases the lock after settle — a later create of the same path succeeds', async () => {
    getScaffoldCandidates.mockReturnValue([NEW_DIR])
    runHarnessScaffold.mockResolvedValue({
      ok: true,
      root: NEW_DIR,
      mode: 'bugfix',
      stage: 'reproduce',
      phase: 'reproduce',
      created: ['.harness/project-state.yml'],
    })
    const first = await request(app).post('/create').send({ projectPath: NEW_DIR, mode: 'bugfix' })
    expect(first.status).toBe(201)
    const second = await request(app).post('/create').send({ projectPath: NEW_DIR, mode: 'bugfix' })
    expect(second.status).toBe(201)
    expect(runHarnessScaffold).toHaveBeenCalledTimes(2)
  })
})

// ─── POST /:projectKey/missions/:missionId/ready ─────────────────────────────

describe('POST /:projectKey/missions/:missionId/ready', () => {
  const MISSION = 'MISSION-001-auth'

  it('200 happy path: shells the harness subcommand, returns summary', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockResolvedValue({
      stdout: `{"type":"result","result":"mission ${MISSION} marked ready"}\n`,
      stderr: '',
      exitCode: 0,
    })

    const res = await request(app).post(`/${KEY}/missions/${MISSION}/ready`).send({})

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.missionId).toBe(MISSION)
    expect(res.body.summary).toMatch(/marked ready/)

    // The prompt invokes the harness mission ready subcommand in the project cwd.
    const argv = runClaude.mock.calls.at(-1)[0]
    expect(argv.cwd).toBe(PROJECT)
    const prompt = argv.args[argv.args.indexOf('-p') + 1]
    expect(prompt).toContain(`harness mission ready ${MISSION}`)
    expect(prompt).toMatch(/do not edit .harness\/mission-index\.yml directly/i)
    expect(argv.args).toContain('--output-format')
    expect(argv.args[argv.args.indexOf('--output-format') + 1]).toBe('stream-json')
  })

  it('404 when the projectKey is not a known harness root', async () => {
    getKnownHarnessRoots.mockReturnValue([]) // whitelist miss
    const res = await request(app)
      .post(`/${encodeURIComponent('C:/evil')}/missions/${MISSION}/ready`)
      .send({})
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('502 when the harness run fails (e.g. mission not draft)', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    runClaude.mockRejectedValue(
      Object.assign(new Error('claude CLI exited with code=1 signal=null'), {
        stderrOutput: 'error: mission is `ready`, not `draft`',
      }),
    )
    const res = await request(app).post(`/${KEY}/missions/${MISSION}/ready`).send({})
    expect(res.status).toBe(502)
    expect(res.body.ok).toBe(false)
    expect(res.body.error).toMatch(/code=1/)
  })

  it('409 in_progress for a concurrent ready of the same mission — does NOT spawn twice', async () => {
    getKnownHarnessRoots.mockReturnValue([PROJECT])
    let releaseRun
    let runEntered
    const entered = new Promise((r) => {
      runEntered = r
    })
    runClaude.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseRun = () =>
            resolve({ stdout: '{"type":"result","result":"ok"}\n', stderr: '', exitCode: 0 })
          runEntered()
        }),
    )

    const first = request(app)
      .post(`/${KEY}/missions/${MISSION}/ready`)
      .send({})
      .then((r) => r)
    await entered
    const second = await request(app).post(`/${KEY}/missions/${MISSION}/ready`).send({})

    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    releaseRun()
    const firstRes = await first
    expect(firstRes.status).toBe(200)

    expect(runClaude).toHaveBeenCalledTimes(1)
  })
})
