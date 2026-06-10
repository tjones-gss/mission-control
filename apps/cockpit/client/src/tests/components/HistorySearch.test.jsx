import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { HistorySearch } from '../../components/HistoryTab/HistorySearch.jsx'

const SAMPLE_RESULTS = [
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
    model: 'claude-sonnet-4-6',
  },
  {
    sessionId: 'sess-2',
    idx: 0,
    role: 'user',
    ts: '2026-05-30T00:00:00Z',
    cwd: 'C:/work/other-project',
    docType: 'message',
    snippet: 'the <mark>deploy</mark> is failing on windows',
    rank: -0.8,
    lastModified: Date.now() - 5000,
    slug: null,
    model: null,
  },
]

function mockSearch(results = SAMPLE_RESULTS) {
  const calls = []
  server.use(
    http.get('/api/search', ({ request }) => {
      calls.push(new URL(request.url))
      return HttpResponse.json({ query: 'deploy', count: results.length, results })
    }),
  )
  return calls
}

describe('HistorySearch — results', () => {
  it('queries /api/search with the query and renders result snippets', async () => {
    const calls = mockSearch()
    render(<HistorySearch query="deploy" onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText(/pipeline by pinning node/)).toBeInTheDocument())
    expect(calls.length).toBeGreaterThanOrEqual(1)
    expect(calls[0].searchParams.get('q')).toBe('deploy')
  })

  it('renders <mark> highlights as real mark elements, never raw HTML text', async () => {
    mockSearch()
    render(<HistorySearch query="deploy" onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getAllByText('deploy').length).toBeGreaterThanOrEqual(1))
    const marks = document.querySelectorAll('mark')
    expect(marks.length).toBeGreaterThanOrEqual(2)
    // The literal tag text must not leak into the DOM.
    expect(screen.queryByText(/<mark>/)).not.toBeInTheDocument()
  })

  it('shows session context (slug or id, project) on each row', async () => {
    mockSearch()
    render(<HistorySearch query="deploy" onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText('fix-deploy')).toBeInTheDocument())
    expect(screen.getByText('sess-2')).toBeInTheDocument() // no slug → falls back to id
    expect(screen.getByText('mission-control')).toBeInTheDocument()
  })

  it('deep-links to the session detail on row click', async () => {
    mockSearch()
    const onOpenSession = vi.fn()
    render(<HistorySearch query="deploy" onOpenSession={onOpenSession} />)
    await waitFor(() => expect(screen.getByText('fix-deploy')).toBeInTheDocument())
    screen.getByText('fix-deploy').closest('button').click()
    expect(onOpenSession).toHaveBeenCalledWith('sess-1')
  })

  it('passes the project filter through to the API', async () => {
    const calls = mockSearch()
    render(<HistorySearch query="deploy" project="mission-control" onOpenSession={() => {}} />)
    await waitFor(() => expect(calls.length).toBeGreaterThanOrEqual(1))
    expect(calls[0].searchParams.get('project')).toBe('mission-control')
  })
})

describe('HistorySearch — states', () => {
  it('renders an idle prompt when the query is empty', () => {
    render(<HistorySearch query="" onOpenSession={() => {}} />)
    expect(screen.getByText(/type to search everything/i)).toBeInTheDocument()
  })

  it('shows an empty state when there are no hits', async () => {
    mockSearch([])
    render(<HistorySearch query="zebra" onOpenSession={() => {}} />)
    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeInTheDocument())
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
    render(<HistorySearch query="deploy" onOpenSession={() => {}} />)
    await waitFor(() =>
      expect(screen.getByText(/delete cockpit\.db and restart/i)).toBeInTheDocument(),
    )
  })
})
