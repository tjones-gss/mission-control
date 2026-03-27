import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { TeamsPanel } from '../../components/TeamsPanel/TeamsPanel.jsx'

const user = () => userEvent.setup({ writeToClipboard: false })

const SAMPLE_TEAMS = [
  {
    name: 'alpha-team',
    description: 'First team',
    members: [{ agentId: 'a1', name: 'worker-1', agentType: 'general', model: 'claude-sonnet-4-6' }],
    createdAt: Date.now() - 86400000,
    inboxes: {
      agent1: [
        { id: 'msg-1', sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString(), read: false, archived: false },
      ],
      dashboard: [],
    },
  },
  {
    name: 'beta-team',
    description: '',
    members: [],
    createdAt: Date.now(),
    inboxes: {},
  },
]

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('TeamsPanel — empty state', () => {
  it('shows empty state when no teams', () => {
    render(<TeamsPanel teams={[]} />)
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument()
  })

  it('shows empty state when teams is null', () => {
    render(<TeamsPanel teams={null} />)
    expect(screen.getByText(/no teams configured/i)).toBeInTheDocument()
  })
})

// ─── Team list ────────────────────────────────────────────────────────────────

describe('TeamsPanel — team list', () => {
  it('renders team names in the list', () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    expect(screen.getByText('alpha-team')).toBeInTheDocument()
    expect(screen.getByText('beta-team')).toBeInTheDocument()
  })

  it('shows unread badge when team has unread messages', () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    // alpha-team has 1 unread (msg-1 has read: false, not archived)
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('clicking a team shows the team config card', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByText('First team')).toBeInTheDocument()
    expect(screen.getByText('worker-1')).toBeInTheDocument()
  })
})

// ─── Inbox feed ───────────────────────────────────────────────────────────────

describe('TeamsPanel — inbox feed', () => {
  it('shows inbox messages after selecting a team', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByText('Hello from agent')).toBeInTheDocument()
  })

  it('shows empty inbox message when team has no messages', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('beta-team'))
    expect(screen.getByText(/no messages/i)).toBeInTheDocument()
  })
})

// ─── Mark as read ─────────────────────────────────────────────────────────────

describe('TeamsPanel — mark as read', () => {
  it('calls PATCH endpoint when mark-read button is clicked', async () => {
    let patchCalled = false
    server.use(
      http.patch('/api/teams/:name/inbox/:messageId', () => {
        patchCalled = true
        return HttpResponse.json({ id: 'msg-1', read: true, archived: false, sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString() })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const markReadBtn = screen.getByTitle(/mark as read/i)
    await userEvent.click(markReadBtn)
    await waitFor(() => expect(patchCalled).toBe(true))
  })
})

// ─── Archive ──────────────────────────────────────────────────────────────────

describe('TeamsPanel — archive', () => {
  it('calls PATCH endpoint when archive button is clicked', async () => {
    let archiveCalled = false
    server.use(
      http.patch('/api/teams/:name/inbox/:messageId', () => {
        archiveCalled = true
        return HttpResponse.json({ id: 'msg-1', read: false, archived: true, sender: 'agent1', content: 'Hello from agent', timestamp: new Date().toISOString() })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const archiveBtn = screen.getByTitle(/archive/i)
    await userEvent.click(archiveBtn)
    await waitFor(() => expect(archiveCalled).toBe(true))
  })
})

// ─── Compose ──────────────────────────────────────────────────────────────────

describe('TeamsPanel — compose', () => {
  it('shows compose input when a team is selected', async () => {
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    expect(screen.getByPlaceholderText(/message alpha-team/i)).toBeInTheDocument()
  })

  it('submit sends POST and clears the input', async () => {
    let postBody = null
    server.use(
      http.post('/api/teams/:name/inbox', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 'new-id', sender: 'user', content: postBody.content, timestamp: new Date().toISOString(), read: false, archived: false }, { status: 201 })
      })
    )
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    const input = screen.getByPlaceholderText(/message alpha-team/i)
    await userEvent.type(input, 'new message text')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(postBody?.content).toBe('new message text'))
    expect(input).toHaveValue('')
  })

  it('does not submit when input is empty', async () => {
    let postCalled = false
    server.use(http.post('/api/teams/:name/inbox', () => { postCalled = true; return HttpResponse.json({}, { status: 201 }) }))
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    expect(postCalled).toBe(false)
  })

  it('shows error message on failed compose', async () => {
    server.use(http.post('/api/teams/:name/inbox', () => HttpResponse.json({ error: 'Server error' }, { status: 500 })))
    render(<TeamsPanel teams={SAMPLE_TEAMS} />)
    await userEvent.click(screen.getByText('alpha-team'))
    await userEvent.type(screen.getByPlaceholderText(/message alpha-team/i), 'test')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(screen.getByText(/failed to send/i)).toBeInTheDocument())
  })
})
