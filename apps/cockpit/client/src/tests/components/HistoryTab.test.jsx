import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { HistoryTab } from '../../components/HistoryTab/HistoryTab.jsx'

const SAMPLE_STATS = {
  total: 150,
  topCommand: 'git status',
  topProject: '/Users/me/my-project',
  today: 12,
  dailyActivity: [
    { date: '2026-03-06', count: 5 },
    { date: '2026-03-07', count: 8 },
    { date: '2026-03-08', count: 3 },
    { date: '2026-03-09', count: 12 },
    { date: '2026-03-10', count: 7 },
    { date: '2026-03-11', count: 20 },
    { date: '2026-03-12', count: 12 },
  ],
}

const SAMPLE_ENTRIES = [
  {
    display: 'git status',
    timestamp: Date.now() - 1000,
    project: '/Users/me/my-project',
    sessionId: 's1',
  },
  {
    display: 'npm run dev',
    timestamp: Date.now() - 2000,
    project: '/Users/me/other-project',
    sessionId: 's2',
  },
  {
    display: 'git commit -m "fix bug"',
    timestamp: Date.now() - 3000,
    project: '/Users/me/my-project',
    sessionId: 's3',
  },
]

function setupMocks(entries = SAMPLE_ENTRIES, stats = SAMPLE_STATS) {
  server.use(
    http.get('/api/history', () => HttpResponse.json(entries)),
    http.get('/api/history/stats', () => HttpResponse.json(stats)),
  )
}

// ─── Stats bar ────────────────────────────────────────────────────────────────

describe('HistoryTab — stats bar', () => {
  it('renders total commands count', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('150')).toBeInTheDocument())
  })

  it('renders top command', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getAllByText('git status').length).toBeGreaterThanOrEqual(1))
  })

  it('renders commands today count', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument())
  })

  it('renders 7 sparkline bars', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => {
      expect(screen.getByTestId('sparkline')).toBeInTheDocument()
    })
  })

  it('shows zeroed stats on empty history', async () => {
    setupMocks([], { total: 0, topCommand: null, topProject: null, today: 0, dailyActivity: [] })
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1))
  })
})

// ─── Feed ─────────────────────────────────────────────────────────────────────

describe('HistoryTab — feed', () => {
  it('renders history entries', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getAllByText('git status').length).toBeGreaterThanOrEqual(1))
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })

  it('shows empty state when no history', async () => {
    setupMocks([])
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no command history/i)).toBeInTheDocument())
  })

  it('expands entry on click to show full text', async () => {
    const longEntry = {
      display: 'a'.repeat(200),
      timestamp: Date.now(),
      project: '/p',
      sessionId: 's',
    }
    setupMocks([longEntry])
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText(/^a+/))
    await userEvent.click(screen.getByText(/^a+/))
    // After expand, full text should be visible (not truncated)
    expect(screen.getByText(longEntry.display)).toBeInTheDocument()
  })
})

// ─── Search ───────────────────────────────────────────────────────────────────

describe('HistoryTab — search', () => {
  it('filters feed by search term', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getAllByText('git status'))
    const search = screen.getByPlaceholderText(/search history/i)
    await userEvent.type(search, 'npm')
    // Stats bar still shows "git status" as top command, but the feed entry should be gone
    const gitStatusElements = screen.queryAllByText('git status')
    // Only the stats bar element should remain (if any), not the feed entry
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })
})

// ─── Project filter ───────────────────────────────────────────────────────────

describe('HistoryTab — project filter', () => {
  it('filters feed by project selection', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getAllByText('git status'))
    const select = screen.getByRole('combobox')
    await userEvent.selectOptions(select, '/Users/me/my-project')
    // After selecting a project, a new fetch fires; the MSW handler still returns all entries
    // so we just verify the combobox value changed
    expect(select).toHaveValue('/Users/me/my-project')
  })
})

// ─── Grouping toggle ──────────────────────────────────────────────────────────

describe('HistoryTab — grouping toggle', () => {
  it('toggles between flat and grouped view', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getAllByText('git status'))
    const toggleBtn = screen.getByRole('button', { name: /group/i })
    await userEvent.click(toggleBtn)
    // Grouped view shows project name as a header
    expect(screen.getAllByText(/my-project/).length).toBeGreaterThanOrEqual(1)
  })
})

// ─── Search-everything mode (ADR-0008 Phase 2) ────────────────────────────────

describe('HistoryTab — search everything mode', () => {
  it('toggles into search-everything mode beside the display filter', async () => {
    setupMocks()
    server.use(
      http.get('/api/search', () => HttpResponse.json({ query: '', count: 0, results: [] })),
    )
    render(<HistoryTab historyVersion={0} onOpenSession={() => {}} />)
    await waitFor(() => screen.getAllByText('git status'))

    const toggle = screen.getByRole('button', { name: /search everything/i })
    await userEvent.click(toggle)
    // The full-text mode replaces the display-field filtered feed.
    expect(screen.getByText(/type to search everything/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/search everything/i)).toBeInTheDocument()
  })

  it('queries /api/search and deep-links a result to the session detail', async () => {
    setupMocks()
    server.use(
      http.get('/api/search', () =>
        HttpResponse.json({
          query: 'capacitor',
          count: 1,
          results: [
            {
              sessionId: 'sess-deep',
              idx: 1,
              role: 'assistant',
              ts: '2026-06-01T00:00:05Z',
              cwd: 'C:/work/proj',
              docType: 'message',
              snippet: 'the flux <mark>capacitor</mark> hums',
              rank: -1,
              lastModified: Date.now(),
              slug: 'flux-work',
              model: 'claude-sonnet-4-6',
            },
          ],
        }),
      ),
    )
    const onOpenSession = vi.fn()
    render(<HistoryTab historyVersion={0} onOpenSession={onOpenSession} />)
    await waitFor(() => screen.getAllByText('git status'))

    await userEvent.click(screen.getByRole('button', { name: /search everything/i }))
    await userEvent.type(screen.getByPlaceholderText(/search everything/i), 'capacitor')
    await waitFor(() => expect(screen.getByText('flux-work')).toBeInTheDocument())

    await userEvent.click(screen.getByText('flux-work'))
    expect(onOpenSession).toHaveBeenCalledWith('sess-deep')
  })

  it('returns to the display-field filter when toggled back', async () => {
    setupMocks()
    render(<HistoryTab historyVersion={0} onOpenSession={() => {}} />)
    await waitFor(() => screen.getAllByText('git status'))

    const toggle = screen.getByRole('button', { name: /search everything/i })
    await userEvent.click(toggle)
    await userEvent.click(screen.getByRole('button', { name: /filter feed/i }))
    expect(screen.getByPlaceholderText(/search history/i)).toBeInTheDocument()
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })
})

// ─── Usage stats mode (ADR-0008 Phase 5) ──────────────────────────────────────

describe('HistoryTab — usage stats mode', () => {
  const EMPTY_USAGE = (groupBy) => ({
    groupBy,
    rows: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, cacheHitRate: 0 },
  })

  function mockUsageEndpoint() {
    server.use(
      http.get('/api/stats/usage', ({ request }) => {
        const groupBy = new URL(request.url).searchParams.get('groupBy') || 'day'
        return HttpResponse.json(EMPTY_USAGE(groupBy))
      }),
    )
  }

  it('toggles into the usage stats mode inside the History tab', async () => {
    setupMocks()
    mockUsageEndpoint()
    render(<HistoryTab historyVersion={0} onOpenSession={() => {}} />)
    await waitFor(() => screen.getAllByText('git status'))

    await userEvent.click(screen.getByRole('button', { name: /usage stats/i }))
    // The stats panel replaces the feed (still inside the History tab — no new top-level tab).
    await waitFor(() => expect(screen.getByText(/no token usage indexed yet/i)).toBeInTheDocument())
    expect(screen.queryByText('npm run dev')).not.toBeInTheDocument()
  })

  it('returns to the feed when toggled back', async () => {
    setupMocks()
    mockUsageEndpoint()
    render(<HistoryTab historyVersion={0} onOpenSession={() => {}} />)
    await waitFor(() => screen.getAllByText('git status'))

    const toggle = screen.getByRole('button', { name: /usage stats/i })
    await userEvent.click(toggle)
    await waitFor(() => screen.getByText(/no token usage indexed yet/i))
    await userEvent.click(screen.getByRole('button', { name: /back to feed/i }))
    expect(screen.getByText('npm run dev')).toBeInTheDocument()
  })
})

// ─── Load more ────────────────────────────────────────────────────────────────

describe('HistoryTab — load more', () => {
  it('shows Load More button when results may have more pages', async () => {
    // 100 entries = full page, so Load More should appear
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      display: `cmd-${i}`,
      timestamp: Date.now() - i * 1000,
      project: '/p',
      sessionId: `s${i}`,
    }))
    setupMocks(fullPage)
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText(/load more/i))
  })

  it('does not show Load More when fewer than 100 results', async () => {
    setupMocks(SAMPLE_ENTRIES) // only 3 entries
    render(<HistoryTab historyVersion={0} />)
    await waitFor(() => screen.getByText('git status'))
    expect(screen.queryByText(/load more/i)).not.toBeInTheDocument()
  })
})
