vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(),
      openSync: vi.fn(),
      readSync: vi.fn(),
      closeSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  }
})

vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
}))

import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  getConductorRuns,
  getConductorRunById,
  getKnownConductorRoots,
  readRunFile,
} from '../../parsers/conductor.js'
import { emit } from '../../sse.js'
import { isDegraded, _resetDegradedDedupe } from '../../lib/claude-format.js'

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const PROJECT_A = 'C:\\projects\\foo'

// Minimal default status that satisfies the schema enough to render.
function statusJson(overrides = {}) {
  return JSON.stringify({
    adr: '0011',
    phase: 'build',
    started_at: '2026-05-01T00:00:00Z',
    current_task_id: 't-1',
    task_iters: { 't-1': 2 },
    splits: {},
    events_offset: 0,
    acceptance_commands_required: ['npm test'],
    acceptance_commands_run: [],
    ...overrides,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
  _resetDegradedDedupe()
})

// getSessionCwds() moved to lib/session-discovery.js — see its own test there.
// The conductor parser consumes it; the getKnownConductorRoots tests below
// still exercise the full discovery path end-to-end.

// ─── getKnownConductorRoots ──────────────────────────────────────────────────

describe('getKnownConductorRoots()', () => {
  it('only includes cwds with an existing .conductor/ directory', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) => {
      return buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8')
    })
    fs.statSync.mockImplementation((p) => {
      if (p === path.join(PROJECT_A, '.conductor')) {
        return { isDirectory: () => true, isFile: () => false }
      }
      throw new Error('ENOENT')
    })
    expect(getKnownConductorRoots()).toEqual([PROJECT_A])
  })

  it('drops cwds without a .conductor/ directory', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) => {
      return buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8')
    })
    fs.statSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(getKnownConductorRoots()).toEqual([])
  })
})

// ─── getConductorRuns ────────────────────────────────────────────────────────

describe('getConductorRuns()', () => {
  function setupSingleRunWithStatus(status) {
    fs.existsSync.mockReturnValue(true)
    // First call: project dirs
    // Second call: session files
    // Third call: ADR dirs under .conductor
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
      .mockReturnValueOnce([{ name: '0011', isDirectory: () => true }])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) => {
      return buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8')
    })
    fs.statSync.mockImplementation((p) => {
      if (p === path.join(PROJECT_A, '.conductor')) {
        return { isDirectory: () => true, isFile: () => false }
      }
      // existsAsFile checks for journal-draft, ratification-proposal, skill-diff-proposal
      throw new Error('ENOENT')
    })
    fs.readFileSync.mockReturnValue(status)
  }

  it('parses status.json into a typed run', () => {
    setupSingleRunWithStatus(statusJson())
    const runs = getConductorRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({
      projectPath: PROJECT_A,
      adr: '0011',
      phase: 'build',
      currentTaskId: 't-1',
      taskIters: { 't-1': 2 },
      isPaused: false,
    })
  })

  it('flips isPaused when phase is escalated', () => {
    setupSingleRunWithStatus(statusJson({ phase: 'escalated', escalation_reason: 'stuck' }))
    const runs = getConductorRuns()
    expect(runs[0].isPaused).toBe(true)
    expect(runs[0].escalationReason).toBe('stuck')
  })

  it('flips isPaused when escalation_reason is set even on a non-escalated phase', () => {
    setupSingleRunWithStatus(statusJson({ phase: 'build', escalation_reason: 'OAuth needed' }))
    expect(getConductorRuns()[0].isPaused).toBe(true)
  })

  it('skips ADR dirs whose name is not exactly 4 digits', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
      .mockReturnValueOnce([
        { name: '_archive', isDirectory: () => true },
        { name: '99', isDirectory: () => true },
        { name: '0011', isDirectory: () => true },
      ])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) =>
      buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8'),
    )
    fs.statSync.mockImplementation((p) => {
      if (p === path.join(PROJECT_A, '.conductor')) {
        return { isDirectory: () => true, isFile: () => false }
      }
      throw new Error('ENOENT')
    })
    fs.readFileSync.mockReturnValue(statusJson())
    const runs = getConductorRuns()
    expect(runs).toHaveLength(1)
    expect(runs[0].adr).toBe('0011')
  })

  it('falls back to legacy iter_count when task_iters is absent', () => {
    setupSingleRunWithStatus(
      JSON.stringify({
        adr: '0011',
        phase: 'build',
        started_at: '2026-05-01T00:00:00Z',
        current_task_id: 't-1',
        iter_count: 4,
        events_offset: 0,
      }),
    )
    expect(getConductorRuns()[0].taskIters).toEqual({ 't-1': 4 })
  })

  it('surfaces a degraded run (NOT a silent []) when status.json is present but unparseable', () => {
    // A present-but-unparseable status.json must not silently drop the run —
    // that renders the dashboard as "no conductor runs" when a run is in fact
    // governing the project. Surface a distinguishable degraded run entry AND a
    // persistent parser_degraded SSE event.
    setupSingleRunWithStatus('{not json')
    const runs = getConductorRuns()
    expect(runs).toHaveLength(1)
    expect(isDegraded(runs[0])).toBe(true)
    expect(runs[0]).not.toEqual({})
    // The degraded run still carries enough to locate it in the UI.
    expect(runs[0].projectPath).toBe(PROJECT_A)
    expect(runs[0].adr).toBe('0011')
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'conductor' }),
    )
  })

  it('stays silent (no degrade) when status.json is absent — an empty .conductor dir is normal', () => {
    // An ADR dir with no status.json yet is a normal in-flight state, not a
    // format break. Drop it silently; do NOT emit parser_degraded.
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
      .mockReturnValueOnce([{ name: '0011', isDirectory: () => true }])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) =>
      buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8'),
    )
    fs.statSync.mockImplementation((p) => {
      if (p === path.join(PROJECT_A, '.conductor')) {
        return { isDirectory: () => true, isFile: () => false }
      }
      throw new Error('ENOENT')
    })
    // status.json read fails with ENOENT (absent), not a parse error
    fs.readFileSync.mockImplementation(() => {
      const err = new Error('ENOENT')
      err.code = 'ENOENT'
      throw err
    })
    const runs = getConductorRuns()
    expect(runs).toEqual([])
    expect(emit).not.toHaveBeenCalledWith('parser_degraded', expect.anything())
  })
})

// ─── getConductorRunById ─────────────────────────────────────────────────────

describe('getConductorRunById()', () => {
  it('rejects ADRs that are not 4 digits', () => {
    expect(getConductorRunById(PROJECT_A, 'abc')).toBeNull()
    expect(getConductorRunById(PROJECT_A, '11')).toBeNull()
    expect(getConductorRunById(PROJECT_A, '00011')).toBeNull()
  })

  it('rejects projectPaths not in the known-roots whitelist (path traversal guard)', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    // No known roots → any projectPath should be refused
    expect(getConductorRunById('C:\\Windows\\System32', '0011')).toBeNull()
  })
})

// ─── readRunFile ─────────────────────────────────────────────────────────────

describe('readRunFile()', () => {
  it('returns null when the run cannot be located', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    expect(readRunFile('C:\\nope', '0011', 'journalDraft')).toBeNull()
  })
})
