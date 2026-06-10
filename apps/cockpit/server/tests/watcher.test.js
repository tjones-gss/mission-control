import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')

const handlers = {}
const fakeWatcher = {
  on: vi.fn((event, handler) => {
    handlers[event] = handler
    return fakeWatcher
  }),
}

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => fakeWatcher),
  },
}))

vi.mock('../sse.js', () => ({
  emit: vi.fn(),
  addClient: vi.fn(),
  removeClient: vi.fn(),
}))

vi.mock('../intelligence/triggers.js', () => ({
  onSessionEvent: vi.fn(),
}))

vi.mock('../lib/db/session-index.js', () => ({
  upsertSession: vi.fn(),
  removeSession: vi.fn(),
}))

vi.mock('../lib/db/memory-index.js', () => ({
  indexMemoryFile: vi.fn(),
  removeMemoryFile: vi.fn(),
}))

import chokidar from 'chokidar'
import { emit } from '../sse.js'
import { onSessionEvent } from '../intelligence/triggers.js'
import { upsertSession, removeSession } from '../lib/db/session-index.js'
import { indexMemoryFile, removeMemoryFile } from '../lib/db/memory-index.js'
import { startWatcher } from '../watcher.js'

describe('watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(handlers)) {
      delete handlers[key]
    }
  })

  it('creates chokidar.watch with the correct CLAUDE_DIR path', () => {
    startWatcher()
    expect(chokidar.watch).toHaveBeenCalledWith(
      CLAUDE_DIR,
      expect.objectContaining({ persistent: true, ignoreInitial: true }),
    )
  })

  it('emits session_update on change for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'myproject', 'abc123.jsonl')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('session_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('calls onSessionEvent with sessionId on change for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'myproject', 'sess42.jsonl')
    handlers.change(filePath)
    expect(onSessionEvent).toHaveBeenCalledWith('sess42')
  })

  it('emits task_update on change for tasks/*', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'tasks', 'task1.json')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('task_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('emits team_update on change for teams/*', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'teams', 'team-a.json')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('team_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('emits history_update on change for history.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'history.jsonl')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('history_update', {
      ts: expect.any(Number),
    })
  })

  it('does not emit for unrecognized paths on change', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'random', 'unknown.txt')
    handlers.change(filePath)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits new_session on add for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'newsess.jsonl')
    handlers.add(filePath)
    expect(emit).toHaveBeenCalledWith('new_session', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('calls onSessionEvent with sessionId on add for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'addsess.jsonl')
    handlers.add(filePath)
    expect(onSessionEvent).toHaveBeenCalledWith('addsess')
  })

  it('does not emit on add for non-.jsonl files in projects/', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'readme.txt')
    handlers.add(filePath)
    expect(emit).not.toHaveBeenCalled()
    expect(onSessionEvent).not.toHaveBeenCalled()
  })

  // Regression: a chokidar 'error' event with no listener is re-thrown as an
  // uncaught exception and crashes the server. On Windows, stat-ing a file in a
  // transient ~/.claude/plugins/cache/temp_git_* dir (created and deleted by the
  // plugin system) throws EPERM, which previously killed the process.
  it('registers an error handler so watcher errors do not crash the process', () => {
    startWatcher()
    expect(handlers.error).toBeTypeOf('function')
  })

  it('error handler swallows transient FS errors (e.g. Windows EPERM) without throwing', () => {
    startWatcher()
    const eperm = Object.assign(new Error('EPERM: operation not permitted, stat'), {
      code: 'EPERM',
      syscall: 'stat',
    })
    expect(() => handlers.error(eperm)).not.toThrow()
  })

  it('ignores the transient plugins directory so its temp_git_* churn never gets stat-ed', () => {
    startWatcher()
    const opts = chokidar.watch.mock.calls[0][1]
    expect(opts.ignored).toContain(path.join(CLAUDE_DIR, 'plugins'))
  })

  // ── ADR-0008: SQLite session-index invalidation ────────────────────────────
  // The watcher is the cache invalidator: it knows exactly which session file
  // changed, so it upserts/removes that ONE row before emitting the SSE event
  // (the emit triggers a client refetch — the index must already be fresh).

  it('upserts the session index BEFORE emitting session_update on change', () => {
    const calls = []
    upsertSession.mockImplementation(() => calls.push('upsert'))
    emit.mockImplementation(() => calls.push('emit'))
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'sess-idx.jsonl')
    handlers.change(filePath)
    expect(upsertSession).toHaveBeenCalledWith(filePath)
    expect(calls.indexOf('upsert')).toBeLessThan(calls.indexOf('emit'))
  })

  it('upserts the session index on add for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'sess-new.jsonl')
    handlers.add(filePath)
    expect(upsertSession).toHaveBeenCalledWith(filePath)
  })

  it('does not touch the index for non-session paths', () => {
    startWatcher()
    handlers.change(path.join(CLAUDE_DIR, 'tasks', 'task1.json'))
    handlers.add(path.join(CLAUDE_DIR, 'projects', 'proj', 'readme.txt'))
    expect(upsertSession).not.toHaveBeenCalled()
    expect(removeSession).not.toHaveBeenCalled()
  })

  // The previously-missing unlink handling: deleting a session JSONL must
  // remove the index row AND tell clients to refetch.
  it('removes the session from the index and emits session_update on unlink', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'sess-del.jsonl')
    handlers.unlink(filePath)
    expect(removeSession).toHaveBeenCalledWith('sess-del')
    expect(emit).toHaveBeenCalledWith('session_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
      reason: 'removed',
    })
  })

  it('does not remove sessions for non-.jsonl unlinks', () => {
    startWatcher()
    handlers.unlink(path.join(CLAUDE_DIR, 'projects', 'proj', 'notes.txt'))
    expect(removeSession).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })

  // ── Phantom-session guard ──────────────────────────────────────────────────
  // Subagent transcripts live NESTED at projects/<proj>/<sessionId>/subagents/
  // agent-*.jsonl. They parse as plausible sessions (type user/assistant), so
  // a startsWith('projects') + endsWith('.jsonl') guard would index them as
  // top-level sessions ('agent-...' phantoms in TriageView). Only DIRECT
  // children of a project dir are sessions.

  const SUBAGENT_PATH = path.join(
    CLAUDE_DIR,
    'projects',
    'proj',
    'sess-parent',
    'subagents',
    'agent-a2303837c0b84f287.jsonl',
  )

  it('does not index or emit session events for nested subagent transcripts on change', () => {
    startWatcher()
    handlers.change(SUBAGENT_PATH)
    expect(upsertSession).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalledWith('session_update', expect.anything())
    expect(onSessionEvent).not.toHaveBeenCalled()
  })

  it('does not index or emit new_session for nested subagent transcripts on add', () => {
    startWatcher()
    handlers.add(SUBAGENT_PATH)
    expect(upsertSession).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalledWith('new_session', expect.anything())
    expect(onSessionEvent).not.toHaveBeenCalled()
  })

  it('does not remove from the index for nested subagent transcript unlinks', () => {
    startWatcher()
    handlers.unlink(SUBAGENT_PATH)
    expect(removeSession).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalledWith('session_update', expect.anything())
  })

  it('treats any nested .jsonl under projects as a non-session (depth check, not name check)', () => {
    startWatcher()
    const nested = path.join(CLAUDE_DIR, 'projects', 'proj', 'extra-dir', 'deep.jsonl')
    handlers.change(nested)
    handlers.add(nested)
    handlers.unlink(nested)
    expect(upsertSession).not.toHaveBeenCalled()
    expect(removeSession).not.toHaveBeenCalled()
    expect(onSessionEvent).not.toHaveBeenCalled()
  })

  it('still indexes direct-child session transcripts (depth check does not over-restrict)', () => {
    startWatcher()
    const direct = path.join(CLAUDE_DIR, 'projects', 'proj', 'real-session.jsonl')
    handlers.change(direct)
    expect(upsertSession).toHaveBeenCalledWith(direct)
    expect(emit).toHaveBeenCalledWith('session_update', {
      filePath: path.relative(CLAUDE_DIR, direct),
      ts: expect.any(Number),
    })
  })

  // ── Phase 6: memory docs feed the knowledge index ──────────────────────────
  // projects/<proj>/memory/*.md changes already emitted memory_update; now they
  // also index/remove the doc BEFORE the emit (same fresh-before-refetch
  // ordering as sessions), and add/unlink emit memory_update too.
  describe('memory doc indexing', () => {
    const MEMORY_FILE = path.join(CLAUDE_DIR, 'projects', 'proj', 'memory', 'gotchas.md')

    it('indexes the memory doc BEFORE emitting memory_update on change', () => {
      const calls = []
      indexMemoryFile.mockImplementation(() => calls.push('index'))
      emit.mockImplementation(() => calls.push('emit'))
      startWatcher()
      handlers.change(MEMORY_FILE)
      expect(indexMemoryFile).toHaveBeenCalledWith(MEMORY_FILE)
      expect(emit).toHaveBeenCalledWith('memory_update', {
        filePath: path.relative(CLAUDE_DIR, MEMORY_FILE),
        ts: expect.any(Number),
      })
      expect(calls.indexOf('index')).toBeLessThan(calls.indexOf('emit'))
    })

    it('indexes and emits memory_update on add', () => {
      startWatcher()
      handlers.add(MEMORY_FILE)
      expect(indexMemoryFile).toHaveBeenCalledWith(MEMORY_FILE)
      expect(emit).toHaveBeenCalledWith('memory_update', {
        filePath: path.relative(CLAUDE_DIR, MEMORY_FILE),
        ts: expect.any(Number),
      })
    })

    it('removes from the index and emits memory_update on unlink', () => {
      startWatcher()
      handlers.unlink(MEMORY_FILE)
      expect(removeMemoryFile).toHaveBeenCalledWith(MEMORY_FILE)
      expect(emit).toHaveBeenCalledWith('memory_update', {
        filePath: path.relative(CLAUDE_DIR, MEMORY_FILE),
        ts: expect.any(Number),
      })
    })

    it('does not index non-markdown or non-memory project files', () => {
      startWatcher()
      handlers.change(path.join(CLAUDE_DIR, 'projects', 'proj', 'memory', 'scratch.txt'))
      handlers.add(path.join(CLAUDE_DIR, 'projects', 'proj', 'README.md'))
      handlers.unlink(path.join(CLAUDE_DIR, 'projects', 'proj', 'README.md'))
      expect(indexMemoryFile).not.toHaveBeenCalled()
      expect(removeMemoryFile).not.toHaveBeenCalled()
    })
  })

  // Phase 4 (AFK gate notifier): a file appearing/changing under
  // <project>/.harness/approvals/pending/ is an approval-gate transition. The
  // watcher emits a DISTINCT harness_approval_pending event (in addition to the
  // existing harness_update refetch signal) so the notifier can react without
  // false-positives from unrelated .harness writes.
  describe('harness approval-pending events', () => {
    const PROJECT = path.join('C:', 'work', 'proj')
    const PENDING_FILE = path.join(PROJECT, '.harness', 'approvals', 'pending', 'req-1.json')

    it('emits harness_approval_pending AND harness_update on add of a pending approval file', () => {
      startWatcher()
      handlers.add(PENDING_FILE)
      expect(emit).toHaveBeenCalledWith('harness_update', {
        projectPath: PROJECT,
        ts: expect.any(Number),
      })
      expect(emit).toHaveBeenCalledWith('harness_approval_pending', {
        projectPath: PROJECT,
        filePath: path.join('approvals', 'pending', 'req-1.json'),
        ts: expect.any(Number),
      })
    })

    it('emits harness_approval_pending on change of a pending approval file', () => {
      startWatcher()
      handlers.change(PENDING_FILE)
      expect(emit).toHaveBeenCalledWith('harness_approval_pending', {
        projectPath: PROJECT,
        filePath: path.join('approvals', 'pending', 'req-1.json'),
        ts: expect.any(Number),
      })
    })

    it('does NOT emit harness_approval_pending on unlink (resolved/decided, not pending)', () => {
      startWatcher()
      handlers.unlink(PENDING_FILE)
      expect(emit).toHaveBeenCalledWith('harness_update', {
        projectPath: PROJECT,
        ts: expect.any(Number),
      })
      expect(emit).not.toHaveBeenCalledWith('harness_approval_pending', expect.anything())
    })

    it('does NOT emit harness_approval_pending for unrelated .harness writes', () => {
      startWatcher()
      handlers.change(path.join(PROJECT, '.harness', 'status.json'))
      handlers.change(path.join(PROJECT, '.harness', 'approvals', 'decided', 'req-1.json'))
      expect(emit).toHaveBeenCalledWith('harness_update', expect.anything())
      expect(emit).not.toHaveBeenCalledWith('harness_approval_pending', expect.anything())
    })
  })
})
