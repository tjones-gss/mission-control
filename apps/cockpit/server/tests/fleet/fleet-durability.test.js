import { describe, it, expect, vi, beforeEach } from 'vitest'

// Item 1g — Durable Fleet: boot reconciler + reaper + derived settle.
//
// These unit tests exercise the durability machinery in isolation (MOCK the
// whole spawn/persist stack — never launch a real claude session). They cover:
//   1. the DERIVED settle predicate (pure function of persisted child status),
//      replacing the hand-counted pendingCounts model — NO double-settle and NO
//      stuck-settle across every interleaving of child-settle orderings (fuzz);
//   2. the boot reconciler reconcileFleetRuns() that scans DATA_DIR and moves
//      non-terminal runs to the terminal 'orphaned' status on restart;
//   3. the global hard kill-switch reachable independent of in-memory state.

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
// audit-log pulls in @mission-control/contracts (which reads schema files via fs at
// module init); mock it so this fs-mocked lane never loads the contracts chain.
vi.mock('../../lib/audit-log.js', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(null),
  recordAuditEventSafe: vi.fn().mockResolvedValue(null),
}))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

const gitPaths = new Set()
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
  const writeFileSync = vi.fn((p, data) => {
    const norm = String(p).replace(/\\/g, '/')
    fsBack.files.set(norm, String(data))
  })
  const promises = { mkdir: vi.fn().mockResolvedValue(undefined) }
  const api = { statSync, readdirSync, readFileSync, writeFileSync, promises }
  return { ...api, default: { ...api } }
})

import { runClaudeCancellable } from '../../claude-cli.js'
import { awaitNewSession } from '../../lib/pending-session.js'
import { atomicWriteJson } from '../../lib/atomic-write.js'
import { emit } from '../../sse.js'
import {
  startFleetRun,
  reconcileFleetRuns,
  allChildrenSettled,
  engageKillSwitch,
  isKillSwitchEngaged,
  resetKillSwitch,
  getFleetRun,
  __resetFleet,
  DATA_DIR,
} from '../../fleet/fleet-runner.js'

const A = 'C:/proj/a'
const DATA = String(DATA_DIR).replace(/\\/g, '/')

function seedRun(state) {
  fsBack.files.set(`${DATA}/${state.id}.json`, JSON.stringify(state))
  const names = fsBack.dirs.get(DATA) || []
  if (!names.includes(`${state.id}.json`)) names.push(`${state.id}.json`)
  fsBack.dirs.set(DATA, names)
}

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
  resetKillSwitch()
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

// ── Derived settle predicate (pure) ──────────────────────────────────────────
describe('allChildrenSettled (pure derived predicate)', () => {
  const worker = (status) => ({ idx: 0, childKind: 'worker', status })
  const verifier = (status) => ({ idx: 1, childKind: 'verifier', status })

  it('is false while any worker is non-terminal', () => {
    expect(allChildrenSettled({ children: [worker('running')] })).toBe(false)
    expect(allChildrenSettled({ children: [worker('starting')] })).toBe(false)
    expect(allChildrenSettled({ children: [worker('escalated')] })).toBe(false)
  })

  it('is false while a worker is verifying (a verifier is still in flight)', () => {
    expect(allChildrenSettled({ children: [worker('verifying'), verifier('running')] })).toBe(false)
  })

  it('is false while a verifier child is non-terminal', () => {
    expect(allChildrenSettled({ children: [worker('succeeded'), verifier('running')] })).toBe(false)
  })

  it('is true once every worker AND verifier is terminal', () => {
    expect(allChildrenSettled({ children: [worker('succeeded'), verifier('succeeded')] })).toBe(
      true,
    )
    expect(allChildrenSettled({ children: [worker('failed')] })).toBe(true)
    expect(allChildrenSettled({ children: [worker('rejected')] })).toBe(true)
    expect(allChildrenSettled({ children: [worker('budget_skipped')] })).toBe(true)
    expect(allChildrenSettled({ children: [worker('cancelled')] })).toBe(true)
  })
})

// ── No double-settle / no stuck-settle (fuzz over interleavings) ──────────────
describe('settle is exactly-once under every child-settle interleaving (fuzz)', () => {
  // Each run has N workers that all resolve succeeded; synthesis is one extra
  // spawn. With derived settle, synthesis must run EXACTLY ONCE per run no matter
  // the order in which the children's CLI promises resolve.
  function permutations(arr) {
    if (arr.length <= 1) return [arr]
    const out = []
    for (let i = 0; i < arr.length; i += 1) {
      const rest = [...arr.slice(0, i), ...arr.slice(i + 1)]
      for (const p of permutations(rest)) out.push([arr[i], ...p])
    }
    return out
  }

  for (const N of [1, 2, 3]) {
    for (const order of permutations(Array.from({ length: N }, (_, i) => i))) {
      it(`N=${N} settle order [${order.join(',')}] → synthesis spawns exactly once`, async () => {
        const { getKnownHarnessRoots } = await import('../../parsers/harness.js')
        getKnownHarnessRoots.mockReturnValue([A])
        gitPaths.add(A)

        // Build N deferred child promises whose resolution order we control, plus
        // a synthesis spawn that always resolves.
        const resolvers = []
        const childSpawns = order.map(() => ({
          promise: new Promise((resolve) => {
            resolvers.push(() =>
              resolve({
                stdout: '{"type":"result","result":"done"}\n',
                stderr: '',
                exitCode: 0,
              }),
            )
          }),
          cancel: vi.fn(),
        }))
        let synthSpawnCount = 0
        runClaudeCancellable.mockImplementation((opts) => {
          const argv = opts.args || []
          const promptIdx = argv.indexOf('-p')
          const prompt = promptIdx !== -1 ? argv[promptIdx + 1] : ''
          if (/Synthesize/i.test(prompt)) {
            synthSpawnCount += 1
            return {
              promise: Promise.resolve({
                stdout: '{"type":"result","result":"report"}\n',
                stderr: '',
                exitCode: 0,
              }),
              cancel: vi.fn(),
            }
          }
          return childSpawns.shift()
        })
        awaitNewSession.mockResolvedValue('sess-x')

        const res = await startFleetRun({
          goal: `Fuzz N${N}`,
          children: Array.from({ length: N }, (_, i) => ({ cwd: A, prompt: `w${i}` })),
        })
        expect(res.ok).toBe(true)

        // Resolve the children in the chosen interleaving order.
        for (const idx of order) {
          resolvers[idx]()
          await tick()
        }
        for (let i = 0; i < 12; i += 1) await tick()

        // Synthesis ran EXACTLY ONCE — no double-settle.
        expect(synthSpawnCount).toBe(1)
        // And the run finalized — no stuck-settle.
        const state = lastPersisted(res.id)
        expect(state.status).toBe('succeeded')
        expect(['done', 'skipped']).toContain(state.synthesis.status)
      })
    }
  }
})

// ── Boot reconciler ───────────────────────────────────────────────────────────
describe('reconcileFleetRuns (boot reconciler / reaper)', () => {
  it('moves a non-terminal persisted run to terminal "orphaned" with orphaned children', async () => {
    seedRun({
      id: 'wedged-run',
      goal: 'interrupted',
      status: 'running',
      createdAt: 't',
      updatedAt: 't',
      children: [
        { idx: 0, cwd: A, status: 'running', childKind: 'worker', pid: 999999 },
        { idx: 1, cwd: A, status: 'succeeded', childKind: 'worker' },
      ],
      synthesis: { status: 'pending' },
    })

    await reconcileFleetRuns()

    const after = getFleetRun('wedged-run')
    expect(after.status).toBe('orphaned')
    // The non-terminal child is reaped to 'orphaned'; the already-terminal one
    // (succeeded) is left as-is (honest record of what completed).
    expect(after.children[0].status).toBe('orphaned')
    expect(after.children[1].status).toBe('succeeded')
    // An SSE fleet_update was emitted so the UI reflects the orphaned run.
    expect(emit).toHaveBeenCalledWith('fleet_update', expect.objectContaining({ id: 'wedged-run' }))
  })

  it('leaves already-terminal runs untouched (no spurious re-persist)', async () => {
    seedRun({
      id: 'done-run',
      goal: 'done',
      status: 'succeeded',
      createdAt: 't',
      updatedAt: 't',
      children: [{ idx: 0, cwd: A, status: 'succeeded', childKind: 'worker' }],
      synthesis: { status: 'done' },
    })

    await reconcileFleetRuns()

    const after = getFleetRun('done-run')
    expect(after.status).toBe('succeeded')
    // No write happened for a terminal run.
    expect(atomicWriteJson).not.toHaveBeenCalled()
  })

  it('reaps every non-terminal status (running / verifying / starting / escalated)', async () => {
    for (const status of ['running', 'verifying', 'starting', 'escalated']) {
      seedRun({
        id: `nt-${status}`,
        goal: status,
        status,
        createdAt: 't',
        updatedAt: 't',
        children: [{ idx: 0, cwd: A, status, childKind: 'worker' }],
        synthesis: { status: 'pending' },
      })
    }

    await reconcileFleetRuns()

    for (const status of ['running', 'verifying', 'starting', 'escalated']) {
      expect(getFleetRun(`nt-${status}`).status).toBe('orphaned')
    }
  })
})

// ── Global hard kill-switch ────────────────────────────────────────────────────
describe('global hard kill-switch', () => {
  it('engageKillSwitch flips an independent module flag readable without in-memory run state', () => {
    expect(isKillSwitchEngaged()).toBe(false)
    engageKillSwitch()
    expect(isKillSwitchEngaged()).toBe(true)
  })

  it('refuses to start any new run while engaged (fail closed, no spawn)', async () => {
    const { getKnownHarnessRoots } = await import('../../parsers/harness.js')
    getKnownHarnessRoots.mockReturnValue([A])
    gitPaths.add(A)
    runClaudeCancellable.mockReturnValue({ promise: new Promise(() => {}), cancel: vi.fn() })
    awaitNewSession.mockResolvedValue('sess-k')

    engageKillSwitch()
    const res = await startFleetRun({ goal: 'blocked', children: [{ cwd: A, prompt: 'x' }] })
    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
    expect(runClaudeCancellable).not.toHaveBeenCalled()
  })
})
