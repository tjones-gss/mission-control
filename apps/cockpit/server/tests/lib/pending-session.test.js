// Unit tests for server/lib/pending-session.js
// The module imports from '../sse.js' and uses fs for the snapshot read.
// We mock both so tests are fully in-process with no real filesystem or SSE.

vi.mock('../../sse.js', () => {
  const listeners = []
  return {
    onEvent: vi.fn((cb) => {
      listeners.push(cb)
      return () => {
        const i = listeners.indexOf(cb)
        if (i >= 0) listeners.splice(i, 1)
      }
    }),
    // Helper exposed on the mock so tests can fire fake events
    _fireEvent: (event, data) => {
      for (const cb of [...listeners]) cb(event, data)
    },
    _listenerCount: () => listeners.length,
  }
})

vi.mock('fs', () => ({
  default: {
    readdirSync: vi.fn(() => []),
  },
  readdirSync: vi.fn(() => []),
}))

vi.mock('../../lib/logger.js', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

import fs from 'fs'
import { logger } from '../../lib/logger.js'
import { onEvent, _fireEvent, _listenerCount } from '../../sse.js'
import {
  awaitNewSession,
  encodeProjectDir,
  _existingSessionIdsInCwd,
} from '../../lib/pending-session.js'

// Reset between tests
beforeEach(() => {
  vi.resetAllMocks()
  // Default: no existing sessions on disk
  fs.readdirSync.mockReturnValue([])
  // Default: logger.warn is a no-op mock
  logger.warn.mockReset?.()
})

// ─── encodeProjectDir ─────────────────────────────────────────────────────────

describe('encodeProjectDir', () => {
  it('encodes a POSIX path', () => {
    // Temporarily pretend we are on POSIX by calling the function's logic directly.
    // Because the module caches IS_WIN32 at import time, we test the real platform's path.
    // On win32 the test below covers Windows; on POSIX this covers POSIX.
    if (process.platform !== 'win32') {
      expect(encodeProjectDir('/Users/foo/bar')).toBe('-Users-foo-bar')
      expect(encodeProjectDir('/home/travis/projects/my-app')).toBe('-home-travis-projects-my-app')
    }
  })

  it('encodes a Windows path on win32', () => {
    if (process.platform === 'win32') {
      expect(encodeProjectDir('C:\\Users\\Travis\\Desktop\\Projects\\foo')).toBe(
        'C--Users-Travis-Desktop-Projects-foo',
      )
      expect(encodeProjectDir('D:\\work\\repo')).toBe('D--work-repo')
    }
  })
})

// ─── _existingSessionIdsInCwd — error handling ───────────────────────────────

describe('_existingSessionIdsInCwd error handling', () => {
  it('returns empty set silently when PROJECTS_DIR does not exist (ENOENT)', () => {
    const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    fs.readdirSync.mockImplementation(() => {
      throw enoent
    })
    const result = _existingSessionIdsInCwd('/some/cwd')
    expect(result.size).toBe(0)
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('warns via logger.warn when PROJECTS_DIR read fails with non-ENOENT error', () => {
    const eacces = Object.assign(new Error('EACCES'), { code: 'EACCES' })
    fs.readdirSync.mockImplementation(() => {
      throw eacces
    })
    const result = _existingSessionIdsInCwd('/some/cwd')
    expect(result.size).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ err: eacces }),
      'pending_session_projects_read_failed',
    )
  })
})

// ─── awaitNewSession — resolves on matching new_session event ─────────────────

describe('awaitNewSession', () => {
  it('resolves with sessionId when a matching new_session event fires', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const encodedDir = encodeProjectDir(cwd)
    const newId = 'abc-session-001'

    const p = awaitNewSession(cwd, { timeoutMs: 2000 })

    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/${newId}.jsonl`,
      ts: Date.now(),
    })

    const result = await p
    expect(result).toBe(newId)
  })

  it('ignores new_session events for other cwds', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const otherDir = process.platform === 'win32' ? 'D--other-proj' : '-other-proj'
    const correctDir = encodeProjectDir(cwd)
    const newId = 'correct-session'

    const p = awaitNewSession(cwd, { timeoutMs: 200 })

    // Fire an event for the WRONG cwd first
    _fireEvent('new_session', {
      filePath: `projects/${otherDir}/wrong-session.jsonl`,
      ts: Date.now(),
    })

    // Fire event for the correct cwd shortly after
    await new Promise((r) => setTimeout(r, 10))
    _fireEvent('new_session', {
      filePath: `projects/${correctDir}/${newId}.jsonl`,
      ts: Date.now(),
    })

    const result = await p
    expect(result).toBe(newId)
  })

  it('ignores events whose sessionId was already present at subscribe time', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const encodedDir = encodeProjectDir(cwd)
    const existingId = 'pre-existing-session'
    const newId = 'brand-new-session'

    // Simulate the pre-existing session on disk when subscribe snapshot is taken
    // _existingSessionIdsInCwd reads fs.readdirSync twice: once for PROJECTS_DIR
    // (to find the encoded dir) and once for the encoded dir itself.
    fs.readdirSync.mockImplementation((dirPath) => {
      if (dirPath.endsWith('projects')) {
        // Return the encoded dir name
        return [{ name: encodedDir, isDirectory: () => true }]
      }
      // Inside the encoded dir, one pre-existing jsonl
      return [`${existingId}.jsonl`]
    })

    const p = awaitNewSession(cwd, { timeoutMs: 200 })

    // Fire event for the pre-existing session — must be ignored
    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/${existingId}.jsonl`,
      ts: Date.now(),
    })

    // Fire event for the genuinely new session
    await new Promise((r) => setTimeout(r, 10))
    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/${newId}.jsonl`,
      ts: Date.now(),
    })

    const result = await p
    expect(result).toBe(newId)
  })

  it('rejects with a timeout message after timeoutMs', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'

    await expect(awaitNewSession(cwd, { timeoutMs: 50 })).rejects.toThrow(
      'timeout_waiting_for_session',
    )
  })

  it('removes listener on resolve (no leak)', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const encodedDir = encodeProjectDir(cwd)

    const before = _listenerCount()
    const p = awaitNewSession(cwd, { timeoutMs: 2000 })
    expect(_listenerCount()).toBe(before + 1)

    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/new-sess-1.jsonl`,
      ts: Date.now(),
    })

    await p
    expect(_listenerCount()).toBe(before) // listener removed after resolve
  })

  it('removes listener on reject/timeout (no leak)', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'

    const before = _listenerCount()
    const p = awaitNewSession(cwd, { timeoutMs: 30 })
    expect(_listenerCount()).toBe(before + 1)

    await expect(p).rejects.toThrow()
    expect(_listenerCount()).toBe(before) // listener removed after reject
  })

  it('does not call resolved handler again on subsequent events (no double-resolve)', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const encodedDir = encodeProjectDir(cwd)
    let resolveCount = 0

    const p = awaitNewSession(cwd, { timeoutMs: 500 }).then((id) => {
      resolveCount++
      return id
    })

    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/sess-a.jsonl`,
      ts: Date.now(),
    })

    // Small pause, then fire another — should be ignored (listener removed)
    await new Promise((r) => setTimeout(r, 20))
    _fireEvent('new_session', {
      filePath: `projects/${encodedDir}/sess-b.jsonl`,
      ts: Date.now(),
    })

    await p
    expect(resolveCount).toBe(1)
  })

  it('case-insensitive cwd match on win32', async () => {
    if (process.platform !== 'win32') return // skip on POSIX

    const cwd = 'C:\\Users\\Travis\\Desktop\\Projects\\foo'
    const encodedDir = encodeProjectDir(cwd) // C--Users-Travis-Desktop-Projects-foo
    const newId = 'win-case-session'

    const p = awaitNewSession(cwd, { timeoutMs: 2000 })

    // Fire event with mixed-case encoded dir — should still match on win32
    _fireEvent('new_session', {
      filePath: `projects/${encodedDir.toUpperCase()}/${newId}.jsonl`,
      ts: Date.now(),
    })

    const result = await p
    expect(result).toBe(newId)
  })

  it('ignores non-new_session events', async () => {
    const cwd = process.platform === 'win32' ? 'C:\\Users\\test\\proj' : '/Users/test/proj'
    const encodedDir = encodeProjectDir(cwd)

    const p = awaitNewSession(cwd, { timeoutMs: 100 })

    // Fire irrelevant event types
    _fireEvent('session_update', { filePath: `projects/${encodedDir}/old.jsonl` })
    _fireEvent('config_update', { filePath: 'settings.json' })

    // Should time out because no new_session event was fired
    await expect(p).rejects.toThrow('timeout_waiting_for_session')
  })
})
