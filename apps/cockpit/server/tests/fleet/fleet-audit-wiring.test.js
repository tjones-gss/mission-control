import { describe, it, expect, vi, beforeEach } from 'vitest'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
// JSON import (not fs.readFileSync) so loading the schema does NOT go through the
// `fs` mock vitest also applies to node:fs — the mock would otherwise throw ENOENT.
import schema from '../../../../../packages/contracts/schemas/audit-event.schema.json' with { type: 'json' }

// FLEET AUDIT WIRING (Phase 4 / D-audit-otel): proves the Fleet runner routes its
// spawn / merge(synthesis) / approval(escalation) events through the cockpit's SOLE
// audit writer with records that VALIDATE against the shared contract. Heavy mocks:
// never launch a real claude session or touch the real fs.

const recorded = []
vi.mock('../../lib/audit-log.js', () => ({
  recordAuditEventSafe: vi.fn((e) => {
    recorded.push(e)
    return Promise.resolve(e)
  }),
  recordAuditEvent: vi.fn((e) => {
    recorded.push(e)
    return Promise.resolve(e)
  }),
}))
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
  awaitNewSession: vi.fn(() => new Promise(() => {})), // never acks in this lane
}))
vi.mock('../../pty-session.js', () => ({
  getQueryStatus: vi.fn(() => ({ active: false, pendingApprovals: [] })),
  resolveApproval: vi.fn(() => true),
}))
vi.mock('../../parsers/sessions.js', () => ({ getSessionById: vi.fn(() => null) }))
vi.mock('../../sse.js', () => ({ emit: vi.fn() }))
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
  const readdirSync = vi.fn((p) => fsBack.dirs.get(String(p).replace(/\\/g, '/')) || [])
  const readFileSyncMock = vi.fn((p) => {
    const norm = String(p).replace(/\\/g, '/')
    if (fsBack.files.has(norm)) return fsBack.files.get(norm)
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
  })
  const promises = { mkdir: vi.fn().mockResolvedValue(undefined) }
  const api = { statSync, readdirSync, readFileSync: readFileSyncMock, promises }
  return { ...api, default: { ...api } }
})

import { getKnownHarnessRoots, runHarnessApprove } from '../../parsers/harness.js'
import { runClaudeCancellable } from '../../claude-cli.js'
import {
  startFleetRun,
  decideFleetEscalation,
  __resetFleet,
  DATA_DIR,
} from '../../fleet/fleet-runner.js'

function isValid(event) {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  addFormats(ajv)
  const full = { schemaVersion: 9, ts: new Date().toISOString(), seq: 1, ...event }
  return ajv.compile(schema)(full)
}

const CWD = '/work/fleet-proj'

beforeEach(() => {
  recorded.length = 0
  vi.clearAllMocks()
  __resetFleet()
  gitPaths.clear()
  fsBack.dirs.clear()
  fsBack.files.clear()
  getKnownHarnessRoots.mockReturnValue([CWD])
  gitPaths.add(CWD)
})

// A spawn whose CLI resolves to a stream-json result and then settles → synthesis.
function resolvedCli(result) {
  return {
    promise: Promise.resolve({
      stdout: `{"type":"result","result":${JSON.stringify(result)}}\n`,
      stderr: '',
      exitCode: 0,
    }),
    cancel: vi.fn(),
  }
}

describe('fleet audit wiring: spawn + merge(synthesis)', () => {
  it('records a schema-valid spawn per child AND a merge event at synthesis', async () => {
    runClaudeCancellable.mockImplementation(() => resolvedCli('done'))

    const res = await startFleetRun({ goal: 'do work', children: [{ cwd: CWD, prompt: 'go' }] })
    expect(res.ok).toBe(true)

    // Let the worker settle and synthesis run.
    await new Promise((r) => setTimeout(r, 50))

    const spawns = recorded.filter((e) => e.eventType === 'spawn')
    const merges = recorded.filter((e) => e.eventType === 'merge')
    expect(spawns.length).toBeGreaterThanOrEqual(1)
    expect(merges.length).toBe(1)

    for (const ev of [...spawns, ...merges]) {
      expect(ev.source).toBe('cockpit')
      expect(ev.correlationId).toBe(res.id)
      expect(isValid(ev)).toBe(true)
    }
    expect(spawns[0].payload.kind).toBe('fleet_child')
    expect(merges[0].payload.kind).toBe('fleet_synthesis')
    // v9: automated steps carry decisionMaker 'auto' + the rails the child
    // launched under (children are always worktree-isolated).
    expect(spawns[0].controlState.decisionMaker).toBe('auto')
    expect(spawns[0].controlState.policiesInForce).toContain('worktree-isolation')
    expect(merges[0].controlState.decisionMaker).toBe('auto')
  })
})

describe('fleet audit wiring: approval (escalation decide)', () => {
  function seedRun(child) {
    const state = {
      id: 'run-1',
      goal: 'g',
      status: 'running',
      children: [child],
      synthesis: { status: 'pending' },
    }
    fsBack.files.set(`${String(DATA_DIR).replace(/\\/g, '/')}/run-1.json`, JSON.stringify(state))
  }

  it('records a schema-valid cockpit approval for a tool decision', async () => {
    seedRun({ idx: 0, cwd: CWD, sessionId: 'sess-x', status: 'escalated' })
    const out = await decideFleetEscalation('run-1', {
      childIdx: 0,
      source: 'tool',
      decision: 'allow',
      approvalId: 'a-1',
    })
    expect(out.ok).toBe(true)
    const approvals = recorded.filter((e) => e.eventType === 'approval')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].source).toBe('cockpit')
    expect(approvals[0].subjectId).toBe('a-1')
    expect(approvals[0].decision).toBe('approved')
    // v9: an escalation decision is a HARD gate decided by a human.
    expect(approvals[0].controlState.gateType).toBe('hard')
    expect(approvals[0].controlState.decisionMaker).toBe('human')
    expect(isValid(approvals[0])).toBe(true)
  })

  it('records a schema-valid HARNESS-mediated approval for a harness decision', async () => {
    seedRun({ idx: 0, cwd: CWD, sessionId: 'sess-y', status: 'escalated' })
    runHarnessApprove.mockResolvedValue({ ok: true, stdout: 'decided', stderr: '' })
    const out = await decideFleetEscalation('run-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'deny',
      requestId: 'req-7',
    })
    expect(out.ok).toBe(true)
    const approvals = recorded.filter((e) => e.eventType === 'approval')
    expect(approvals).toHaveLength(1)
    expect(approvals[0].source).toBe('harness')
    expect(approvals[0].subjectId).toBe('req-7')
    expect(approvals[0].decision).toBe('denied')
    // v9: the rails' danger-zone policy owns this hard gate.
    expect(approvals[0].controlState.gateType).toBe('hard')
    expect(approvals[0].controlState.decisionMaker).toBe('human')
    expect(approvals[0].controlState.policiesInForce).toContain('danger-zone-approval')
    expect(isValid(approvals[0])).toBe(true)
  })

  it('records NOTHING when a harness decision fails (runHarnessApprove not ok)', async () => {
    seedRun({ idx: 0, cwd: CWD, sessionId: 'sess-z', status: 'escalated' })
    runHarnessApprove.mockResolvedValue({ ok: false, error: 'no pending' })
    const out = await decideFleetEscalation('run-1', {
      childIdx: 0,
      source: 'harness',
      decision: 'allow',
      requestId: 'req-x',
    })
    expect(out.ok).toBe(false)
    expect(recorded.filter((e) => e.eventType === 'approval')).toHaveLength(0)
  })
})
