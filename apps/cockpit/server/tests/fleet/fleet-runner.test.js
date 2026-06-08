import { describe, it, expect, vi, beforeEach } from 'vitest'

// Unit test for the lifecycle owner. MOCK process/agent spawning — never launch
// a real claude session, never create a real worktree.
vi.mock('../../parsers/harness.js', () => ({
  getKnownHarnessRoots: vi.fn().mockReturnValue([]),
  runHarnessApprove: vi.fn(),
}))
vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn(),
  runClaudeCancellable: vi.fn(),
}))
vi.mock('../../lib/atomic-write.js', () => ({
  atomicWriteJson: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('../../lib/pending-session.js', () => ({
  awaitNewSession: vi.fn(),
}))
vi.mock('../../pty-session.js', () => ({
  getQueryStatus: vi.fn(() => ({ active: false, pendingApprovals: [] })),
  resolveApproval: vi.fn(() => true),
}))
vi.mock('../../parsers/sessions.js', () => ({
  getSessionById: vi.fn(() => null),
}))
vi.mock('../../sse.js', () => ({ emit: vi.fn() }))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const gitPaths = new Set()
// In-memory fs backing the seeded-run readers (getFleetRun / listEscalations).
// dirs: dir -> string[] entries; files: path -> contents.
const fsBack = { dirs: new Map(), files: new Map() }
vi.mock('fs', () => {
  const statSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    if (norm.endsWith('/.git') && gitPaths.has(norm.slice(0, -'/.git'.length))) {
      return { isFile: () => true, isDirectory: () => true }
    }
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const readdirSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    return fsBack.dirs.get(norm) || []
  })
  const readFileSync = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    if (fsBack.files.has(norm)) return fsBack.files.get(norm)
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const promises = { mkdir: vi.fn().mockResolvedValue(undefined) }
  const api = { statSync, readdirSync, readFileSync, promises }
  return { ...api, default: { ...api } }
})

import { getKnownHarnessRoots, runHarnessApprove } from '../../parsers/harness.js'
import { runClaude, runClaudeCancellable } from '../../claude-cli.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { atomicWriteJson } from '../../lib/atomic-write.js'
import { emit } from '../../sse.js'
import { getQueryStatus } from '../../pty-session.js'
import { getSessionById } from '../../parsers/sessions.js'
import {
  startFleetRun,
  validateFleetRequest,
  decideFleetEscalation,
  reconcileEscalationStatus,
  parseVerdict,
  spentUsd,
  isValidTemplateName,
  saveFleetTemplate,
  listFleetTemplates,
  getFleetTemplate,
  __resetFleet,
  MAX_FLEET_CHILDREN,
  DATA_DIR,
  TEMPLATES_DIR,
} from '../../fleet/fleet-runner.js'

const TPL = String(TEMPLATES_DIR).replace(/\\/g, '/')

// A spawn whose CLI promise resolves to a stream-json result line.
function resolved(result) {
  return {
    promise: Promise.resolve({
      stdout: `{"type":"result","result":${JSON.stringify(result)}}\n`,
      stderr: '',
      exitCode: 0,
    }),
    cancel: vi.fn(),
  }
}
// A spawn that never settles (stays running).
function pending() {
  return { promise: new Promise(() => {}), cancel: vi.fn() }
}

const A = 'C:/proj/a'
const DATA = String(DATA_DIR).replace(/\\/g, '/')

// Seed a persisted run into the in-memory fs so getFleetRun can read it.
function seedRun(state) {
  fsBack.files.set(`${DATA}/${state.id}.json`, JSON.stringify(state))
  const names = fsBack.dirs.get(DATA) || []
  if (!names.includes(`${state.id}.json`)) names.push(`${state.id}.json`)
  fsBack.dirs.set(DATA, names)
}

// Find the most recent persisted FULL state for a given run id from the
// atomicWriteJson mock calls (the runner persists the full state to disk).
function lastPersisted(id) {
  for (let i = atomicWriteJson.mock.calls.length - 1; i >= 0; i -= 1) {
    const [, data] = atomicWriteJson.mock.calls[i]
    if (data && data.id === id) return data
  }
  return null
}

const tick = () => new Promise((r) => setImmediate(r))

beforeEach(() => {
  vi.resetAllMocks()
  gitPaths.clear()
  fsBack.dirs.clear()
  fsBack.files.clear()
  __resetFleet()
  // Round-trip persists back into the in-memory fs so a later getFleetRun sees
  // the updated state (mirrors a real atomic write to disk).
  atomicWriteJson.mockImplementation(async (filePath, data) => {
    const norm = String(filePath).replace(/\\/g, '/')
    fsBack.files.set(norm, JSON.stringify(data))
    const dir = norm.slice(0, norm.lastIndexOf('/'))
    const name = norm.slice(norm.lastIndexOf('/') + 1)
    const names = fsBack.dirs.get(dir) || []
    if (!names.includes(name)) names.push(name)
    fsBack.dirs.set(dir, names)
  })
})

describe('validateFleetRequest', () => {
  it('rejects > hard cap absurd N', () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    const children = Array.from({ length: 50 }, () => ({ cwd: A, prompt: 'x' }))
    const r = validateFleetRequest({ goal: 'g', children })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
  })

  it('policy.maxConcurrency can only LOWER the cap, never raise it', () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    // Request a higher cap than the hard cap — effective cap stays at the hard cap.
    const children = Array.from({ length: MAX_FLEET_CHILDREN + 2 }, () => ({ cwd: A, prompt: 'x' }))
    const r = validateFleetRequest({ goal: 'g', children, policy: { maxConcurrency: 100 } })
    expect(r.ok).toBe(false) // still rejected because N > hard cap
  })

  it('rejects a non-whitelisted cwd with 404', () => {
    getKnownHarnessRoots.mockReturnValue([]) // not whitelisted
    const r = validateFleetRequest({ goal: 'g', children: [{ cwd: A, prompt: 'x' }] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })

  it('rejects a whitelisted-but-non-git cwd with 404', () => {
    getKnownHarnessRoots.mockReturnValue([A]) // whitelisted, but no .git
    const r = validateFleetRequest({ goal: 'g', children: [{ cwd: A, prompt: 'x' }] })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(404)
  })
})

describe('startFleetRun lifecycle', () => {
  it('spawns each child with --worktree and the goal cwd', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable.mockReturnValue({ promise: new Promise(() => {}), cancel: vi.fn() })
    awaitNewSession.mockResolvedValue('sess-1')

    const res = await startFleetRun({ goal: 'My Goal', children: [{ cwd: A, prompt: 'do it' }] })
    expect(res.ok).toBe(true)
    expect(res.status).toBe(202)
    expect(res.id).toMatch(/^my-goal-/)

    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)
    const argv = runClaudeCancellable.mock.calls[0][0]
    expect(argv.cwd).toBe(A)
    expect(argv.args).toContain('--worktree')
    expect(emit).toHaveBeenCalledWith('fleet_update', expect.objectContaining({ id: res.id }))
  })

  it('synthesize stores a report after all children settle (succeeded run)', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)

    // First call = the child (resolves succeeded). Second call = synthesis,
    // returns a stream-json result line we expect stored as the summary.
    runClaudeCancellable
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"child done"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"MERGED REPORT: all branches landed"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
    awaitNewSession.mockResolvedValue('sess-9')

    const res = await startFleetRun({ goal: 'Synth Goal', children: [{ cwd: A, prompt: 'work' }] })
    expect(res.ok).toBe(true)

    // Let the child settle → synthesis spawn → synthesis resolve → final persist.
    for (let i = 0; i < 10; i += 1) await tick()

    // A second spawn (the synthesis child) happened.
    expect(runClaudeCancellable).toHaveBeenCalledTimes(2)
    const synthArgv = runClaudeCancellable.mock.calls[1][0]
    expect(synthArgv.cwd).toBe(A)
    expect(synthArgv.args[synthArgv.args.indexOf('-p') + 1]).toMatch(/Synthesize/i)

    const state = lastPersisted(res.id)
    expect(state).toBeTruthy()
    expect(state.status).toBe('succeeded')
    expect(state.children[0].status).toBe('succeeded')
    expect(state.synthesis.status).toBe('done')
    expect(state.synthesis.summary).toMatch(/MERGED REPORT/)
  })

  it('populates child.cost from the session estimatedCost (canonical cockpit shape)', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)

    // Child resolves succeeded; synthesis resolves too.
    runClaudeCancellable
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"done"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"report"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
    awaitNewSession.mockResolvedValue('sess-cost')

    // The canonical session-cost representation the rest of the cockpit uses:
    // parsers/sessions.js getSessionById(...).estimatedCost === calculateCost(...)
    const estimatedCost = {
      totalCost: 0.4242,
      breakdown: { input: 0.1, output: 0.2, cacheWrite: 0.1, cacheRead: 0.0242 },
      family: 'opus',
    }
    getSessionById.mockImplementation((sid) =>
      sid === 'sess-cost' ? { sessionId: sid, estimatedCost } : null,
    )

    const res = await startFleetRun({ goal: 'Cost Goal', children: [{ cwd: A, prompt: 'work' }] })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 10; i += 1) await tick()

    const state = lastPersisted(res.id)
    expect(state).toBeTruthy()
    // child.cost is the SAME { totalCost, breakdown, family } shape — copied
    // straight from the session record, not a re-invented {usd, tokens}.
    expect(state.children[0].cost).toEqual(estimatedCost)
    expect(getSessionById).toHaveBeenCalledWith('sess-cost')
  })

  it('marks the run partial when one child fails and another succeeds', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)

    const failing = Object.assign(new Error('claude CLI exited with code=1'), {
      stderrOutput: 'boom',
    })
    const rejected = Promise.reject(failing)
    rejected.catch(() => {})
    runClaudeCancellable
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"ok"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
      .mockReturnValueOnce({ promise: rejected, cancel: vi.fn() })
      // synthesis spawn
      .mockReturnValueOnce({
        promise: Promise.resolve({
          stdout: '{"type":"result","result":"report"}\n',
          stderr: '',
          exitCode: 0,
        }),
        cancel: vi.fn(),
      })
    awaitNewSession.mockResolvedValue('sess-y')

    const res = await startFleetRun({
      goal: 'Partial Goal',
      children: [
        { cwd: A, prompt: 'a' },
        { cwd: A, prompt: 'b' },
      ],
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 12; i += 1) await tick()

    const state = lastPersisted(res.id)
    expect(state.status).toBe('partial')
    const statuses = state.children.map((c) => c.status).sort()
    expect(statuses).toEqual(['failed', 'succeeded'])
  })
})

describe('reconcileEscalationStatus — persists the escalated child status', () => {
  it('flips running → escalated while an escalation exists, then back to running', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    seedRun({
      id: 'esc-run',
      goal: 'Esc',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-1', status: 'running' }],
      synthesis: { status: 'pending' },
    })

    // A live tool approval exists → child must persist as 'escalated'.
    getQueryStatus.mockReturnValue({
      active: true,
      pendingApprovals: [{ approvalId: 'ap-1', toolName: 'Bash', input: { command: 'rm -rf x' } }],
    })
    let escalations = await reconcileEscalationStatus('esc-run')
    expect(escalations).toHaveLength(1)
    let persisted = JSON.parse(fsBack.files.get(`${DATA}/esc-run.json`))
    expect(persisted.children[0].status).toBe('escalated')

    // Escalation clears → child reverts to running.
    getQueryStatus.mockReturnValue({ active: false, pendingApprovals: [] })
    escalations = await reconcileEscalationStatus('esc-run')
    expect(escalations).toHaveLength(0)
    persisted = JSON.parse(fsBack.files.get(`${DATA}/esc-run.json`))
    expect(persisted.children[0].status).toBe('running')
  })

  it('leaves terminal children (succeeded) untouched even if a pending lingers', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    seedRun({
      id: 'esc-done',
      goal: 'Esc done',
      status: 'succeeded',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, sessionId: 'sess-2', status: 'succeeded' }],
      synthesis: { status: 'done' },
    })
    getQueryStatus.mockReturnValue({
      active: true,
      pendingApprovals: [{ approvalId: 'ap-2', toolName: 'Bash', input: {} }],
    })
    await reconcileEscalationStatus('esc-done')
    const persisted = JSON.parse(fsBack.files.get(`${DATA}/esc-done.json`))
    // A settled child is never reopened into 'escalated'.
    expect(persisted.children[0].status).toBe('succeeded')
  })
})

// ── Phase 4: parseVerdict (pure, fail-closed) ─────────────────────────────────
describe('parseVerdict', () => {
  it('parses a clean approve verdict', () => {
    const v = parseVerdict('{"verdict":"approve","reasons":["lgtm"],"rubricScores":{"a":1}}')
    expect(v.verdict).toBe('approve')
    expect(v.reasons).toEqual(['lgtm'])
  })
  it('parses a verdict embedded in prose', () => {
    const v = parseVerdict('Here is my review:\n{"verdict":"reject","reasons":["bug"]}\nThanks')
    expect(v.verdict).toBe('reject')
    expect(v.reasons).toEqual(['bug'])
  })
  it('FAILS CLOSED to reject on unparseable output', () => {
    expect(parseVerdict('not json at all').verdict).toBe('reject')
    expect(parseVerdict('').verdict).toBe('reject')
    expect(parseVerdict(null).verdict).toBe('reject')
  })
  it('treats an unknown verdict string as reject (fail closed)', () => {
    expect(parseVerdict('{"verdict":"maybe"}').verdict).toBe('reject')
  })
})

// ── Phase 4: spentUsd (pure) ──────────────────────────────────────────────────
describe('spentUsd', () => {
  it('sums child.cost.totalCost across workers AND verifiers, missing→0', () => {
    const state = {
      children: [
        { cost: { totalCost: 0.1 } },
        { childKind: 'verifier', cost: { totalCost: 0.2 } },
        { cost: null },
        {},
      ],
      synthesis: { cost: { totalCost: 0.05 } },
    }
    expect(spentUsd(state)).toBeCloseTo(0.35, 5)
  })
})

// ── Phase 4: BUDGETS ──────────────────────────────────────────────────────────
describe('budget enforcement', () => {
  it('start-time guard: minimum projected cost > budget → 422 (no spawn)', () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    const r = validateFleetRequest({
      goal: 'g',
      children: [
        { cwd: A, prompt: 'x' },
        { cwd: A, prompt: 'y' },
      ],
      policy: { budgetUsd: 1, perChildUsd: 0.8 }, // 2 * 0.8 = 1.6 > 1
    })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
  })

  it('refuses to spawn a child whose projection would exceed budget (budget_skipped)', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    // No perChildUsd → the conservative DEFAULT estimate (0.5) drives the
    // projection, and the start-time guard (which needs perChildUsd) is skipped.
    // With budget 1 and est 0.5, the fan-out RESERVES an estimate per committed
    // child: child0 → 0.5, child1 → 1.0 (allowed), child2 → 1.5 > 1 → refused.
    runClaudeCancellable.mockReturnValue(pending()) // committed children stay running
    awaitNewSession.mockResolvedValue('sess-a')

    const res = await startFleetRun({
      goal: 'Budget Skip',
      children: [
        { cwd: A, prompt: 'a' },
        { cwd: A, prompt: 'b' },
        { cwd: A, prompt: 'c' },
      ],
      policy: { budgetUsd: 1, maxConcurrency: MAX_FLEET_CHILDREN }, // no perChildUsd
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 6; i += 1) await tick()

    const state = lastPersisted(res.id)
    expect(state).toBeTruthy()
    const statuses = state.children.filter((c) => c.childKind !== 'verifier').map((c) => c.status)
    // Two children committed (running); the third refused as budget_skipped.
    expect(statuses.filter((s) => s === 'budget_skipped')).toHaveLength(1)
    // Only two CLI spawns happened (the third was never launched).
    expect(runClaudeCancellable).toHaveBeenCalledTimes(2)
  })

  it('running total crossing budget stops spawning → run budget_exceeded, spentUsd aggregates', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    // Single worker resolves with a cost that crosses the budget on settle.
    runClaudeCancellable.mockReturnValue(resolved('done over budget'))
    awaitNewSession.mockResolvedValue('sess-over')
    getSessionById.mockImplementation((sid) =>
      sid === 'sess-over'
        ? { sessionId: sid, estimatedCost: { totalCost: 2.0, breakdown: {}, family: 'opus' } }
        : null,
    )

    const res = await startFleetRun({
      goal: 'Budget Cross',
      children: [{ cwd: A, prompt: 'a' }],
      policy: { budgetUsd: 1 },
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 12; i += 1) await tick()

    const state = lastPersisted(res.id)
    expect(state.status).toBe('budget_exceeded')
    expect(state.spentUsd).toBeCloseTo(2.0, 5)
    expect(state.budgetRemaining).toBe(0)
    // No synthesis child spawned once the line stopped (only the one worker).
    expect(runClaudeCancellable).toHaveBeenCalledTimes(1)
  })
})

// ── Phase 4: ADVERSARIAL VERIFICATION ─────────────────────────────────────────
describe('adverse verification', () => {
  it('worker success → spawns a blind adversarial verifier; approve → succeeded', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable
      .mockReturnValueOnce(resolved('work output')) // worker
      .mockReturnValueOnce(resolved('{"verdict":"approve","reasons":["good"]}')) // verifier
      .mockReturnValue(resolved('report')) // synthesis
    awaitNewSession.mockResolvedValue('sess-v')

    const res = await startFleetRun({
      goal: 'Verify Goal',
      children: [{ cwd: A, prompt: 'do work' }],
      policy: { verify: true },
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 20; i += 1) await tick()

    const state = lastPersisted(res.id)
    const worker = state.children.find((c) => c.childKind !== 'verifier')
    const verifier = state.children.find((c) => c.childKind === 'verifier')
    expect(verifier).toBeTruthy()
    expect(worker.status).toBe('succeeded')
    expect(worker.verdicts).toHaveLength(1)
    expect(worker.verdicts[0].verdict).toBe('approve')

    // The verifier prompt is BLIND: never reveals authorship / who wrote it.
    const verifierArgv = runClaudeCancellable.mock.calls[1][0]
    const vp = verifierArgv.args[verifierArgv.args.indexOf('-p') + 1]
    expect(vp).toMatch(/adversarial reviewer/i)
    expect(vp).not.toMatch(/the worker wrote|you wrote|authored by/i)
  })

  it('reject with no rounds remaining → worker terminal "rejected"', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable
      .mockReturnValueOnce(resolved('work')) // worker
      .mockReturnValueOnce(resolved('{"verdict":"reject","reasons":["broken"]}')) // verifier
      .mockReturnValue(resolved('report')) // synthesis
    awaitNewSession.mockResolvedValue('sess-r')

    const res = await startFleetRun({
      goal: 'Reject Goal',
      children: [{ cwd: A, prompt: 'do work' }],
      policy: { verify: { minApprovals: 1, maxRounds: 1 } },
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 20; i += 1) await tick()

    const state = lastPersisted(res.id)
    const worker = state.children.find((c) => c.childKind !== 'verifier')
    expect(worker.status).toBe('rejected')
    expect(worker.rounds).toBe(1)
  })

  it('reject then re-dispatch (maxRounds 2) → worker re-spawned, then settles', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable
      .mockReturnValueOnce(resolved('work v1')) // worker round 0
      .mockReturnValueOnce(resolved('{"verdict":"reject","reasons":["fix x"]}')) // verifier round 0
      .mockReturnValueOnce(resolved('work v2')) // worker re-dispatch round 1
      .mockReturnValueOnce(resolved('{"verdict":"approve","reasons":["ok now"]}')) // verifier round 1
      .mockReturnValue(resolved('report')) // synthesis
    awaitNewSession.mockResolvedValue('sess-rd')

    const res = await startFleetRun({
      goal: 'Redispatch Goal',
      children: [{ cwd: A, prompt: 'do work' }],
      policy: { verify: { minApprovals: 1, maxRounds: 2 } },
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 30; i += 1) await tick()

    const state = lastPersisted(res.id)
    const worker = state.children.find((c) => c.childKind !== 'verifier')
    expect(worker.status).toBe('succeeded')
    expect(worker.verdicts.map((v) => v.verdict)).toEqual(['reject', 'approve'])
    // Two worker spawns happened (original + one re-dispatch), each with the
    // re-dispatch prompt carrying the prior reasons on the second.
    const redispatchArgv = runClaudeCancellable.mock.calls[2][0]
    const rp = redispatchArgv.args[redispatchArgv.args.indexOf('-p') + 1]
    expect(rp).toMatch(/prior reviewer rejected/i)
    expect(rp).toMatch(/fix x/)
  })

  it('verifier cost rolls into spentUsd and respects the budget latch (no re-spawn)', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    // Worker reports cost; verifier reports cost that pushes over budget.
    runClaudeCancellable
      .mockReturnValueOnce(resolved('work')) // worker
      .mockReturnValueOnce(resolved('{"verdict":"reject","reasons":["x"]}')) // verifier
      .mockReturnValue(resolved('report')) // synthesis (should NOT spawn)
    let n = 0
    awaitNewSession.mockImplementation(() => Promise.resolve(`sess-${n++}`))
    getSessionById.mockImplementation((sid) => {
      if (sid === 'sess-0')
        return { sessionId: sid, estimatedCost: { totalCost: 0.6, breakdown: {}, family: 'opus' } }
      if (sid === 'sess-1')
        return { sessionId: sid, estimatedCost: { totalCost: 0.6, breakdown: {}, family: 'opus' } }
      return null
    })

    const res = await startFleetRun({
      goal: 'Verify Budget',
      children: [{ cwd: A, prompt: 'do work' }],
      policy: { budgetUsd: 1, verify: { minApprovals: 1, maxRounds: 3 } },
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 24; i += 1) await tick()

    const state = lastPersisted(res.id)
    // spentUsd aggregates worker (0.6) + verifier (0.6) = 1.2, crossing budget.
    expect(state.spentUsd).toBeCloseTo(1.2, 5)
    // Despite maxRounds 3, the budget latch stopped re-dispatch — the worker is
    // terminal (rejected) and the run is budget_exceeded.
    expect(state.status).toBe('budget_exceeded')
    const worker = state.children.find((c) => c.childKind !== 'verifier')
    expect(worker.status).toBe('rejected')
  })
})

// ── Phase 4: QUARANTINE ───────────────────────────────────────────────────────
describe('quarantine', () => {
  it('prepends the read-only directive to a quarantined child prompt', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable.mockReturnValue(pending())
    awaitNewSession.mockResolvedValue('sess-q')

    const res = await startFleetRun({
      goal: 'Quarantine Goal',
      children: [{ cwd: A, prompt: 'investigate the bug', quarantine: true }],
    })
    expect(res.ok).toBe(true)

    const argv = runClaudeCancellable.mock.calls[0][0]
    const p = argv.args[argv.args.indexOf('-p') + 1]
    expect(p).toMatch(/QUARANTINE MODE/)
    expect(p).toMatch(/read-only/i)
    expect(p).toMatch(/investigate the bug/)
  })

  it('excludes a quarantined child from being the synthesis cwd', async () => {
    getKnownHarnessRoots.mockReturnValue([A, 'C:/proj/b'])
    gitPaths.add(A)
    gitPaths.add('C:/proj/b')
    // child 0 quarantined (cwd A), child 1 normal (cwd B). Both succeed; then
    // synthesis must run in B (the non-quarantined child), NOT A.
    runClaudeCancellable
      .mockReturnValueOnce(resolved('q done')) // child 0 (quarantined, A)
      .mockReturnValueOnce(resolved('n done')) // child 1 (normal, B)
      .mockReturnValue(resolved('report')) // synthesis
    awaitNewSession.mockResolvedValue('sess-s')

    const res = await startFleetRun({
      goal: 'Synth cwd Goal',
      children: [
        { cwd: A, prompt: 'a', quarantine: true },
        { cwd: 'C:/proj/b', prompt: 'b' },
      ],
    })
    expect(res.ok).toBe(true)
    for (let i = 0; i < 16; i += 1) await tick()

    // The last spawn is synthesis; its cwd must be the non-quarantined child's.
    const synthCall = runClaudeCancellable.mock.calls[runClaudeCancellable.mock.calls.length - 1][0]
    expect(synthCall.cwd).toBe('C:/proj/b')
  })
})

// ── Phase 4: TEMPLATES ────────────────────────────────────────────────────────
describe('fleet templates', () => {
  it('isValidTemplateName rejects traversal / bad names', () => {
    expect(isValidTemplateName('my-template')).toBe(true)
    expect(isValidTemplateName('../escape')).toBe(false)
    expect(isValidTemplateName('a/b')).toBe(false)
    expect(isValidTemplateName('a\\b')).toBe(false)
    expect(isValidTemplateName('-leading')).toBe(false)
    expect(isValidTemplateName('')).toBe(false)
  })

  it('saves, lists, and reads back a template', async () => {
    const r = await saveFleetTemplate({
      name: 'oauth-fleet',
      goal: 'Add OAuth',
      children: [{ cwd: A, prompt: 'do it', quarantine: true }],
      policy: { budgetUsd: 5, verify: true },
    })
    expect(r.ok).toBe(true)
    expect(r.status).toBe(200)

    const list = listFleetTemplates()
    expect(list.map((t) => t.name)).toContain('oauth-fleet')

    const got = getFleetTemplate('oauth-fleet')
    expect(got.goal).toBe('Add OAuth')
    expect(got.children[0].quarantine).toBe(true)
    expect(got.policy.budgetUsd).toBe(5)
  })

  it('rejects saving a template with a bad name or empty body', async () => {
    expect(
      (await saveFleetTemplate({ name: '../x', goal: 'g', children: [{ cwd: A, prompt: 'p' }] }))
        .status,
    ).toBe(400)
    expect(
      (await saveFleetTemplate({ name: 'ok', goal: '', children: [{ cwd: A, prompt: 'p' }] }))
        .status,
    ).toBe(400)
    expect((await saveFleetTemplate({ name: 'ok', goal: 'g', children: [] })).status).toBe(400)
  })
})

describe('decideFleetEscalation — source "harness" is a DIRECT subprocess (no LLM)', () => {
  // Seed a run with one escalated child rooted at a (mockable) known harness root.
  function seedHarnessRun() {
    seedRun({
      id: 'fr-1',
      goal: 'g',
      status: 'running',
      children: [{ idx: 0, cwd: A, status: 'escalated' }],
    })
  }

  it('invokes the harness CLI with [approve, <requestId>, --allow] in child.cwd', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    runHarnessApprove.mockResolvedValue({ ok: true, stdout: 'approval rq-1 allow', stderr: '' })
    seedHarnessRun()

    const res = await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
      requestId: 'rq-1',
    })

    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(runHarnessApprove).toHaveBeenCalledTimes(1)
    expect(runHarnessApprove).toHaveBeenCalledWith(A, 'rq-1', 'allow')
    // The raw CLI output is surfaced back to the caller.
    expect(res.raw).toContain('approval rq-1 allow')
  })

  it('passes --deny through for a deny decision', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    runHarnessApprove.mockResolvedValue({ ok: true, stdout: 'approval rq-1 deny', stderr: '' })
    seedHarnessRun()

    const res = await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'deny',
      requestId: 'rq-1',
    })

    expect(res.ok).toBe(true)
    expect(runHarnessApprove).toHaveBeenCalledWith(A, 'rq-1', 'deny')
  })

  it('spawns NO claude session for a harness decision', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    runHarnessApprove.mockResolvedValue({ ok: true, stdout: 'ok', stderr: '' })
    seedHarnessRun()

    await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
      requestId: 'rq-1',
    })

    expect(runClaude).not.toHaveBeenCalled()
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })

  it('404s on a non-known-root cwd without shelling out', async () => {
    getKnownHarnessRoots.mockReturnValue([]) // child.cwd A is NOT a known root
    seedHarnessRun()

    const res = await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
      requestId: 'rq-1',
    })

    expect(res.ok).toBe(false)
    expect(res.status).toBe(404)
    expect(runHarnessApprove).not.toHaveBeenCalled()
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('maps a CLI failure to a 502 and surfaces its message', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    runHarnessApprove.mockResolvedValue({
      ok: false,
      error: 'pending rq-1 not found or already decided',
      stdout: '',
      stderr: 'pending rq-1 not found or already decided',
    })
    seedHarnessRun()

    const res = await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
      requestId: 'rq-1',
    })

    expect(res.ok).toBe(false)
    expect(res.status).toBe(502)
    expect(runClaude).not.toHaveBeenCalled()
  })

  it('requires requestId for source "harness" (400 before any shell-out)', async () => {
    getKnownHarnessRoots.mockReturnValue([A])
    seedHarnessRun()

    const res = await decideFleetEscalation('fr-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
    })

    expect(res.status).toBe(400)
    expect(runHarnessApprove).not.toHaveBeenCalled()
  })
})
