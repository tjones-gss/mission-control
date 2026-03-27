import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { TeamInboxFeed } from '../../components/TeamsPanel/TeamInboxFeed.jsx'

const MESSAGES = [
  { id: 'msg1', sender: 'alice', content: 'Hello team', timestamp: '2025-01-01T10:00:00Z', read: false, archived: false },
  { id: 'msg2', sender: 'bob', content: 'Hi there', timestamp: '2025-01-01T10:05:00Z', read: true, archived: false },
  { id: 'msg3', sender: 'charlie', content: 'Old message', timestamp: '2025-01-01T09:00:00Z', read: true, archived: true },
]

const defaultProps = () => ({
  teamName: 'my-team',
  messages: MESSAGES,
  onUpdate: vi.fn(),
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('TeamInboxFeed — empty state', () => {
  it('shows "No messages yet" when messages is empty', () => {
    render(<TeamInboxFeed teamName="my-team" messages={[]} onUpdate={vi.fn()} />)
    expect(screen.getByText('No messages yet')).toBeInTheDocument()
  })
})

// ─── Active messages ─────────────────────────────────────────────────────────

describe('TeamInboxFeed — active messages', () => {
  it('renders active messages (not archived) sorted by timestamp', () => {
    const props = defaultProps()
    render(<TeamInboxFeed {...props} />)

    // alice (10:00) and bob (10:05) are active; charlie is archived
    expect(screen.getByText('Hello team')).toBeInTheDocument()
    expect(screen.getByText('Hi there')).toBeInTheDocument()

    // The active messages should appear in chronological order
    const messageTexts = screen.getAllByText(/Hello team|Hi there/).map(el => el.textContent)
    expect(messageTexts).toEqual(['Hello team', 'Hi there'])
  })

  it('shows unread indicator (blue dot) for unread messages', () => {
    const props = defaultProps()
    const { container } = render(<TeamInboxFeed {...props} />)

    // msg1 is unread, so there should be a blue dot indicator
    const blueDots = container.querySelectorAll('.bg-blue-400')
    expect(blueDots.length).toBe(1)
  })
})

// ─── Actions ─────────────────────────────────────────────────────────────────

describe('TeamInboxFeed — actions', () => {
  it('mark-as-read button sends PATCH with { read: true }', async () => {
    let patchBody = null
    let patchUrl = null
    server.use(
      http.patch('/api/teams/:teamName/inbox/:id', async ({ request, params }) => {
        patchUrl = `/api/teams/${params.teamName}/inbox/${params.id}`
        patchBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    const props = defaultProps()
    render(<TeamInboxFeed {...props} />)

    const markReadBtn = screen.getByTitle('Mark as read')
    await userEvent.click(markReadBtn)

    await waitFor(() => {
      expect(patchUrl).toBe('/api/teams/my-team/inbox/msg1')
      expect(patchBody).toEqual({ read: true })
    })
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled())
  })

  it('archive button sends PATCH with { archived: true }', async () => {
    let patchBody = null
    server.use(
      http.patch('/api/teams/:teamName/inbox/:id', async ({ request }) => {
        patchBody = await request.json()
        return HttpResponse.json({ ok: true })
      }),
    )

    const props = defaultProps()
    render(<TeamInboxFeed {...props} />)

    // There should be archive buttons for each active message
    const archiveBtns = screen.getAllByTitle('Archive')
    await userEvent.click(archiveBtns[0])

    await waitFor(() => {
      expect(patchBody).toEqual({ archived: true })
    })
    await waitFor(() => expect(props.onUpdate).toHaveBeenCalled())
  })
})

// ─── Archived section ────────────────────────────────────────────────────────

describe('TeamInboxFeed — archived', () => {
  it('shows archived count in details/summary', () => {
    const props = defaultProps()
    render(<TeamInboxFeed {...props} />)

    expect(screen.getByText('1 archived')).toBeInTheDocument()
  })
})
