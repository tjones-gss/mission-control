import { describe, it, expect } from 'vitest'
import { getManagers } from '../../parsers/managers.js'

function mkSession(overrides = {}) {
  return {
    sessionId: 'sess-' + Math.random().toString(36).slice(2, 8),
    cwd: 'C:\\projects\\repo-a',
    isActive: false,
    needsInput: false,
    lastModified: Date.now() - 60_000,
    lastText: 'hello',
    model: 'claude-sonnet-4-6',
    permissionMode: 'default',
    estimatedCost: { totalCost: 1.23 },
    ...overrides,
  }
}

describe('getManagers', () => {
  it('returns no managers when given an empty list', () => {
    const result = getManagers([])
    expect(result.managers).toEqual([])
    expect(result.standalone).toEqual([])
  })

  it('groups sessions sharing a direct parent into a manager', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: 'C:\\projects\\repo-a' }),
      mkSession({ sessionId: 'b', cwd: 'C:\\projects\\repo-b' }),
      mkSession({ sessionId: 'c', cwd: 'C:\\projects\\repo-c' }),
    ]
    const { managers, standalone } = getManagers(sessions)
    expect(managers).toHaveLength(1)
    expect(managers[0].childCount).toBe(3)
    expect(managers[0].slug).toBe('projects')
    expect(standalone).toEqual([])
  })

  it('puts solo sessions into the standalone bucket', () => {
    const sessions = [mkSession({ sessionId: 'lonely', cwd: 'C:\\sandbox\\one-off' })]
    const { managers, standalone } = getManagers(sessions)
    expect(managers).toHaveLength(0)
    expect(standalone).toHaveLength(1)
    expect(standalone[0].sessionId).toBe('lonely')
  })

  it('produces multiple manager groups when sessions are in different parents', () => {
    const sessions = [
      mkSession({ sessionId: 'p1', cwd: 'C:\\projects\\repo-a' }),
      mkSession({ sessionId: 'p2', cwd: 'C:\\projects\\repo-b' }),
      mkSession({ sessionId: 'w1', cwd: 'C:\\work\\client-x' }),
      mkSession({ sessionId: 'w2', cwd: 'C:\\work\\client-y' }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers).toHaveLength(2)
    const slugs = managers.map((m) => m.slug).sort()
    expect(slugs).toEqual(['projects', 'work'])
  })

  it('normalizes Windows path separators and drive case', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: 'C:\\Projects\\repo-a' }),
      mkSession({ sessionId: 'b', cwd: 'c:/Projects/repo-b' }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers).toHaveLength(1)
    expect(managers[0].dir.toLowerCase()).toContain('projects')
  })

  it('handles POSIX paths', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: '/home/me/projects/repo-a' }),
      mkSession({ sessionId: 'b', cwd: '/home/me/projects/repo-b' }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers).toHaveLength(1)
    expect(managers[0].slug).toBe('projects')
  })

  it('aggregates active/idle/done counts and total cost', () => {
    const now = Date.now()
    const sessions = [
      mkSession({
        sessionId: 'a',
        cwd: 'C:\\projects\\repo-a',
        isActive: true,
        lastModified: now,
        estimatedCost: { totalCost: 10 },
      }),
      mkSession({
        sessionId: 'b',
        cwd: 'C:\\projects\\repo-b',
        isActive: false,
        lastModified: now - 30 * 60 * 1000, // 30 min ago = idle
        estimatedCost: { totalCost: 5 },
      }),
      mkSession({
        sessionId: 'c',
        cwd: 'C:\\projects\\repo-c',
        isActive: false,
        lastModified: now - 4 * 60 * 60 * 1000, // 4h ago = done
        estimatedCost: { totalCost: 2 },
      }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers).toHaveLength(1)
    const m = managers[0]
    expect(m.activeCount).toBe(1)
    expect(m.idleCount).toBe(1)
    expect(m.doneCount).toBe(1)
    expect(m.totalCost).toBeCloseTo(17, 5)
  })

  it('counts sessions waiting for input', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: 'C:\\projects\\repo-a', needsInput: true }),
      mkSession({ sessionId: 'b', cwd: 'C:\\projects\\repo-b' }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers[0].needsInputCount).toBe(1)
  })

  it('skips sessions with no cwd', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: null }),
      mkSession({ sessionId: 'b', cwd: 'C:\\projects\\repo-a' }),
      mkSession({ sessionId: 'c', cwd: 'C:\\projects\\repo-b' }),
    ]
    const { managers, standalone } = getManagers(sessions)
    expect(managers).toHaveLength(1)
    expect(managers[0].childCount).toBe(2)
    // The cwd-less session is silently dropped (it has no parent dir to group by)
    expect(standalone).toHaveLength(0)
  })

  it('sorts managers by most-recent activity', () => {
    const now = Date.now()
    const sessions = [
      mkSession({ sessionId: 'old1', cwd: 'C:\\old\\a', lastModified: now - 1_000_000 }),
      mkSession({ sessionId: 'old2', cwd: 'C:\\old\\b', lastModified: now - 1_000_000 }),
      mkSession({ sessionId: 'new1', cwd: 'C:\\new\\a', lastModified: now - 10 }),
      mkSession({ sessionId: 'new2', cwd: 'C:\\new\\b', lastModified: now - 10 }),
    ]
    const { managers } = getManagers(sessions)
    expect(managers).toHaveLength(2)
    expect(managers[0].slug).toBe('new')
    expect(managers[1].slug).toBe('old')
  })

  it('child rows expose the slug for each session', () => {
    const sessions = [
      mkSession({ sessionId: 'a', cwd: 'C:\\projects\\oversight' }),
      mkSession({ sessionId: 'b', cwd: 'C:\\projects\\inspector-app' }),
    ]
    const { managers } = getManagers(sessions)
    const slugs = managers[0].children.map((c) => c.slug).sort()
    expect(slugs).toEqual(['inspector-app', 'oversight'])
  })
})
