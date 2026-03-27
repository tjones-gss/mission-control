import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { HistoryFeed } from '../../components/HistoryTab/HistoryFeed.jsx'

const ENTRIES = [
  { sessionId: 's1', timestamp: 1711500000000, display: 'git status', project: '/home/user/my-project' },
  { sessionId: 's2', timestamp: 1711500060000, display: 'A very long command that exceeds eighty characters and should be truncated with an ellipsis at the end', project: '/home/user/other' },
]

const defaultProps = () => ({
  entries: ENTRIES,
  grouped: false,
  onLoadMore: vi.fn(),
  hasMore: true,
})

// ─── Empty state ──────────────────────────────────────────────────────────────

describe('HistoryFeed — empty state', () => {
  it('shows "No command history found" when entries is empty', () => {
    render(<HistoryFeed entries={[]} grouped={false} onLoadMore={vi.fn()} hasMore={false} />)
    expect(screen.getByText('No command history found')).toBeInTheDocument()
  })
})

// ─── Rendering entries ───────────────────────────────────────────────────────

describe('HistoryFeed — rendering', () => {
  it('renders entries with timestamps and project basenames', () => {
    render(<HistoryFeed {...defaultProps()} />)

    expect(screen.getByText('git status')).toBeInTheDocument()
    // Project basenames
    expect(screen.getByText('my-project')).toBeInTheDocument()
    expect(screen.getByText('other')).toBeInTheDocument()
  })

  it('truncates long entries (>80 chars) with ellipsis', () => {
    render(<HistoryFeed {...defaultProps()} />)

    const truncated = 'A very long command that exceeds eighty characters and should be truncated with \u2026'
    expect(screen.getByText(truncated)).toBeInTheDocument()

    // Full text should not be visible
    expect(screen.queryByText(ENTRIES[1].display)).not.toBeInTheDocument()
  })

  it('expands truncated entry on click', async () => {
    render(<HistoryFeed {...defaultProps()} />)

    const truncated = 'A very long command that exceeds eighty characters and should be truncated with \u2026'
    const truncatedEl = screen.getByText(truncated)

    // Click the parent row to expand
    await userEvent.click(truncatedEl.closest('[class*="cursor-pointer"]'))

    await waitFor(() => {
      expect(screen.getByText(ENTRIES[1].display)).toBeInTheDocument()
    })
  })
})

// ─── Load more ───────────────────────────────────────────────────────────────

describe('HistoryFeed — load more', () => {
  it('shows "Load more" button when hasMore is true', async () => {
    const props = defaultProps()
    render(<HistoryFeed {...props} />)

    const loadMoreBtn = screen.getByText('Load more')
    expect(loadMoreBtn).toBeInTheDocument()

    await userEvent.click(loadMoreBtn)
    expect(props.onLoadMore).toHaveBeenCalledOnce()
  })
})

// ─── Grouped view ────────────────────────────────────────────────────────────

describe('HistoryFeed — grouped view', () => {
  it('groups entries by project', () => {
    render(<HistoryFeed entries={ENTRIES} grouped={true} onLoadMore={vi.fn()} hasMore={false} />)

    // Should show project basenames as group headers in summary elements
    // Each project gets a <details> with a <summary> containing the basename and count
    const summaries = document.querySelectorAll('summary')
    expect(summaries.length).toBe(2)

    // Entries should appear under their project groups
    expect(screen.getByText('git status')).toBeInTheDocument()
  })
})
