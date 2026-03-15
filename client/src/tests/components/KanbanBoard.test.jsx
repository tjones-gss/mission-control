import { render, screen, fireEvent } from '@testing-library/react'
import { KanbanBoard } from '../../components/KanbanBoard.jsx'

const NOW = Date.now()

function makeSession(overrides = {}) {
  return {
    sessionId: 'sess-1',
    cwd: '/home/user/myproject',
    isActive: false,
    needsInput: false,
    lastModified: NOW - 10_000,
    lastText: 'Hello world',
    model: 'claude-3-5-sonnet',
    toolUseCounts: {},
    agents: [],
    ...overrides,
  }
}

describe('KanbanBoard — column grouping', () => {
  it('renders three columns: Active, Idle, Done', () => {
    render(<KanbanBoard sessions={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Idle')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('places active sessions in the Active column', () => {
    const sessions = [
      makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000, lastText: 'Active task' }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Active task')).toBeInTheDocument()
  })

  it('places recent inactive sessions in the Idle column', () => {
    const sessions = [
      makeSession({ sessionId: 'i1', isActive: false, lastModified: NOW - 30 * 60_000, lastText: 'Idle task' }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Idle task')).toBeInTheDocument()
  })

  it('places old sessions in the Done column', () => {
    const sessions = [
      makeSession({ sessionId: 'd1', isActive: false, lastModified: NOW - 2 * 3_600_000, lastText: 'Done task' }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Done task')).toBeInTheDocument()
  })

  it('shows empty labels when columns have no sessions', () => {
    render(<KanbanBoard sessions={[]} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('No active sessions')).toBeInTheDocument()
    expect(screen.getByText('No idle sessions')).toBeInTheDocument()
    expect(screen.getByText('No completed sessions')).toBeInTheDocument()
  })
})

describe('KanbanBoard — interactions', () => {
  it('calls onSelect when a session card is clicked', () => {
    const onSelect = vi.fn()
    const sessions = [
      makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000 }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('myproject'))
    expect(onSelect).toHaveBeenCalledWith('a1')
  })
})

describe('KanbanBoard — needsInput indicator', () => {
  it('does not show amber indicator for active sessions even with needsInput', () => {
    const sessions = [
      makeSession({ sessionId: 'a1', isActive: true, needsInput: true, lastModified: NOW - 1000, lastText: 'Active waiting' }),
    ]
    const { container } = render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    // Should have green indicator (active) but not amber
    const amberPings = container.querySelectorAll('.bg-amber-400')
    expect(amberPings).toHaveLength(0)
  })

  it('shows amber indicator for non-active sessions with needsInput', () => {
    const sessions = [
      makeSession({ sessionId: 'i1', isActive: false, needsInput: true, lastModified: NOW - 30 * 60_000 }),
    ]
    const { container } = render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    const amberPings = container.querySelectorAll('.bg-amber-400')
    expect(amberPings.length).toBeGreaterThan(0)
  })

  it('does not show amber indicator when needsInput is false', () => {
    const sessions = [
      makeSession({ sessionId: 'i1', isActive: false, needsInput: false, lastModified: NOW - 30 * 60_000 }),
    ]
    const { container } = render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    const amberPings = container.querySelectorAll('.bg-amber-400')
    expect(amberPings).toHaveLength(0)
  })
})

describe('KanbanBoard — session card details', () => {
  it('shows project slug from cwd', () => {
    const sessions = [
      makeSession({ sessionId: 'a1', cwd: '/home/user/my-app', isActive: true, lastModified: NOW - 1000 }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('my-app')).toBeInTheDocument()
  })

  it('shows model abbreviation', () => {
    const sessions = [
      makeSession({ sessionId: 'a1', isActive: true, lastModified: NOW - 1000, model: 'claude-3-5-sonnet' }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('5-sonnet')).toBeInTheDocument()
  })

  it('shows tool usage pills', () => {
    const sessions = [
      makeSession({
        sessionId: 'a1',
        isActive: true,
        lastModified: NOW - 1000,
        toolUseCounts: { Bash: 5, Read: 3 },
      }),
    ]
    render(<KanbanBoard sessions={sessions} selectedId={null} onSelect={vi.fn()} />)
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('Read')).toBeInTheDocument()
  })
})
