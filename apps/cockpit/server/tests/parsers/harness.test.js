import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import { EventEmitter } from 'node:events'

// Mock the cwd-scanning source so getKnownHarnessRoots is hermetic — we control
// which "session cwds" exist without touching the real ~/.claude dir.
vi.mock('../../lib/session-discovery.js', () => ({
  getSessionCwds: vi.fn().mockReturnValue([]),
}))

// Mock fs so existsAsFile (the .harness/project-state.yml probe) is controllable.
vi.mock('fs', () => {
  const statSync = vi.fn()
  return {
    default: { statSync },
    statSync,
  }
})

// Mock child_process so readHarnessStatus never spawns a real interpreter.
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

import fs from 'fs'
import { spawn } from 'node:child_process'
import { getSessionCwds } from '../../lib/session-discovery.js'
import {
  getKnownHarnessRoots,
  readHarnessStatus,
  getHarnessProjects,
  getHarnessProjectByPath,
  runHarnessApprove,
} from '../../parsers/harness.js'

const PROJECT_A = 'C:\\projects\\foo'
const STATE_YML = path.join(PROJECT_A, '.harness', 'project-state.yml')

// Build a fake ChildProcess that mirrors the async spawn surface readHarnessStatus
// consumes: .stdout / .stderr streams plus 'error' and 'close' events. The
// scenario describes how it should behave once subscribers attach.
//   { stdout, exit }      → emit stdout then close(exit)
//   { errorCode }         → emit an 'error' with that code (e.g. ENOENT)
//   { hang: true }        → never emit anything; expose .kill so the timeout
//                           path can fire close(null) when killed.
function makeChild(scenario) {
  const child = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  stdout.setEncoding = () => {}
  stderr.setEncoding = () => {}
  child.stdout = stdout
  child.stderr = stderr

  let killed = false
  child.kill = vi.fn(() => {
    killed = true
    // A SIGKILL'd process closes with a null exit code.
    queueMicrotask(() => child.emit('close', null))
    return true
  })

  // Emit asynchronously so listeners (.on attached after spawn returns) are
  // registered before events fire — matching real async spawn semantics.
  queueMicrotask(() => {
    if (killed) return
    if (scenario.errorCode !== undefined) {
      child.emit('error', { code: scenario.errorCode })
      return
    }
    if (scenario.hang) return
    if (typeof scenario.stdout === 'string') {
      stdout.emit('data', scenario.stdout)
    }
    if (typeof scenario.stderr === 'string') {
      stderr.emit('data', scenario.stderr)
    }
    child.emit('close', scenario.exit ?? 0)
  })

  return child
}

// Convenience: make spawn return the same scenario for every interpreter call.
function spawnReturns(scenario) {
  spawn.mockImplementation(() => makeChild(scenario))
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─── getKnownHarnessRoots ─────────────────────────────────────────────────────

describe('getKnownHarnessRoots()', () => {
  it('returns [] when there are zero sessions', () => {
    getSessionCwds.mockReturnValue([])
    expect(getKnownHarnessRoots()).toEqual([])
  })

  it('returns [] (never throws) when getSessionCwds throws', () => {
    getSessionCwds.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() => getKnownHarnessRoots()).not.toThrow()
    expect(getKnownHarnessRoots()).toEqual([])
  })

  it('only includes cwds that have a .harness/project-state.yml file', () => {
    getSessionCwds.mockReturnValue([PROJECT_A, 'C:\\projects\\bare'])
    fs.statSync.mockImplementation((p) => {
      if (p === STATE_YML) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    expect(getKnownHarnessRoots()).toEqual([PROJECT_A])
  })
})

// ─── readHarnessStatus ────────────────────────────────────────────────────────

describe('readHarnessStatus()', () => {
  it('returns { available:false, error } and never throws when python is missing', async () => {
    // Simulate ENOENT for both interpreter candidates.
    spawnReturns({ errorCode: 'ENOENT' })
    let result
    await expect(
      (async () => {
        result = await readHarnessStatus(PROJECT_A)
      })(),
    ).resolves.not.toThrow()
    expect(result.available).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  })

  it('returns { available:false, error } on a non-zero CLI exit', async () => {
    spawnReturns({ stdout: '', exit: 2 })
    const result = await readHarnessStatus('C:\\projects\\exit-nonzero')
    expect(result.available).toBe(false)
    expect(result.error).toContain('exited 2')
  })

  it('returns { available:false, error } on unparseable JSON', async () => {
    spawnReturns({ stdout: '{not json', exit: 0 })
    const result = await readHarnessStatus('C:\\projects\\bad-json')
    expect(result.available).toBe(false)
    expect(typeof result.error).toBe('string')
  })

  it('returns { available:true, status } on success', async () => {
    spawnReturns({ stdout: JSON.stringify({ project: { mode: 'idea-to-mvp' } }), exit: 0 })
    const result = await readHarnessStatus('C:\\projects\\ok')
    expect(result.available).toBe(true)
    expect(result.status).toMatchObject({ project: { mode: 'idea-to-mvp' } })
  })

  it('returns invalid-path error without spawning for empty path', async () => {
    const result = await readHarnessStatus('')
    expect(result.available).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('resolves to { available:false, error:<timeout-ish> } for a hung process and does not hang', async () => {
    vi.useFakeTimers()
    try {
      // The child never emits on its own; only the timeout-driven kill closes it.
      spawnReturns({ hang: true })
      const promise = readHarnessStatus('C:\\projects\\hung')
      // Fire the hard-timeout timer; the parser kills the child, which closes
      // with a null exit code → treated as a timeout, not a generic exit.
      await vi.runAllTimersAsync()
      const result = await promise
      expect(result.available).toBe(false)
      expect(result.error).toMatch(/time/i)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── getHarnessProjects (shape) ───────────────────────────────────────────────

describe('getHarnessProjects()', () => {
  // Distinct paths per test: readHarnessStatus caches per projectPath, and the
  // module-level cache persists across tests in this file.
  const SHAPE_PROJECT = 'C:\\projects\\shape-ok'
  const SHAPE_STATE = path.join(SHAPE_PROJECT, '.harness', 'project-state.yml')
  const FAIL_PROJECT = 'C:\\projects\\shape-fail'
  const FAIL_STATE = path.join(FAIL_PROJECT, '.harness', 'project-state.yml')

  it('shapes a known root into the ProjectSummary contract', async () => {
    getSessionCwds.mockReturnValue([SHAPE_PROJECT])
    fs.statSync.mockImplementation((p) => {
      if (p === SHAPE_STATE) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    spawnReturns({
      exit: 0,
      stdout: JSON.stringify({
        project: { mode: 'idea-to-mvp' },
        pipeline: { active: 'p1', phase: 'build', gate: null },
        current: { mission: 'M-1' },
        next: {
          blocked: true,
          blocker: 'OAuth',
          recommended_agent: 'dev',
          recommended_action: 'wait',
        },
        // The CLI emits the readiness block under `readiness_overall` (see the
        // harness CLI cmd_status + the shared contract schema). The parser must
        // read that exact key.
        readiness_overall: { score: 42, mvp_ready: false },
      }),
    })
    const projects = await getHarnessProjects()
    expect(projects).toHaveLength(1)
    const p = projects[0]
    expect(p).toMatchObject({
      projectPath: SHAPE_PROJECT,
      projectKey: encodeURIComponent(SHAPE_PROJECT),
      projectLabel: path.basename(SHAPE_PROJECT),
      available: true,
      mode: 'idea-to-mvp',
      pipeline: { active: 'p1', phase: 'build', gate: null },
      currentMission: 'M-1',
      blocked: true,
      blocker: 'OAuth',
      next: { recommended_agent: 'dev', recommended_action: 'wait' },
      readiness: { score: 42, mvp_ready: false },
      error: null,
    })
  })

  it('surfaces the Phase-2 pipeline goal/strategy/transitionedAt when present', async () => {
    const GOAL_PROJECT = 'C:\\projects\\shape-goal'
    const GOAL_STATE = path.join(GOAL_PROJECT, '.harness', 'project-state.yml')
    getSessionCwds.mockReturnValue([GOAL_PROJECT])
    fs.statSync.mockImplementation((p) => {
      if (p === GOAL_STATE) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    spawnReturns({
      exit: 0,
      stdout: JSON.stringify({
        project: { mode: 'idea-to-mvp' },
        pipeline: {
          active: 'next-mission-loop',
          phase: 'execute',
          gate: 'scope_adherence',
          goal: 'Ship the auth slice',
          strategy: 'fleet',
          transitioned_at: '2026-06-07T12:00:00+00:00',
        },
      }),
    })
    const projects = await getHarnessProjects()
    expect(projects[0].pipeline).toMatchObject({
      active: 'next-mission-loop',
      phase: 'execute',
      gate: 'scope_adherence',
      goal: 'Ship the auth slice',
      strategy: 'fleet',
      transitionedAt: '2026-06-07T12:00:00+00:00',
    })
  })

  it('produces an available:false summary with all contract fields when CLI fails', async () => {
    getSessionCwds.mockReturnValue([FAIL_PROJECT])
    fs.statSync.mockImplementation((p) => {
      if (p === FAIL_STATE) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    spawnReturns({ errorCode: 'ENOENT' })
    const [p] = await getHarnessProjects()
    expect(p.available).toBe(false)
    expect(p.blocked).toBe(false)
    expect(p.pipeline).toBeNull()
    expect(p.next).toBeNull()
    expect(p.readiness).toBeNull()
    expect(typeof p.error).toBe('string')
  })

  it('returns [] when there are no known harness roots', async () => {
    getSessionCwds.mockReturnValue([])
    expect(await getHarnessProjects()).toEqual([])
  })
})

// ─── getHarnessProjectByPath (whitelist) ──────────────────────────────────────

describe('getHarnessProjectByPath()', () => {
  it('returns null for a path that is not a known harness root (whitelist guard)', async () => {
    getSessionCwds.mockReturnValue([])
    expect(await getHarnessProjectByPath('C:\\Windows\\System32')).toBeNull()
    // Never shells out for an unknown path.
    expect(spawn).not.toHaveBeenCalled()
  })

  it('returns the full status plus projectPath/projectLabel for a known root', async () => {
    const DETAIL_PROJECT = 'C:\\projects\\detail-ok'
    const DETAIL_STATE = path.join(DETAIL_PROJECT, '.harness', 'project-state.yml')
    getSessionCwds.mockReturnValue([DETAIL_PROJECT])
    fs.statSync.mockImplementation((p) => {
      if (p === DETAIL_STATE) return { isFile: () => true }
      throw new Error('ENOENT')
    })
    spawnReturns({
      exit: 0,
      stdout: JSON.stringify({ project: { mode: 'existing-repo-retrofit' }, extra: 1 }),
    })
    const detail = await getHarnessProjectByPath(DETAIL_PROJECT)
    expect(detail.projectPath).toBe(DETAIL_PROJECT)
    expect(detail.projectLabel).toBe(path.basename(DETAIL_PROJECT))
    expect(detail.project).toEqual({ mode: 'existing-repo-retrofit' })
    expect(detail.extra).toBe(1)
  })
})

// ─── runHarnessApprove ────────────────────────────────────────────────────────

describe('runHarnessApprove()', () => {
  it('shells the harness CLI with [approve, <id>, --allow] and returns stdout', async () => {
    spawnReturns({ stdout: 'approval rq-1 allow', exit: 0 })
    const res = await runHarnessApprove('C:\projects\foo', 'rq-1', 'allow')
    expect(res.ok).toBe(true)
    expect(res.code).toBe(0)
    expect(res.stdout).toContain('approval rq-1 allow')
    // First spawn call: argv after the script path is [approve, id, flag].
    const argv = spawn.mock.calls[0][1]
    expect(argv.slice(1)).toEqual(['approve', 'rq-1', '--allow'])
    // Spawned in the given cwd.
    expect(spawn.mock.calls[0][2]).toMatchObject({ cwd: 'C:\projects\foo' })
  })

  it('passes --deny for a deny decision', async () => {
    spawnReturns({ stdout: 'approval rq-1 deny', exit: 0 })
    await runHarnessApprove('C:\projects\foo', 'rq-1', 'deny')
    expect(spawn.mock.calls[0][1].slice(1)).toEqual(['approve', 'rq-1', '--deny'])
  })

  it('maps a non-zero CLI exit to ok:false carrying the CLI stderr', async () => {
    spawnReturns({ stderr: 'pending rq-1 not found', exit: 1 })
    const res = await runHarnessApprove('C:\projects\foo', 'rq-1', 'allow')
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.error).toContain('pending rq-1 not found')
  })

  it('falls back python → python3 when the first interpreter is missing', async () => {
    let call = 0
    spawn.mockImplementation(() => {
      call += 1
      return makeChild(call === 1 ? { errorCode: 'ENOENT' } : { stdout: 'ok', exit: 0 })
    })
    const res = await runHarnessApprove('C:\projects\foo', 'rq-1', 'allow')
    expect(res.ok).toBe(true)
    expect(spawn.mock.calls[0][0]).toBe('python')
    expect(spawn.mock.calls[1][0]).toBe('python3')
  })

  it('returns ok:false (never throws) when no interpreter is found', async () => {
    spawnReturns({ errorCode: 'ENOENT' })
    const res = await runHarnessApprove('C:\projects\foo', 'rq-1', 'allow')
    expect(res.ok).toBe(false)
    expect(res.error).toBeTruthy()
  })

  it('validates inputs without spawning', async () => {
    expect((await runHarnessApprove('', 'rq-1', 'allow')).ok).toBe(false)
    expect((await runHarnessApprove('C:\projects\foo', '', 'allow')).ok).toBe(false)
    expect((await runHarnessApprove('C:\projects\foo', 'rq-1', 'maybe')).ok).toBe(false)
    expect(spawn).not.toHaveBeenCalled()
  })
})
