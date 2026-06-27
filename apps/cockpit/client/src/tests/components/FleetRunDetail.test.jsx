import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { RunDetail } from '../../components/FleetTab/FleetRunDetail.jsx'

function makeRun(overrides = {}) {
  return {
    id: 'run-1',
    goal: 'Add OAuth across services',
    status: 'running',
    createdAt: new Date().toISOString(),
    policy: { maxConcurrency: 4 },
    children: [
      {
        idx: 0,
        cwd: 'C:/proj/a',
        sessionId: 'sess-a',
        worktree: true,
        branch: 'fleet/run-1/c0',
        status: 'running',
        cost: { totalCost: 2.0 },
      },
    ],
    synthesis: { status: 'pending' },
    ...overrides,
  }
}

function stub({ run, escalations = [] }) {
  const captured = []
  server.use(
    http.get('/api/fleet/:id/escalations', () => HttpResponse.json({ escalations })),
    http.get('/api/fleet/:id', () => HttpResponse.json(run)),
    http.post('/api/fleet/:id/decide', async ({ request, params }) => {
      const body = await request.json()
      captured.push({ url: `/api/fleet/${params.id}/decide`, body })
      return HttpResponse.json({ ok: true, ...body })
    }),
  )
  return captured
}

describe('RunDetail', () => {
  it('renders the run goal and its child cards', async () => {
    stub({ run: makeRun() })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add OAuth across services')).toBeInTheDocument())
    expect(screen.getByTestId('fleet-child-0')).toBeInTheDocument()
  })

  it('renders the lifecycle stepper, marking the current phase', async () => {
    // status running + synthesis pending + a running child → "Working" is active.
    stub({ run: makeRun() })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('fleet-stepper')).toBeInTheDocument())
    const stepper = screen.getByTestId('fleet-stepper')
    expect(stepper).toHaveTextContent(/working/i)
    expect(stepper).toHaveTextContent('0/1')
  })

  it('renders the budget bar when a budget cap is set', async () => {
    stub({
      run: makeRun({
        status: 'budget_exceeded',
        spentUsd: 10,
        budgetRemaining: 0,
        policy: { maxConcurrency: 4, budgetUsd: 8 },
      }),
    })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByTestId('fleet-budget-bar')).toBeInTheDocument())
    const bar = screen.getByTestId('fleet-budget-bar')
    expect(within(bar).getByText('budget exceeded')).toBeInTheDocument()
  })

  it('renders the synthesis summary when synthesis is done', async () => {
    stub({
      run: makeRun({
        status: 'succeeded',
        synthesis: { status: 'done', summary: 'Merged report: both branches landed OAuth.' },
      }),
    })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/merged report: both branches landed oauth/i)).toBeInTheDocument(),
    )
  })

  it('renders nothing when runId is null (no fetch issued)', () => {
    const { container } = render(<RunDetail runId={null} version={0} onOpenSession={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the loading placeholder before the run arrives', () => {
    stub({ run: makeRun() })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    // Synchronous first render: useApi is loading with no data yet.
    expect(screen.getByText(/loading run/i)).toBeInTheDocument()
  })

  it('surfaces a server error from the run fetch', async () => {
    server.use(
      http.get('/api/fleet/:id/escalations', () => HttpResponse.json({ escalations: [] })),
      http.get('/api/fleet/:id', () =>
        HttpResponse.json({ error: 'run vanished' }, { status: 500 }),
      ),
    )
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/run vanished/i)).toBeInTheDocument())
  })

  it('renders without children without crashing', async () => {
    stub({ run: makeRun({ children: [] }) })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add OAuth across services')).toBeInTheDocument())
    expect(screen.queryByTestId('fleet-child-0')).not.toBeInTheDocument()
  })

  it('renders the skipped-synthesis note with its reason', async () => {
    stub({
      run: makeRun({
        status: 'succeeded',
        synthesis: { status: 'skipped', summary: 'Only one child — nothing to merge.' },
      }),
    })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText(/only one child — nothing to merge/i)).toBeInTheDocument(),
    )
  })

  it('routes an escalation Allow through POST /decide', async () => {
    const captured = stub({
      run: makeRun({ children: [{ ...makeRun().children[0], status: 'escalated' }] }),
      escalations: [
        { childIdx: 0, source: 'tool', approvalId: 'ap-1', tool: 'Bash', command: 'git push' },
      ],
    })
    render(<RunDetail runId="run-1" version={0} onOpenSession={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/escalation/i)).toBeInTheDocument())
    await userEvent.click(screen.getByRole('button', { name: /allow/i }))
    await waitFor(() => {
      const decision = captured.find((c) => c.url === '/api/fleet/run-1/decide')
      expect(decision).toBeTruthy()
      expect(decision.body).toEqual({
        childIdx: 0,
        source: 'tool',
        decision: 'allow',
        approvalId: 'ap-1',
      })
    })
  })
})
