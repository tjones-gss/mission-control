import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../hooks/useApi.js', () => ({
  useApi: vi.fn(),
}))

import { useApi } from '../../hooks/useApi.js'
import { GraphPanel } from '../../components/InspectPanel/GraphPanel.jsx'

const GRAPH = {
  node: 'session:s1',
  nodes: [
    { id: 'session:s1', kind: 'session', label: 'fix-auth', meta: '{}' },
    { id: 'file:/repo/a.js', kind: 'file', label: '/repo/a.js', meta: '{}' },
    { id: 'commit:s1:0', kind: 'commit', label: 'fix bug', meta: '{}' },
  ],
  edges: [
    { from_id: 'session:s1', to_id: 'file:/repo/a.js', rel: 'touched' },
    { from_id: 'session:s1', to_id: 'commit:s1:0', rel: 'produced' },
  ],
}

describe('GraphPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows a loading state while fetching', () => {
    useApi.mockReturnValue({ data: null, loading: true, error: null, refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    expect(screen.getByText(/loading graph/i)).toBeInTheDocument()
  })

  it('fetches the session node neighbourhood from /api/graph', () => {
    useApi.mockReturnValue({ data: GRAPH, loading: false, error: null, refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    expect(useApi).toHaveBeenCalledWith('/api/graph?node=session%3As1', expect.anything())
  })

  it('renders one node per graph node, tagged by kind', () => {
    useApi.mockReturnValue({ data: GRAPH, loading: false, error: null, refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    const nodes = screen.getAllByTestId('graph-node')
    expect(nodes).toHaveLength(3)
    const kinds = nodes.map((n) => n.getAttribute('data-kind')).sort()
    expect(kinds).toEqual(['commit', 'file', 'session'])
  })

  it('renders one edge per graph edge', () => {
    useApi.mockReturnValue({ data: GRAPH, loading: false, error: null, refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    expect(screen.getAllByTestId('graph-edge')).toHaveLength(2)
  })

  it('shows the node labels', () => {
    useApi.mockReturnValue({ data: GRAPH, loading: false, error: null, refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    expect(screen.getByText('fix-auth')).toBeInTheDocument()
    expect(screen.getByText('fix bug')).toBeInTheDocument()
  })

  it('shows an empty state when the neighbourhood has no nodes', () => {
    useApi.mockReturnValue({
      data: { node: 'session:s1', nodes: [], edges: [] },
      loading: false,
      error: null,
      refetch: vi.fn(),
    })
    render(<GraphPanel sessionId="s1" />)
    expect(screen.getByText(/no graph/i)).toBeInTheDocument()
  })

  it('shows an error state when the fetch fails', () => {
    useApi.mockReturnValue({ data: null, loading: false, error: 'boom', refetch: vi.fn() })
    render(<GraphPanel sessionId="s1" />)
    expect(screen.getByText(/graph unavailable/i)).toBeInTheDocument()
  })
})
