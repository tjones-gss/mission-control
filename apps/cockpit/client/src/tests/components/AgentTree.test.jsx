import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'

vi.mock('../../components/ConversationView.jsx', () => ({
  ConversationView: () => <div data-testid="conversation-view" />,
}))
vi.mock('../../components/TimelineView.jsx', () => ({
  TimelineView: () => <div data-testid="timeline-view" />,
}))
vi.mock('../../components/IntelView.jsx', () => ({
  IntelView: () => <div data-testid="intel-view" />,
}))
vi.mock('../../components/SessionControlBar.jsx', () => ({
  SessionControlBar: () => <div data-testid="session-control-bar" />,
}))
vi.mock('../../components/InspectPanel/InspectPanel.jsx', () => ({
  InspectPanel: ({ sessionId, configVersion, memoryVersion, hooksVersion }) => (
    <div
      data-testid="inspect-panel"
      data-session={sessionId}
      data-config-version={configVersion}
      data-memory-version={memoryVersion}
      data-hooks-version={hooksVersion}
    />
  ),
}))

import { AgentTree } from '../../components/AgentTree.jsx'

const SESSION = {
  sessionId: 'abc123def456',
  slug: 'my-project',
  cwd: '/home/user/project',
  model: 'claude-sonnet-4-20250514',
  gitBranch: 'main',
  isActive: true,
  lastThought: 'Thinking about the implementation...',
  lastText: 'Here is the code',
  lastAction: { name: 'Edit', summary: 'file.js:10' },
  toolUseCounts: { Bash: 5, Read: 3, Edit: 2 },
  agentTree: {
    mainMessageCount: 10,
    subagents: [
      {
        toolUseId: 'sub1',
        description: 'Research agent',
        messageCount: 5,
        startTime: '2025-01-01T00:00:00Z',
        endTime: '2025-01-01T00:05:00Z',
        model: 'claude-haiku-4-5-20251001',
      },
    ],
  },
}

describe('AgentTree', () => {
  it('shows "Select a session to inspect" when no session', () => {
    render(<AgentTree session={null} />)
    expect(screen.getByText('Select a session to inspect')).toBeInTheDocument()
  })

  it('renders 4 tab buttons (conversation, timeline, summary, intel)', () => {
    render(<AgentTree session={SESSION} />)
    expect(screen.getByText('conversation')).toBeInTheDocument()
    expect(screen.getByText('timeline')).toBeInTheDocument()
    expect(screen.getByText('summary')).toBeInTheDocument()
    expect(screen.getByText('intel')).toBeInTheDocument()
  })

  it('shows conversation view by default', () => {
    render(<AgentTree session={SESSION} />)
    expect(screen.getByTestId('conversation-view')).toBeInTheDocument()
  })

  it('clicking timeline tab shows timeline view', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('timeline'))
    expect(screen.getByTestId('timeline-view')).toBeInTheDocument()
  })

  it('clicking intel tab shows intel view', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('intel'))
    expect(screen.getByTestId('intel-view')).toBeInTheDocument()
  })

  it('clicking inspect tab shows the InspectPanel with versions threaded through', async () => {
    render(
      <AgentTree session={SESSION} configVersion={2} memoryVersion={3} hooksVersion={4} />,
    )
    await userEvent.click(screen.getByText('inspect'))
    const panel = screen.getByTestId('inspect-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-session', SESSION.sessionId)
    expect(panel).toHaveAttribute('data-config-version', '2')
    expect(panel).toHaveAttribute('data-memory-version', '3')
    expect(panel).toHaveAttribute('data-hooks-version', '4')
  })

  it('summary tab shows slug', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('my-project')).toBeInTheDocument()
  })

  it('summary tab shows git branch', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('summary tab shows cwd', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('/home/user/project')).toBeInTheDocument()
  })

  it('summary tab shows THINK section with lastThought', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('THINK')).toBeInTheDocument()
    expect(screen.getByText('Thinking about the implementation...')).toBeInTheDocument()
  })

  it('summary tab shows OUT section with lastText', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('OUT')).toBeInTheDocument()
    expect(screen.getByText('Here is the code')).toBeInTheDocument()
  })

  it('summary tab shows ACT section with lastAction', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('ACT')).toBeInTheDocument()
    // "Edit" appears both as a tab-area tool pill and in the ACT section; just check the action summary
    expect(screen.getByText('file.js:10')).toBeInTheDocument()
  })

  it('summary tab shows tool pills sorted by count', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('TOOLS')).toBeInTheDocument()
    // Sorted by count descending: Bash(5), Read(3), Edit(2)
    const pills = screen.getAllByText(/×\d+/)
    expect(pills[0]).toHaveTextContent('×5')
    expect(pills[1]).toHaveTextContent('×3')
    expect(pills[2]).toHaveTextContent('×2')
  })

  it('summary tab shows subagent list', async () => {
    render(<AgentTree session={SESSION} />)
    await userEvent.click(screen.getByText('summary'))
    expect(screen.getByText('SUBAGENTS (1)')).toBeInTheDocument()
    expect(screen.getByText('Agent 1')).toBeInTheDocument()
    expect(screen.getByText('Research agent')).toBeInTheDocument()
    expect(screen.getByText('5 msgs')).toBeInTheDocument()
  })
})
