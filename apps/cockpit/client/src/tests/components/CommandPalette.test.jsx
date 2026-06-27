import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { CommandPalette } from '../../components/CommandPalette.jsx'

// ─── App-level wiring (Ctrl+K opens, Esc closes) ────────────────────────────
// App is heavy (SSE, notifications, sound, streaming) so those hooks are
// stubbed — but the REAL useKeyboardShortcuts stays so the Ctrl+K → palette
// wiring is exercised end to end.
const h = vi.hoisted(() => ({ sessions: [] }))

vi.mock('../../hooks/useApi.js', () => ({
  useApi: (url) => ({
    data: url === '/api/sessions' ? h.sessions : null,
    loading: false,
    error: null,
    refetch: () => {},
  }),
}))
vi.mock('../../hooks/useSSE.js', () => ({ useSSE: () => ({ connected: true }) }))
vi.mock('../../hooks/useNotifications.js', () => ({
  useNotifications: () => ({
    requestPermission: () => {},
    muteSession: () => {},
    mutedIds: { current: new Set() },
  }),
  getNotificationPrefs: () => ({ sound: false, desktop: false }),
}))
vi.mock('../../hooks/useSound.js', () => ({ useSound: () => ({ play: () => {} }) }))
vi.mock('../../hooks/useStreamingSession.js', () => ({ useStreamingSession: () => ({}) }))

import App from '../../App.jsx'

const SESSIONS = [
  {
    sessionId: 'sess-local',
    slug: 'deploy-fixes',
    cwd: 'C:/work/mission-control',
    displayName: null,
    isActive: false,
    needsInput: false,
    lastModified: Date.now() - 60_000,
  },
  {
    sessionId: 'sess-other',
    slug: 'unrelated-work',
    cwd: 'C:/work/other-project',
    displayName: null,
    isActive: false,
    needsInput: false,
    lastModified: Date.now() - 120_000,
  },
]

const MESSAGE_HITS = [
  {
    sessionId: 'sess-1',
    idx: 4,
    role: 'assistant',
    ts: '2026-06-01T00:00:05Z',
    cwd: 'C:/work/mission-control',
    docType: 'message',
    snippet: 'fixed the <mark>deploy</mark> pipeline by pinning node',
    rank: -1.2,
    lastModified: Date.now() - 1000,
    slug: 'fix-deploy',
    model: null,
  },
]

function mockSearch(results = MESSAGE_HITS) {
  const calls = []
  server.use(
    http.get('/api/search', ({ request }) => {
      calls.push(new URL(request.url))
      return HttpResponse.json({ query: 'deploy', count: results.length, results })
    }),
  )
  return calls
}

const PATTERNS = [
  {
    id: 'command:git',
    kind: 'command',
    trigger: 'git',
    response: 'runs `git`',
    count: 4,
    last_seen: Date.now(),
    example_session_ids: ['sess-pat'],
  },
]

function mockPatterns(results = PATTERNS) {
  const calls = []
  server.use(
    http.get('/api/patterns', ({ request }) => {
      calls.push(new URL(request.url))
      return HttpResponse.json({ query: 'git', count: results.length, results })
    }),
  )
  return calls
}

beforeEach(() => {
  localStorage.clear()
})

describe('CommandPalette — open/close via keyboard shortcut (App wiring)', () => {
  it('opens on Ctrl+K and closes on Escape', async () => {
    h.sessions = SESSIONS
    render(<App />)

    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument(),
    )
  })

  it('opens on Cmd+K (metaKey) too', () => {
    h.sessions = SESSIONS
    render(<App />)

    fireEvent.keyDown(document.body, { key: 'k', metaKey: true })
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
  })
})

describe('CommandPalette — search', () => {
  it('debounces rapid typing into a single /api/search call with the final query', async () => {
    const calls = mockSearch()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'dep' } })
    fireEvent.change(input, { target: { value: 'deplo' } })
    fireEvent.change(input, { target: { value: 'deploy' } })

    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1))
    // Allow any straggler timers to flush — there must be none.
    await new Promise((r) => setTimeout(r, 350))
    expect(calls).toHaveLength(1)
    expect(calls[0].searchParams.get('q')).toBe('deploy')
  })

  it('renders grouped results: matching sessions first, then message hits with snippets', async () => {
    mockSearch()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })

    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())

    // Group headers present (selector: the type-filter pill is also labeled
    // "Messages", but it is a button — heading labels are spans)
    expect(screen.getByText('Sessions', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('Messages', { selector: 'span' })).toBeInTheDocument()

    // Sessions group comes first: the first option is the matching session
    const options = screen.getAllByRole('option')
    expect(options[0]).toHaveTextContent('deploy-fixes')
    // Non-matching session is filtered out
    expect(screen.queryByText('unrelated-work')).not.toBeInTheDocument()

    // Snippet <mark> highlights render as real elements, never raw HTML text
    expect(document.querySelectorAll('mark').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/<mark>/)).not.toBeInTheDocument()
  })

  it('surfaces the 503 hint when the search index is unavailable', async () => {
    server.use(
      http.get('/api/search', () =>
        HttpResponse.json(
          { error: 'Search index unavailable', hint: 'Delete cockpit.db and restart.' },
          { status: 503 },
        ),
      ),
    )
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() =>
      expect(screen.getByText(/delete cockpit\.db and restart/i)).toBeInTheDocument(),
    )
  })
})

// ── Phase 6: knowledge surfacing — the doc-type filter ───────────────────────
const MEMORY_HIT = {
  sessionId: 'memory:C:/Users/t/.claude/projects/C--proj/memory/install-topology.md',
  idx: 0,
  role: null,
  ts: '2026-06-01T00:00:00Z',
  cwd: 'C:/Users/t/.claude/projects/C--proj/memory/install-topology.md',
  docType: 'memory',
  snippet: 'root npm install covers only <mark>deploy</mark> workspaces',
  rank: -0.8,
  lastModified: Date.now() - 5000,
  slug: 'install-topology.md',
  model: null,
}

describe('CommandPalette — type filter', () => {
  it('renders the filter pills with All active by default and omits type= from the query', async () => {
    const calls = mockSearch()
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(calls.length).toBe(1))
    expect(calls[0].searchParams.get('type')).toBeNull()
  })

  it('selecting a type refetches with type= and marks the pill active', async () => {
    const calls = mockSearch([MEMORY_HIT])
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(calls.length).toBe(1))

    fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
    await waitFor(() => expect(calls.length).toBe(2))
    expect(calls[1].searchParams.get('type')).toBe('memory')
    expect(screen.getByRole('button', { name: 'Memory' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders memory hits with their filename and doc label, and selecting one only closes', async () => {
    mockSearch([MEMORY_HIT])
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open sessions={[]} onNavigate={onNavigate} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText('install-topology.md')).toBeInTheDocument())
    expect(screen.getByText('memory')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/covers only/).closest('[role="option"]'))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  it('summary hits navigate to their session like message hits', async () => {
    mockSearch([{ ...MESSAGE_HITS[0], docType: 'summary', role: null }])
    const onNavigate = vi.fn()
    render(<CommandPalette open sessions={[]} onNavigate={onNavigate} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())
    expect(screen.getByText('summary')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/pipeline by pinning node/).closest('[role="option"]'))
    expect(onNavigate).toHaveBeenCalledWith('sess-1')
  })
})

describe('CommandPalette — patterns (Phase I2)', () => {
  it('renders a Patterns group from /api/patterns and shows the cross-session count', async () => {
    mockSearch([])
    mockPatterns()
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'git' } })
    await waitFor(() =>
      expect(screen.getByText('Patterns', { selector: 'span' })).toBeInTheDocument(),
    )
    expect(screen.getByText('git')).toBeInTheDocument()
    expect(screen.getByText(/4 sessions/)).toBeInTheDocument()
  })

  it('clicking a pattern navigates to its example session and closes', async () => {
    mockSearch([])
    mockPatterns()
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open sessions={[]} onNavigate={onNavigate} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'git' } })
    await waitFor(() => expect(screen.getByText(/4 sessions/)).toBeInTheDocument())

    fireEvent.click(screen.getByText(/4 sessions/).closest('[role="option"]'))
    expect(onNavigate).toHaveBeenCalledWith('sess-pat')
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CommandPalette — navigation', () => {
  it('Enter navigates to the top (session) result and closes', async () => {
    mockSearch()
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={onNavigate} onClose={onClose} />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText('deploy-fixes')).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('sess-local')
    expect(onClose).toHaveBeenCalled()
  })

  it('ArrowDown moves the selection before Enter', async () => {
    mockSearch()
    const onNavigate = vi.fn()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={onNavigate} onClose={() => {}} />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())

    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onNavigate).toHaveBeenCalledWith('sess-1')
  })

  it('clicking a message hit navigates to its session and closes', async () => {
    mockSearch()
    const onNavigate = vi.fn()
    const onClose = vi.fn()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={onNavigate} onClose={onClose} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())

    fireEvent.click(screen.getByText(/pipeline by pinning node/).closest('[role="option"]'))
    expect(onNavigate).toHaveBeenCalledWith('sess-1')
    expect(onClose).toHaveBeenCalled()
  })

  it('Escape calls onClose', () => {
    const onClose = vi.fn()
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={onClose} />)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})

describe('CommandPalette — states', () => {
  it('renders nothing when closed', () => {
    render(<CommandPalette open={false} sessions={[]} onNavigate={() => {}} onClose={() => {}} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows an idle prompt when the query is empty', () => {
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)
    expect(screen.getByText(/search sessions and everything/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no hits anywhere', async () => {
    mockSearch([])
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'zebra' } })
    await waitFor(() => expect(screen.getByText(/no results for/i)).toBeInTheDocument())
    expect(screen.getByText(/try a shorter term/i)).toBeInTheDocument()
    expect(screen.getByText('“zebra”')).toBeInTheDocument()
  })
})

describe('CommandPalette — §2 search UX polish', () => {
  it('shows per-group result counts in the headings', async () => {
    mockSearch()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())

    // Sessions group: 1 matching session; Messages group: 1 hit.
    const sessionsHeading = screen.getByText('Sessions', { selector: 'span' }).closest('div')
    expect(sessionsHeading).toHaveTextContent('1')
    const messagesHeading = screen.getByText('Messages', { selector: 'span' }).closest('div')
    expect(messagesHeading).toHaveTextContent('1')
  })

  it('groups memory/summary docs under a separate Knowledge heading', async () => {
    mockSearch([MEMORY_HIT])
    render(<CommandPalette open sessions={[]} onNavigate={() => {}} onClose={() => {}} />)

    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText('install-topology.md')).toBeInTheDocument())

    expect(screen.getByText('Knowledge', { selector: 'span' })).toBeInTheDocument()
    // It is NOT under a Messages group.
    expect(screen.queryByText('Messages', { selector: 'span' })).not.toBeInTheDocument()
  })

  it('clears the query with the × button and returns to the idle prompt', async () => {
    mockSearch()
    render(<CommandPalette open sessions={SESSIONS} onNavigate={() => {}} onClose={() => {}} />)

    const input = screen.getByPlaceholderText(/search/i)
    fireEvent.change(input, { target: { value: 'deploy' } })
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /clear search/i }))
    expect(input).toHaveValue('')
    expect(screen.getByText(/search sessions and everything/i)).toBeInTheDocument()
  })
})
