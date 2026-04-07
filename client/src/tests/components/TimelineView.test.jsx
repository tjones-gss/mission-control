import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../hooks/useApi.js', () => ({
  useApi: vi.fn(),
}))

import { useApi } from '../../hooks/useApi.js'
import { TimelineView } from '../../components/TimelineView.jsx'

const MESSAGES = {
  messages: [
    {
      type: 'user',
      timestamp: '2025-01-01T10:00:00Z',
      blocks: [{ type: 'text', text: 'Please help me' }],
    },
    {
      type: 'assistant',
      timestamp: '2025-01-01T10:00:05Z',
      blocks: [
        { type: 'thinking', text: 'Let me think about this...' },
        { type: 'text', text: 'Here is my response' },
        { type: 'tool_use', name: 'Bash', input: { command: 'ls -la' } },
      ],
    },
    {
      type: 'user',
      timestamp: '2025-01-01T10:00:10Z',
      blocks: [{ type: 'tool_result', content: 'file1.js\nfile2.js' }],
    },
  ],
}

const defaultProps = { sessionId: 'test-123', sessionUpdateVersion: 1, active: true }

describe('TimelineView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows "Loading..." when loading is true', () => {
    useApi.mockReturnValue({ data: null, loading: true, error: null })
    render(<TimelineView {...defaultProps} />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })

  it('shows "No events" when messages are empty', () => {
    useApi.mockReturnValue({ data: { messages: [] }, loading: false, error: null })
    render(<TimelineView {...defaultProps} />)
    expect(screen.getByText('No events')).toBeInTheDocument()
  })

  it('parses user text blocks as USER events', () => {
    useApi.mockReturnValue({ data: MESSAGES, loading: false, error: null })
    render(<TimelineView {...defaultProps} />)
    expect(screen.getByText('USER')).toBeInTheDocument()
    expect(screen.getByText('Please help me')).toBeInTheDocument()
  })

  it('parses assistant thinking, text, and tool_use blocks', () => {
    useApi.mockReturnValue({ data: MESSAGES, loading: false, error: null })
    render(<TimelineView {...defaultProps} />)
    expect(screen.getByText('THINK')).toBeInTheDocument()
    expect(screen.getByText('Let me think about this...')).toBeInTheDocument()
    expect(screen.getByText('TEXT')).toBeInTheDocument()
    expect(screen.getByText('Here is my response')).toBeInTheDocument()
    expect(screen.getByText('Bash')).toBeInTheDocument()
    expect(screen.getByText('ls -la')).toBeInTheDocument()
  })

  it('parses tool_result blocks', () => {
    useApi.mockReturnValue({ data: MESSAGES, loading: false, error: null })
    render(<TimelineView {...defaultProps} />)
    expect(screen.getByText('RESULT')).toBeInTheDocument()
    expect(screen.getByText('file1.js')).toBeInTheDocument()
  })

  it('shows time deltas between events', () => {
    useApi.mockReturnValue({ data: MESSAGES, loading: false, error: null })
    render(<TimelineView {...defaultProps} />)
    const deltas = screen.getAllByText('+5s')
    expect(deltas.length).toBeGreaterThanOrEqual(1)
  })
})
