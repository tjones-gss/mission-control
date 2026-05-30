import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { HistoryStatsBar } from '../../components/HistoryTab/HistoryStatsBar.jsx'

const STATS = {
  total: 42,
  today: 5,
  topCommand: 'git status',
  topProject: '/home/user/my-project',
  dailyActivity: [
    { date: '2025-03-20', count: 3 },
    { date: '2025-03-21', count: 7 },
    { date: '2025-03-22', count: 0 },
    { date: '2025-03-23', count: 5 },
  ],
}

// ─── Null state ──────────────────────────────────────────────────────────────

describe('HistoryStatsBar — null state', () => {
  it('returns null when stats is null', () => {
    const { container } = render(<HistoryStatsBar stats={null} />)
    expect(container.innerHTML).toBe('')
  })
})

// ─── Stat cards ──────────────────────────────────────────────────────────────

describe('HistoryStatsBar — stat cards', () => {
  it('renders stat cards (Total: 42, Today: 5, Top command: git status, Top project: my-project)', () => {
    render(<HistoryStatsBar stats={STATS} />)

    expect(screen.getByText('Total')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Today')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('Top command')).toBeInTheDocument()
    expect(screen.getByText('git status')).toBeInTheDocument()
    expect(screen.getByText('Top project')).toBeInTheDocument()
    expect(screen.getByText('my-project')).toBeInTheDocument()
  })

  it('shows dashes for null values (topCommand: null, topProject: null)', () => {
    const nullStats = {
      ...STATS,
      topCommand: null,
      topProject: null,
    }
    render(<HistoryStatsBar stats={nullStats} />)

    // The em-dash character used for null values
    const dashes = screen.getAllByText('\u2014')
    expect(dashes.length).toBe(2)
  })
})

// ─── Sparkline ───────────────────────────────────────────────────────────────

describe('HistoryStatsBar — sparkline', () => {
  it('renders sparkline bars', () => {
    render(<HistoryStatsBar stats={STATS} />)

    const sparkline = screen.getByTestId('sparkline')
    expect(sparkline).toBeInTheDocument()

    // Should have 4 bars matching the dailyActivity data
    const bars = sparkline.children
    expect(bars.length).toBe(4)
  })
})
