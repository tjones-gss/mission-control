import { render, screen, fireEvent } from '@testing-library/react'
import { SessionsList } from '../../components/SessionsList.jsx'

const NOW = Date.now()

function makeSession(overrides = {}) {
  return {
    sessionId: 'sess-1',
    cwd: '/home/user/myproject',
    slug: 'myproject',
    isActive: false,
    needsInput: false,
    lastModified: NOW - 10_000,
    lastText: 'Hello world',
    model: 'claude-3-5-sonnet',
    tokenUsage: { input: 100, output: 50 },
    agentTree: { subagents: [] },
    ...overrides,
  }
}

describe('SessionsList — loading state', () => {
  it('shows loading when sessions is null', () => {
    render(<SessionsList sessions={null} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})

describe('SessionsList — grouping', () => {
  it('groups sessions into Active, Recent, and Older sections', () => {
    const sessions = [
      makeSession({ sessionId: 'active-1', isActive: true, lastModified: NOW - 1000 }),
      makeSession({ sessionId: 'recent-1', isActive: false, lastModified: NOW - 30 * 60_000 }),
      makeSession({ sessionId: 'older-1', isActive: false, lastModified: NOW - 2 * 3_600_000 }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Recent')).toBeInTheDocument()
    expect(screen.getByText('Older')).toBeInTheDocument()
  })

  it('hides empty groups', () => {
    const sessions = [
      makeSession({ sessionId: 'active-1', isActive: true, lastModified: NOW - 1000 }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Recent')).not.toBeInTheDocument()
    expect(screen.queryByText('Older')).not.toBeInTheDocument()
  })

  it('shows correct count next to each group header', () => {
    const sessions = [
      makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000 }),
      makeSession({ sessionId: 'a2', isActive: true, lastModified: NOW - 2000 }),
      makeSession({ sessionId: 'r1', isActive: false, lastModified: NOW - 30 * 60_000 }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    // The count "2" for Active group
    expect(screen.getByText('2')).toBeInTheDocument()
    // The count "1" for Recent group
    expect(screen.getByText('1')).toBeInTheDocument()
  })
})

describe('SessionsList — collapse behavior', () => {
  it('collapses Older group by default', () => {
    const sessions = [
      makeSession({
        sessionId: 'old-1',
        cwd: '/home/user/oldproj',
        isActive: false,
        lastModified: NOW - 2 * 3_600_000,
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    // The Older header should exist but the session card should not be rendered
    expect(screen.getByText('Older')).toBeInTheDocument()
    expect(screen.queryByText('Hello world')).not.toBeInTheDocument()
  })

  it('expands Older group when header is clicked', () => {
    const sessions = [
      makeSession({
        sessionId: 'old-1',
        cwd: '/home/user/oldproj',
        isActive: false,
        lastModified: NOW - 2 * 3_600_000,
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    fireEvent.click(screen.getByText('Older'))
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('Active and Recent groups are expanded by default', () => {
    const sessions = [
      makeSession({
        sessionId: 'a1',
        isActive: true,
        lastModified: NOW - 1000,
        lastText: 'Active text',
      }),
      makeSession({
        sessionId: 'r1',
        isActive: false,
        lastModified: NOW - 30 * 60_000,
        lastText: 'Recent text',
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Active text')).toBeInTheDocument()
    expect(screen.getByText('Recent text')).toBeInTheDocument()
  })

  it('collapses a group when its header is clicked twice', () => {
    const sessions = [
      makeSession({
        sessionId: 'r1',
        isActive: false,
        lastModified: NOW - 30 * 60_000,
        lastText: 'Recent text',
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Recent text')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Recent'))
    expect(screen.queryByText('Recent text')).not.toBeInTheDocument()
  })
})

describe('SessionsList — selection', () => {
  it('calls onSelect when a session card is clicked', () => {
    const onSelect = vi.fn()
    const sessions = [makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000 })]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('myproject'))
    expect(onSelect).toHaveBeenCalledWith('a1')
  })
})

describe('SessionsList — needsInput indicator', () => {
  it('shows "Waiting" label on sessions with needsInput=true', () => {
    const sessions = [
      makeSession({
        sessionId: 'w1',
        isActive: false,
        needsInput: true,
        lastModified: NOW - 30 * 60_000,
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Waiting')).toBeInTheDocument()
  })

  it('does not show "Waiting" label when needsInput=false', () => {
    const sessions = [makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000 })]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.queryByText('Waiting')).not.toBeInTheDocument()
  })
})

describe('SessionsList — mute button', () => {
  it('shows dismiss button on needsInput sessions when onMuteSession is provided', () => {
    const sessions = [
      makeSession({
        sessionId: 'w1',
        isActive: false,
        needsInput: true,
        lastModified: NOW - 30 * 60_000,
      }),
    ]
    render(
      <SessionsList
        sessions={sessions}
        selectedId={null}
        onSelect={vi.fn()}
        onMuteSession={vi.fn()}
      />,
    )
    expect(screen.getByTitle('Dismiss notification')).toBeInTheDocument()
  })

  it('calls onMuteSession with session ID when dismiss is clicked', () => {
    const onMute = vi.fn()
    const sessions = [
      makeSession({
        sessionId: 'w1',
        isActive: false,
        needsInput: true,
        lastModified: NOW - 30 * 60_000,
      }),
    ]
    render(
      <SessionsList
        sessions={sessions}
        selectedId={null}
        onSelect={vi.fn()}
        onMuteSession={onMute}
      />,
    )
    fireEvent.click(screen.getByTitle('Dismiss notification'))
    expect(onMute).toHaveBeenCalledWith('w1')
  })

  it('does not show dismiss when onMuteSession is not provided', () => {
    const sessions = [
      makeSession({
        sessionId: 'w1',
        isActive: false,
        needsInput: true,
        lastModified: NOW - 30 * 60_000,
      }),
    ]
    render(<SessionsList sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.queryByTitle('Dismiss notification')).not.toBeInTheDocument()
  })
})
