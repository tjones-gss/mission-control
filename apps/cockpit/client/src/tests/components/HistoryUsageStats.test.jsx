import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { HistoryUsageStats } from '../../components/HistoryTab/HistoryUsageStats.jsx'

const DAY_STATS = {
  groupBy: 'day',
  rows: [
    {
      key: '2026-06-01',
      input: 1_000_000,
      output: 500_000,
      cacheRead: 200_000,
      cacheWrite: 100_000,
      totalTokens: 1_800_000,
      cost: 10.5,
      cacheHitRate: 16.67,
    },
    {
      key: '2026-06-02',
      input: 100_000,
      output: 50_000,
      cacheRead: 20_000,
      cacheWrite: 10_000,
      totalTokens: 180_000,
      cost: 1.84,
      cacheHitRate: 16.67,
    },
  ],
  totals: {
    input: 1_100_000,
    output: 550_000,
    cacheRead: 220_000,
    cacheWrite: 110_000,
    cost: 12.34,
    cacheHitRate: 16.67,
  },
}

const PROJECT_STATS = {
  groupBy: 'project',
  rows: [
    {
      key: 'C:/work/mission-control',
      input: 900_000,
      output: 450_000,
      cacheRead: 180_000,
      cacheWrite: 90_000,
      totalTokens: 1_620_000,
      cost: 9.99,
      cacheHitRate: 16.67,
    },
    {
      key: 'C:/work/sidequest',
      input: 200_000,
      output: 100_000,
      cacheRead: 40_000,
      cacheWrite: 20_000,
      totalTokens: 360_000,
      cost: 2.35,
      cacheHitRate: 16.67,
    },
  ],
  totals: DAY_STATS.totals,
}

const MODEL_STATS = {
  groupBy: 'model',
  rows: [
    {
      key: 'sonnet',
      input: 1_000_000,
      output: 500_000,
      cacheRead: 200_000,
      cacheWrite: 100_000,
      totalTokens: 1_800_000,
      cost: 11.0,
      cacheHitRate: 16.67,
    },
    {
      key: 'opus',
      input: 100_000,
      output: 50_000,
      cacheRead: 20_000,
      cacheWrite: 10_000,
      totalTokens: 180_000,
      cost: 1.34,
      cacheHitRate: 16.67,
    },
  ],
  totals: DAY_STATS.totals,
}

const EMPTY = (groupBy) => ({
  groupBy,
  rows: [],
  totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, cacheHitRate: 0 },
})

function mockUsage({ day = DAY_STATS, project = PROJECT_STATS, model = MODEL_STATS } = {}) {
  server.use(
    http.get('/api/stats/usage', ({ request }) => {
      const groupBy = new URL(request.url).searchParams.get('groupBy') || 'day'
      return HttpResponse.json({ day, project, model }[groupBy])
    }),
  )
}

describe('HistoryUsageStats', () => {
  it('renders the overall totals: cost, tokens, cache hit rate', async () => {
    mockUsage()
    render(<HistoryUsageStats />)
    await waitFor(() => expect(screen.getByText('$12.34')).toBeInTheDocument())
    expect(screen.getByText('2.0M')).toBeInTheDocument() // 1.98M total tokens rounded
    expect(screen.getByText(/16\.7%/)).toBeInTheDocument()
  })

  it('renders the per-day trend bars', async () => {
    mockUsage()
    render(<HistoryUsageStats />)
    await waitFor(() => expect(screen.getByTestId('usage-trend')).toBeInTheDocument())
    const trend = screen.getByTestId('usage-trend')
    expect(trend.querySelectorAll('[data-day]')).toHaveLength(2)
  })

  it('renders per-project totals with their cost', async () => {
    mockUsage()
    render(<HistoryUsageStats />)
    await waitFor(() => expect(screen.getByText('mission-control')).toBeInTheDocument())
    expect(screen.getByText('sidequest')).toBeInTheDocument()
    expect(screen.getByText('$9.99')).toBeInTheDocument()
  })

  it('renders the model mix', async () => {
    mockUsage()
    render(<HistoryUsageStats />)
    await waitFor(() => expect(screen.getByText('sonnet')).toBeInTheDocument())
    expect(screen.getByText('opus')).toBeInTheDocument()
    expect(screen.getByText('$11.00')).toBeInTheDocument()
  })

  it('shows an empty state when there is no usage yet', async () => {
    mockUsage({ day: EMPTY('day'), project: EMPTY('project'), model: EMPTY('model') })
    render(<HistoryUsageStats />)
    await waitFor(() => expect(screen.getByText(/no token usage indexed yet/i)).toBeInTheDocument())
  })

  it('surfaces the 503 hint when the cache is unavailable', async () => {
    server.use(
      http.get('/api/stats/usage', () =>
        HttpResponse.json(
          { error: 'Usage stats unavailable', hint: 'delete cockpit.db and restart' },
          { status: 503 },
        ),
      ),
    )
    render(<HistoryUsageStats />)
    await waitFor(() =>
      expect(screen.getByText(/delete cockpit\.db and restart/i)).toBeInTheDocument(),
    )
  })
})
