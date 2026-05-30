import { projectLabel } from '../../utils/session.js'

describe('projectLabel()', () => {
  it('returns the basename of cwd when cwd is a Unix path', () => {
    const session = { sessionId: 'abcdef1234567890', cwd: '/home/user/my-project' }
    expect(projectLabel(session)).toBe('my-project')
  })

  it('returns the basename of cwd when cwd is a Windows path', () => {
    const session = {
      sessionId: 'abcdef1234567890',
      cwd: 'C:\\Users\\Travis\\Desktop\\Projects\\behind-the-agent-curtain',
    }
    expect(projectLabel(session)).toBe('behind-the-agent-curtain')
  })

  it('strips a trailing path separator before taking the basename', () => {
    const session = { sessionId: 'abcdef1234567890', cwd: '/home/user/my-project/' }
    expect(projectLabel(session)).toBe('my-project')
  })

  it('returns a stable session-id-derived placeholder when cwd is null', () => {
    // AC#2: projectLabel() must return a stable string when cwd is missing.
    // The implementation may choose any deterministic placeholder derived
    // from sessionId — we only assert it is a non-empty string and is
    // stable across calls for the same session.
    const session = { sessionId: 'abcdef1234567890', cwd: null }
    const first = projectLabel(session)
    const second = projectLabel(session)
    expect(typeof first).toBe('string')
    expect(first.length).toBeGreaterThan(0)
    expect(first).toBe(second)
  })

  it('returns a stable session-id-derived placeholder when cwd is undefined', () => {
    const session = { sessionId: 'abcdef1234567890' }
    const label = projectLabel(session)
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThan(0)
  })

  it('returns a stable session-id-derived placeholder when cwd is an empty string', () => {
    const session = { sessionId: 'abcdef1234567890', cwd: '' }
    const label = projectLabel(session)
    expect(typeof label).toBe('string')
    expect(label.length).toBeGreaterThan(0)
  })

  it('produces different placeholders for different session ids', () => {
    // The placeholder is "session-id-derived" — sessions with distinct
    // ids should yield distinct labels so the UI can tell them apart.
    const a = projectLabel({ sessionId: 'aaaaaaaa11111111', cwd: null })
    const b = projectLabel({ sessionId: 'bbbbbbbb22222222', cwd: null })
    expect(a).not.toBe(b)
  })

  it('does not throw on a session with no cwd', () => {
    expect(() => projectLabel({ sessionId: 'abcdef1234567890' })).not.toThrow()
    expect(() => projectLabel({ sessionId: 'abcdef1234567890', cwd: null })).not.toThrow()
    expect(() => projectLabel({ sessionId: 'abcdef1234567890', cwd: undefined })).not.toThrow()
  })

  it('ignores any legacy projectName field (no longer consulted)', () => {
    // AC#2: projectLabel must reference no projectName field. Even if a
    // stale session object still has one, cwd should win, and when cwd is
    // missing the placeholder must be derived from sessionId — not from
    // projectName.
    const withCwd = {
      sessionId: 'abcdef1234567890',
      cwd: '/home/user/real-project',
      projectName: 'stale-project-name',
    }
    expect(projectLabel(withCwd)).toBe('real-project')

    const withoutCwd = {
      sessionId: 'abcdef1234567890',
      cwd: null,
      projectName: 'stale-project-name',
    }
    expect(projectLabel(withoutCwd)).not.toBe('stale-project-name')
  })
})
