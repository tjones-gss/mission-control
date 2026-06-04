import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mocks (mirror harness.test.js) — NEVER launch a real claude session and
// never create a real worktree. ───────────────────────────────────────────────
vi.mock('../../parsers/harness.js', () => ({
  getKnownHarnessRoots: vi.fn().mockReturnValue([]),
}))
vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn().mockResolvedValue({
    stdout: '{"type":"result","result":"approved"}\n',
    stderr: '',
    exitCode: 0,
  }),
  runClaudeCancellable: vi.fn().mockImplementation(() => ({
    promise: new Promise(() => {}), // stays pending so children stay 'running'
    cancel: vi.fn(),
  })),
}))
vi.mock('../../parsers/sessions.js', () => ({
  getSessionById: vi.fn(() => null),
}))
vi.mock('../../lib/atomic-write.js', () => ({
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/pending-session.js', () => ({
  awaitNewSession: vi.fn().mockResolvedValue('pending-session-id'),
}))
vi.mock('../../pty-session.js', () => ({
  getQueryStatus: vi.fn(() => ({ active: false, pendingApprovals: [] })),
  resolveApproval: vi.fn(() => true),
}))
vi.mock('../../sse.js', () => ({ emit: vi.fn() }))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))
// fs is fully mocked: statSync answers the git-repo precondition; readdirSync /
// readFileSync drive the listing + escalation readers; the runner's persist uses
// fsp.mkdir (resolved) + atomicWriteJson (mocked above).
const fsState = {
  // path -> 'git' (a .git entry exists) by default for whitelisted cwds
  gitPaths: new Set(),
  // dir -> string[] of entries
  dirs: new Map(),
  // path -> file contents string
  files: new Map(),
}
vi.mock('fs', () => {
  const statSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    if (norm.endsWith('/.git') && fsState.gitPaths.has(norm.slice(0, -'/.git'.length))) {
      return { isFile: () => true, isDirectory: () => true }
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const readdirSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    return fsState.dirs.get(norm) || []
  })
  const readFileSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    if (fsState.files.has(norm)) return fsState.files.get(norm)
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const promises = { mkdir: vi.fn().mockResolvedValue(undefined) }
  const api = { statSync, readdirSync, readFileSync, promises }
  return { ...api, default: { ...api } }
})

import express from 'express'
import request from 'supertest'
import { getKnownHarnessRoots } from '../../parsers/harness.js'
import { runClaude, runClaudeCancellable } from '../../claude-cli.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { atomicWriteJson } from '../../lib/atomic-write.js'
import { getQueryStatus, resolveApproval } from '../../pty-session.js'
import { router } from '../../routes/fleet.js'
import { __resetFleet, DATA_DIR, TEMPLATES_DIR } from '../../fleet/fleet-runner.js'

const app = express()
app.use(express.json())
app.use('/', router)

const A = 'C:/proj/a'
const B = 'C:/proj/b'
const DATA = String(DATA_DIR).replace(/\\/g, '/')
const TPL = String(TEMPLATES_DIR).replace(/\\/g, '/')

function whitelist(...cwds) {
  getKnownHarnessRoots.mockReturnValue(cwds)
  for (const c of cwds) fsState.gitPaths.add(c)
}

// Seed a persisted run file so the GET/escalation readers can find it.
function seedRun(state) {
  fsState.files.set(`${DATA}/${state.id}.json`, JSON.stringify(state))
  const names = fsState.dirs.get(DATA) || []
  if (!names.includes(`${state.id}.json`)) names.push(`${state.id}.json`)
  fsState.dirs.set(DATA, names)
}

beforeEach(() => {
  vi.resetAllMocks()
  fsState.gitPaths.clear()
  fsState.dirs.clear()
  fsState.files.clear()
  __resetFleet()
  // Default child spawn: stays pending so children remain 'running' and the run
  // key stays held (mirrors the execute "ack wins" path).
  runClaudeCancellable.mockReturnValue({ promise: new Promise(() => {}), cancel: vi.fn() })
  awaitNewSession.mockResolvedValue('sess-x')
  getQueryStatus.mockReturnValue({ active: false, pendingApprovals: [] })
  resolveApproval.mockReturnValue(true)
  runClaude.mockResolvedValue({
    stdout: '{"type":"result","result":"approved"}\n',
    stderr: '',
    exitCode: 0,
  })
  // Round-trip persists back into the in-memory fs so a subsequent read sees the
  // updated state (the runner persists via atomicWriteJson, then re-reads on the
  // next request). Mirrors what a real atomic write would do on disk.
  atomicWriteJson.mockImplementation(async (filePath, data) => {
    const norm = String(filePath).replace(/\\/g, '/')
    fsState.files.set(norm, JSON.stringify(data))
    const dir = norm.slice(0, norm.lastIndexOf('/'))
    const name = norm.slice(norm.lastIndexOf('/') + 1)
    const names = fsState.dirs.get(dir) || []
    if (!names.includes(name)) names.push(name)
    fsState.dirs.set(dir, names)
  })
})

describe('POST /api/fleet — start', () => {
  it('202 early-ack and spawns N children, each WITH --worktree', async () => {
    whitelist(A, B)
    const res = await request(app)
      .post('/')
      .send({
        goal: 'Add OAuth across services',
        children: [
          { cwd: A, prompt: 'Add OAuth to service A' },
          { cwd: B, workflow: 'add-oauth' },
        ],
      })

    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
    expect(res.body.status).toBe('running')
    expect(res.body.children).toHaveLength(2)
    expect(res.body.children[0]).toMatchObject({ idx: 0, cwd: A, status: 'starting' })

    // One spawn per child, every one carrying --worktree + stream-json.
    expect(runClaudeCancellable).toHaveBeenCalledTimes(2)
    for (const call of runClaudeCancellable.mock.calls) {
      const argv = call[0]
      expect(argv.args).toContain('--worktree')
      expect(argv.args).toContain('--output-format')
      expect(argv.args[argv.args.indexOf('--output-format') + 1]).toBe('stream-json')
      expect(argv.args).toContain('--name')
    }
    // Child 0 spawns its literal prompt in cwd A; child 1 spawns /workflow.
    const c0 = runClaudeCancellable.mock.calls[0][0]
    expect(c0.cwd).toBe(A)
    expect(c0.args[c0.args.indexOf('-p') + 1]).toBe('Add OAuth to service A')
    const c1 = runClaudeCancellable.mock.calls[1][0]
    expect(c1.cwd).toBe(B)
    expect(c1.args[c1.args.indexOf('-p') + 1]).toBe('/workflow add-oauth')

    // The initial state was persisted.
    expect(atomicWriteJson).toHaveBeenCalled()
  })

  it('400 when goal is empty', async () => {
    whitelist(A)
    const res = await request(app)
      .post('/')
      .send({ goal: '  ', children: [{ cwd: A, prompt: 'x' }] })
    expect(res.status).toBe(400)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('400 when children is empty', async () => {
    whitelist(A)
    const res = await request(app).post('/').send({ goal: 'g', children: [] })
    expect(res.status).toBe(400)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('400 when a child has neither prompt nor workflow', async () => {
    whitelist(A)
    const res = await request(app)
      .post('/')
      .send({ goal: 'g', children: [{ cwd: A }] })
    expect(res.status).toBe(400)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('422 refuses an absurd N (> hard cap) before spawning anything', async () => {
    const many = Array.from({ length: 50 }, () => ({ cwd: A, prompt: 'x' }))
    whitelist(A)
    const res = await request(app).post('/').send({ goal: 'g', children: many })
    expect(res.status).toBe(422)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('422 when children exceed the (default) concurrency cap', async () => {
    whitelist(A)
    const five = Array.from({ length: 5 }, () => ({ cwd: A, prompt: 'x' }))
    const res = await request(app).post('/').send({ goal: 'g', children: five })
    expect(res.status).toBe(422)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404 when a child cwd is not a whitelisted root (fail closed, no spawn)', async () => {
    whitelist(A) // B is NOT whitelisted
    const res = await request(app)
      .post('/')
      .send({
        goal: 'g',
        children: [
          { cwd: A, prompt: 'x' },
          { cwd: B, prompt: 'y' },
        ],
      })
    expect(res.status).toBe(404)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404 when a whitelisted cwd is not a git repo', async () => {
    getKnownHarnessRoots.mockReturnValue([A]) // whitelisted but no .git seeded
    const res = await request(app)
      .post('/')
      .send({ goal: 'g', children: [{ cwd: A, prompt: 'x' }] })
    expect(res.status).toBe(404)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('409 in_progress for a double-submit of the same goal — does NOT double-spawn', async () => {
    whitelist(A)
    // Freeze the clock so both submits derive the SAME id (slug + timestamp).
    const fixed = new Date('2026-06-04T12:00:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(fixed)
    // Children stay pending so the first run holds its key while the second arrives.
    runClaudeCancellable.mockReturnValue({ promise: new Promise(() => {}), cancel: vi.fn() })
    awaitNewSession.mockReturnValue(new Promise(() => {}))

    const body = { goal: 'Same Goal', children: [{ cwd: A, prompt: 'x' }] }
    const first = await request(app).post('/').send(body)
    expect(first.status).toBe(202)
    const second = await request(app).post('/').send(body)
    expect(second.status).toBe(409)
    expect(second.body.error).toBe('in_progress')

    // Only ONE child spawned despite two submits.
    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('GET /api/fleet — list & detail', () => {
  it('200 lists persisted run summaries (skips corrupt files)', async () => {
    seedRun({
      id: 'goal-1',
      goal: 'Goal one',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, status: 'running' }],
      synthesis: { status: 'pending' },
    })
    // A corrupt file must be skipped, not crash the listing.
    fsState.files.set(`${DATA}/corrupt.json`, '{ not json')
    fsState.dirs.set(DATA, ['goal-1.json', 'corrupt.json'])

    const res = await request(app).get('/')
    expect(res.status).toBe(200)
    expect(res.body.runs).toHaveLength(1)
    expect(res.body.runs[0]).toMatchObject({ id: 'goal-1', childCount: 1, settledCount: 0 })
  })

  it('200 detail returns the full persisted state', async () => {
    const state = {
      id: 'goal-2',
      goal: 'Goal two',
      status: 'succeeded',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, status: 'succeeded' }],
      synthesis: { status: 'done', summary: 'merged report' },
    }
    seedRun(state)
    const res = await request(app).get('/goal-2')
    expect(res.status).toBe(200)
    expect(res.body).toEqual(state)
  })

  it('404 detail for an unknown run', async () => {
    const res = await request(app).get('/nope')
    expect(res.status).toBe(404)
    expect(res.body.error).toBe('not_found')
  })
})

describe('GET /api/fleet/:id/escalations — read-only merged list', () => {
  it('merges live SDK tool approvals AND harness filesystem pendings', async () => {
    const state = {
      id: 'goal-3',
      goal: 'Goal three',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-1', status: 'running' }],
      synthesis: { status: 'pending' },
    }
    seedRun(state)

    // Live SDK tool-approval request for the child's session.
    getQueryStatus.mockReturnValue({
      active: true,
      pendingApprovals: [{ approvalId: 'ap-1', toolName: 'Bash', input: { command: 'rm -rf x' } }],
    })
    // Filesystem danger-zone pending under the child cwd.
    const pendingDir = `${A}/.harness/approvals/pending`
    fsState.dirs.set(pendingDir, ['req-1.json'])
    fsState.files.set(
      `${pendingDir}/req-1.json`,
      JSON.stringify({
        id: 'req-1',
        tool: 'Bash',
        command: 'git push --force',
        riskLevel: 'DESTRUCTIVE',
        requestedAt: '2026-06-04T12:00:00.000Z',
        sessionId: 'sess-1',
      }),
    )

    const res = await request(app).get('/goal-3/escalations')
    expect(res.status).toBe(200)
    const esc = res.body.escalations
    expect(esc).toHaveLength(2)
    const tool = esc.find((e) => e.source === 'tool')
    const harness = esc.find((e) => e.source === 'harness')
    expect(tool).toMatchObject({ childIdx: 0, approvalId: 'ap-1', tool: 'Bash' })
    expect(harness).toMatchObject({
      childIdx: 0,
      requestId: 'req-1',
      command: 'git push --force',
      riskLevel: 'DESTRUCTIVE',
    })

    // The escalation read path makes NO decision — it never auto-approves
    // (no in-memory resolve) and never shells the harness CLI to write a
    // decided file. It MAY persist the 'escalated' child-status side effect.
    expect(resolveApproval).not.toHaveBeenCalled()
    expect(runClaude).not.toHaveBeenCalled()
    const persisted = JSON.parse(fsState.files.get(`${DATA}/goal-3.json`))
    expect(persisted.children[0].status).toBe('escalated')
  })

  it('404 escalations for an unknown run', async () => {
    const res = await request(app).get('/nope/escalations')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/fleet/:id/cancel', () => {
  it('202 cancels and marks unsettled children cancelled', async () => {
    seedRun({
      id: 'goal-4',
      goal: 'Goal four',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, status: 'running' }],
      synthesis: { status: 'pending' },
    })
    const res = await request(app).post('/goal-4/cancel').send({})
    expect(res.status).toBe(202)
    expect(res.body.ok).toBe(true)
  })

  it('404 cancel for an unknown run', async () => {
    const res = await request(app).post('/nope/cancel').send({})
    expect(res.status).toBe(404)
  })
})

describe('POST /api/fleet/:id/decide — route a human Allow/Deny', () => {
  it('source "tool" calls the in-memory resolver, NOT the harness CLI', async () => {
    whitelist(A)
    seedRun({
      id: 'goal-d1',
      goal: 'Decide tool',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-1', status: 'running' }],
      synthesis: { status: 'pending' },
    })

    const res = await request(app)
      .post('/goal-d1/decide')
      .send({ childIdx: 0, source: 'tool', decision: 'allow', approvalId: 'ap-1' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // The SAME resolver the sessions route uses, keyed on the child's session.
    expect(resolveApproval).toHaveBeenCalledWith('sess-1', 'ap-1', 'allow', undefined)
    // Tool decisions never shell the harness CLI.
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('source "harness" shells `harness approve <id> --allow` in the child cwd, never the resolver', async () => {
    whitelist(A)
    seedRun({
      id: 'goal-d2',
      goal: 'Decide harness',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-2', status: 'running' }],
      synthesis: { status: 'pending' },
    })

    const res = await request(app)
      .post('/goal-d2/decide')
      .send({ childIdx: 0, source: 'harness', decision: 'deny', requestId: 'req-9' })

    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    // Shelled the harness CLI in the CHILD's cwd with the approve subcommand.
    expect(runClaude).toHaveBeenCalledTimes(1)
    const call = runClaude.mock.calls[0][0]
    expect(call.cwd).toBe(A)
    const promptArg = call.args[call.args.indexOf('-p') + 1]
    expect(promptArg).toContain('harness approve req-9 --deny')
    // The cockpit NEVER writes the decided file directly, and never uses the
    // in-memory resolver for a harness-source decision.
    expect(resolveApproval).not.toHaveBeenCalled()
    expect(atomicWriteJson).not.toHaveBeenCalled()
  })

  it('400 on a bad decision value', async () => {
    whitelist(A)
    seedRun({
      id: 'goal-d3',
      goal: 'g',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 's', status: 'running' }],
      synthesis: { status: 'pending' },
    })
    const res = await request(app)
      .post('/goal-d3/decide')
      .send({ childIdx: 0, source: 'tool', decision: 'maybe', approvalId: 'x' })
    expect(res.status).toBe(400)
    expect(resolveApproval).not.toHaveBeenCalled()
  })

  it('404 for an unknown child idx', async () => {
    whitelist(A)
    seedRun({
      id: 'goal-d4',
      goal: 'g',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 's', status: 'running' }],
      synthesis: { status: 'pending' },
    })
    const res = await request(app)
      .post('/goal-d4/decide')
      .send({ childIdx: 9, source: 'tool', decision: 'allow', approvalId: 'x' })
    expect(res.status).toBe(404)
  })

  it('404 for an unknown run', async () => {
    const res = await request(app)
      .post('/nope/decide')
      .send({ childIdx: 0, source: 'tool', decision: 'allow', approvalId: 'x' })
    expect(res.status).toBe(404)
  })

  it('harness-source 404s when the child cwd is not a known root (no shell-out)', async () => {
    // Run is seeded but the cwd is NOT whitelisted this time.
    seedRun({
      id: 'goal-d5',
      goal: 'g',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 's', status: 'running' }],
      synthesis: { status: 'pending' },
    })
    getKnownHarnessRoots.mockReturnValue([]) // A is not a known root
    const res = await request(app)
      .post('/goal-d5/decide')
      .send({ childIdx: 0, source: 'harness', decision: 'allow', requestId: 'req-1' })
    expect(res.status).toBe(404)
    expect(runClaude).not.toHaveBeenCalled()
  })
})

describe('GET /api/fleet/:id/escalations — persists escalated child status', () => {
  it('flips running → escalated when an escalation exists, and reverts when it clears', async () => {
    whitelist(A)
    const base = {
      id: 'goal-e1',
      goal: 'Escalate',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-1', status: 'running' }],
      synthesis: { status: 'pending' },
    }
    seedRun(base)

    // First refresh: a live tool approval exists → child should flip escalated.
    getQueryStatus.mockReturnValue({
      active: true,
      pendingApprovals: [{ approvalId: 'ap-1', toolName: 'Bash', input: { command: 'rm -rf x' } }],
    })
    let res = await request(app).get('/goal-e1/escalations')
    expect(res.status).toBe(200)
    expect(res.body.escalations).toHaveLength(1)
    // The persisted state was rewritten with status 'escalated'.
    let persisted = JSON.parse(fsState.files.get(`${DATA}/goal-e1.json`))
    expect(persisted.children[0].status).toBe('escalated')

    // Second refresh: escalation cleared → child reverts to running.
    getQueryStatus.mockReturnValue({ active: false, pendingApprovals: [] })
    res = await request(app).get('/goal-e1/escalations')
    expect(res.status).toBe(200)
    expect(res.body.escalations).toHaveLength(0)
    persisted = JSON.parse(fsState.files.get(`${DATA}/goal-e1.json`))
    expect(persisted.children[0].status).toBe('running')
  })
})

describe('Fleet templates — save / list / launch-from-template', () => {
  it('POST /templates saves, GET /templates lists, POST / { template } launches', async () => {
    whitelist(A)
    // Save a template.
    const save = await request(app)
      .post('/templates')
      .send({
        name: 'oauth-fleet',
        goal: 'Add OAuth',
        children: [{ cwd: A, prompt: 'do it', quarantine: true }],
        policy: { budgetUsd: 5, verify: true },
      })
    expect(save.status).toBe(200)
    expect(save.body.ok).toBe(true)
    expect(save.body.template.name).toBe('oauth-fleet')
    // It was persisted under the templates dir.
    expect(fsState.files.has(`${TPL}/oauth-fleet.json`)).toBe(true)

    // List sees it.
    const list = await request(app).get('/templates')
    expect(list.status).toBe(200)
    expect(list.body.templates.map((t) => t.name)).toContain('oauth-fleet')

    // Launch from the template — children stay pending (default mock), so the
    // run early-acks 202 and spawns the template's child (with --worktree).
    const launch = await request(app).post('/').send({ template: 'oauth-fleet' })
    expect(launch.status).toBe(202)
    expect(launch.body.ok).toBe(true)
    expect(launch.body.children).toHaveLength(1)
    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)
    // The quarantine directive came through from the template's child.
    const argv = runClaudeCancellable.mock.calls[0][0]
    expect(argv.cwd).toBe(A)
    const p = argv.args[argv.args.indexOf('-p') + 1]
    expect(p).toMatch(/QUARANTINE MODE/)
  })

  it('POST /templates 400 on a bad (traversal) name — nothing written', async () => {
    whitelist(A)
    const res = await request(app)
      .post('/templates')
      .send({ name: '../escape', goal: 'g', children: [{ cwd: A, prompt: 'p' }] })
    expect(res.status).toBe(400)
    expect(atomicWriteJson).not.toHaveBeenCalled()
  })

  it('POST / { template } 404 for an unknown template (no spawn)', async () => {
    whitelist(A)
    const res = await request(app).post('/').send({ template: 'does-not-exist' })
    expect(res.status).toBe(404)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('GET /templates is matched as a route, NOT as /:id', async () => {
    // With no templates seeded, /templates must 200 with an empty list — proving
    // it did not fall through to GET /:id (which would 404 for id "templates").
    const res = await request(app).get('/templates')
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('templates')
  })
})
