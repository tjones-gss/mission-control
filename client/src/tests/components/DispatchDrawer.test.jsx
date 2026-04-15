import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { DispatchDrawer, DispatchDrawerHandle } from '../../components/DispatchDrawer.jsx'

const MOCK_MANAGERS = {
  managers: [
    {
      id: '/home/me/projects',
      dir: '/home/me/projects',
      slug: 'projects',
      childCount: 2,
      activeCount: 1,
      idleCount: 0,
      doneCount: 1,
      needsInputCount: 1,
      totalCost: 3.5,
      lastModified: Date.now(),
      children: [
        {
          sessionId: 'sess-a',
          cwd: '/home/me/projects/repo-a',
          slug: 'repo-a',
          isActive: true,
          needsInput: false,
          lastModified: Date.now(),
          lastText: 'Working on feature X',
          model: 'claude-sonnet-4-6',
          permissionMode: 'default',
          estimatedCost: { totalCost: 2.0 },
        },
        {
          sessionId: 'sess-b',
          cwd: '/home/me/projects/repo-b',
          slug: 'repo-b',
          isActive: false,
          needsInput: true,
          lastModified: Date.now() - 5 * 60 * 60 * 1000,
          lastText: 'Completed migration',
          model: 'claude-sonnet-4-6',
          permissionMode: 'auto',
          estimatedCost: { totalCost: 1.5 },
        },
      ],
    },
  ],
  standalone: [],
}

// ─── DispatchDrawerHandle ────────────────────────────────────────────────────

describe('DispatchDrawerHandle', () => {
  it('renders handle button when closed', () => {
    render(<DispatchDrawerHandle open={false} onToggle={() => {}} />)
    expect(screen.getByRole('button', { name: 'Open dispatch manager' })).toBeInTheDocument()
  })

  it('returns null when open', () => {
    const { container } = render(<DispatchDrawerHandle open={true} onToggle={() => {}} />)
    expect(container.querySelector('button')).toBeNull()
  })

  it('calls onToggle when clicked', () => {
    const onToggle = vi.fn()
    render(<DispatchDrawerHandle open={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open dispatch manager' }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('shows group and session counts from API data', async () => {
    render(<DispatchDrawerHandle open={false} onToggle={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/1 group/)).toBeInTheDocument()
    })
  })

  it('shows active count when sessions are active', async () => {
    render(<DispatchDrawerHandle open={false} onToggle={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument()
    })
  })

  it('shows waiting badge when needsInputCount > 0', async () => {
    server.use(
      http.get('/api/managers', () =>
        HttpResponse.json({
          managers: [{ ...MOCK_MANAGERS.managers[0], needsInputCount: 2 }],
          standalone: [],
        }),
      ),
    )
    render(<DispatchDrawerHandle open={false} onToggle={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText(/waiting/)).toBeInTheDocument()
    })
  })

  it('displays "Dispatch" label', () => {
    render(<DispatchDrawerHandle open={false} onToggle={() => {}} />)
    expect(screen.getByText('Dispatch')).toBeInTheDocument()
  })
})

// ─── DispatchDrawer ──────────────────────────────────────────────────────────

describe('DispatchDrawer', () => {
  const defaultProps = { open: true, onClose: vi.fn(), onSingleDispatchSuccess: vi.fn() }

  it('renders header when open', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Dispatch Manager')).toBeInTheDocument()
    })
  })

  it('renders group/session counts in header', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText(/1 group/)).toBeInTheDocument()
      expect(screen.getByText(/2 sessions/)).toBeInTheDocument()
    })
  })

  it('renders manager cards with correct slug', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('projects')).toBeInTheDocument()
    })
  })

  it('renders child rows with session slugs', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-a')).toBeInTheDocument()
      expect(screen.getByText('repo-b')).toBeInTheDocument()
    })
  })

  it('shows status labels on child rows', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('active')).toBeInTheDocument()
      expect(screen.getByText('done')).toBeInTheDocument()
    })
  })

  it('shows lastText preview on child rows', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('Working on feature X')).toBeInTheDocument()
      expect(screen.getByText('Completed migration')).toBeInTheDocument()
    })
  })

  it('renders composer textarea', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText('Select children above, then type a message…'),
      ).toBeInTheDocument()
    })
  })

  it('renders Dispatch button as disabled initially', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /Dispatch/ })
      expect(btn).toBeDisabled()
    })
  })

  it('shows empty state when no managers', async () => {
    server.use(http.get('/api/managers', () => HttpResponse.json({ managers: [], standalone: [] })))
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText(/No manager groups found/)).toBeInTheDocument()
    })
  })

  it('toggles child selection on click', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-a')).toBeInTheDocument()
    })
    // Click the child row (the button containing "repo-a")
    const childRow = screen.getByText('repo-a').closest('button')
    fireEvent.click(childRow)
    expect(screen.getByText('1 selected')).toBeInTheDocument()
  })

  it('enables Dispatch button when text + selection present', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-b')).toBeInTheDocument()
    })

    // Select a child
    const childRow = screen.getByText('repo-b').closest('button')
    fireEvent.click(childRow)

    // Type a message
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'test message' } })

    // Button should be enabled
    const btn = screen.getByRole('button', { name: /Dispatch/ })
    expect(btn).not.toBeDisabled()
  })

  it('sends POST for each selected session on dispatch', async () => {
    const posts = []
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ params, request }) => {
        const body = await request.json()
        posts.push({ sessionId: params.sessionId, message: body.message })
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )

    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-a')).toBeInTheDocument()
    })

    // Select both children
    fireEvent.click(screen.getByText('repo-a').closest('button'))
    fireEvent.click(screen.getByText('repo-b').closest('button'))
    expect(screen.getByText('2 selected')).toBeInTheDocument()

    // Type and send
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'broadcast test' } })
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }))

    // Wait for POST calls
    await waitFor(() => {
      expect(posts).toHaveLength(2)
    })
    expect(posts.map((p) => p.sessionId).sort()).toEqual(['sess-a', 'sess-b'])
    expect(posts[0].message).toBe('broadcast test')
  })

  it('shows error inline when dispatch fails', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/message', () =>
        HttpResponse.json({ error: 'Session not found' }, { status: 404 }),
      ),
    )

    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-a')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo-a').closest('button'))
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'will fail' } })
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }))

    await waitFor(() => {
      expect(screen.getByText(/Session not found/)).toBeInTheDocument()
    })
  })

  it('clears selection and text on successful dispatch', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-b')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo-b').closest('button'))
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'success test' } })
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }))

    await waitFor(() => {
      expect(textarea.value).toBe('')
    })
    // Selection should be cleared
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn()
    render(<DispatchDrawer open={true} onClose={onClose} onSingleDispatchSuccess={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Dispatch Manager')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTitle('Close (Esc)'))
    expect(onClose).toHaveBeenCalled()
  })

  it('calls onClose on Escape key', async () => {
    const onClose = vi.fn()
    render(<DispatchDrawer open={true} onClose={onClose} onSingleDispatchSuccess={() => {}} />)
    await waitFor(() => {
      expect(screen.getByText('Dispatch Manager')).toBeInTheDocument()
    })
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('fires onSingleDispatchSuccess for single-target dispatch', async () => {
    const onSingle = vi.fn()
    render(<DispatchDrawer open={true} onClose={() => {}} onSingleDispatchSuccess={onSingle} />)
    await waitFor(() => {
      expect(screen.getByText('repo-b')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo-b').closest('button'))
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'single target' } })
    fireEvent.click(screen.getByRole('button', { name: /Dispatch/ }))

    await waitFor(() => {
      expect(onSingle).toHaveBeenCalledWith('sess-b', expect.anything())
    })
  })

  it('shows cost per child row', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('$2.00')).toBeInTheDocument()
      expect(screen.getByText('$1.50')).toBeInTheDocument()
    })
  })

  it('shows total cost in manager header', async () => {
    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('$3.50')).toBeInTheDocument()
    })
  })

  it('handles Ctrl+Enter to dispatch', async () => {
    const posts = []
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ params }) => {
        posts.push(params.sessionId)
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )

    render(<DispatchDrawer {...defaultProps} />)
    await waitFor(() => {
      expect(screen.getByText('repo-a')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('repo-a').closest('button'))
    const textarea = screen.getByPlaceholderText(/Broadcast to/)
    fireEvent.change(textarea, { target: { value: 'ctrl-enter test' } })
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })

    await waitFor(() => {
      expect(posts).toHaveLength(1)
    })
  })
})
