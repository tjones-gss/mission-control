import { describe, it, expect } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { PipelineView } from '../../components/PipelineView/PipelineView.jsx'

const ALPHA_KEY = encodeURIComponent('C:/code/alpha')
const BROKEN_KEY = encodeURIComponent('C:/code/broken')

function alphaSummary(overrides = {}) {
  return {
    projectKey: ALPHA_KEY,
    projectLabel: 'alpha',
    projectPath: 'C:/code/alpha',
    available: true,
    pipeline: { phase: 'build', gate: 'review-gate' },
    blocked: false,
    ...overrides,
  }
}

// Raw `harness status --json` (plus server-added project fields) — the live
// view must render ONLY fields this contract actually carries.
function alphaStatus(overrides = {}) {
  return {
    project: { name: 'alpha' },
    pipeline: {
      active: 'mvp-pipeline',
      phase: 'build',
      gate: 'review-gate',
      last_completed_phase: 'plan',
      next_phase: 'review',
      plan_status: 'approved',
      goal: 'Ship the alpha MVP',
      strategy: 'single',
      transitioned_at: '2026-06-30T12:00:00Z',
    },
    missions: {
      'M-001': { status: 'complete' },
      'M-002': { status: 'in-progress' },
      'M-003': { status: 'draft' },
    },
    next: { blocked: false, blocker: null },
    readiness_overall: { score: 72, mvp_ready: false },
    ...overrides,
  }
}

function stub({ projects, status } = {}) {
  server.use(
    http.get('/api/harness', () => HttpResponse.json({ projects: projects ?? [alphaSummary()] })),
    http.get(`/api/harness/${ALPHA_KEY}`, () => HttpResponse.json(status ?? alphaStatus())),
  )
}

describe('PipelineView — read-only live pipeline', () => {
  it('renders the live view by default and auto-selects the first project', async () => {
    stub()
    render(<PipelineView harnessVersion={0} />)

    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())
    expect(screen.getByRole('navigation', { name: /governed projects/i })).toBeInTheDocument()
    expect(screen.getByText('alpha')).toBeInTheDocument()
  })

  it('renders the three-slot stage window with correct states and the real gate pin', async () => {
    stub()
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    const strip = screen.getByRole('list', { name: /pipeline phases/i })
    expect(within(strip).getByText('plan')).toHaveAttribute('data-stage-state', 'done')
    expect(within(strip).getByText('build')).toHaveAttribute('data-stage-state', 'running')
    expect(within(strip).getByText('review')).toHaveAttribute('data-stage-state', 'pending')
    expect(within(strip).getByTestId('gate-pin')).toHaveTextContent('review-gate')
  })

  it('never invents phases: a null next_phase renders no pending chip and no gate pin', async () => {
    const status = alphaStatus()
    status.pipeline.next_phase = null
    status.pipeline.last_completed_phase = null
    stub({ status })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    const strip = screen.getByRole('list', { name: /pipeline phases/i })
    expect(within(strip).getAllByRole('listitem')).toHaveLength(1)
    expect(within(strip).queryByTestId('gate-pin')).not.toBeInTheDocument()
  })

  it('shows blocked posture: warn chip, blocker text, blocked current stage', async () => {
    const status = alphaStatus({ next: { blocked: true, blocker: 'plan awaiting approval' } })
    stub({ status })
    render(<PipelineView harnessVersion={0} />)

    await waitFor(() =>
      expect(screen.getByText(/waiting at review-gate gate/i)).toBeInTheDocument(),
    )
    expect(screen.getByText('plan awaiting approval')).toBeInTheDocument()
    const strip = screen.getByRole('list', { name: /pipeline phases/i })
    expect(within(strip).getByText('build')).toHaveAttribute('data-stage-state', 'blocked')
  })

  it('summarizes missions by status and shows plan status', async () => {
    stub()
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('1 in-progress')).toBeInTheDocument())
    expect(screen.getByText('1 draft')).toBeInTheDocument()
    expect(screen.getByText('1 complete')).toBeInTheDocument()
    expect(screen.getByText('plan: approved')).toBeInTheDocument()
  })

  it('renders the unavailable panel for a project whose harness errored', async () => {
    stub({
      projects: [
        {
          projectKey: BROKEN_KEY,
          projectLabel: 'broken',
          projectPath: 'C:/code/broken',
          available: false,
          pipeline: null,
          blocked: false,
          error: 'harness CLI not found',
        },
      ],
    })
    render(<PipelineView harnessVersion={0} />)

    await waitFor(() => expect(screen.getByText(/harness unavailable/i)).toBeInTheDocument())
    expect(screen.getByText('harness CLI not found')).toBeInTheDocument()
  })

  it('shows the explain-and-point empty state when no governed projects exist', async () => {
    stub({ projects: [] })
    render(<PipelineView harnessVersion={0} />)

    await waitFor(() => expect(screen.getByText(/no governed projects/i)).toBeInTheDocument())
    expect(screen.getByText(/\.harness\//)).toBeInTheDocument()
  })

  it('is read-only in live view: no Save or Run Pipeline verbs', async () => {
    stub()
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /run pipeline/i })).not.toBeInTheDocument()
  })

  it('keeps the composer one click away under Compose', async () => {
    stub()
    server.use(http.get('/api/pipelines', () => HttpResponse.json({ pipelines: [] })))
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /compose/i }))
    await waitFor(() => expect(screen.getByTestId('pipeline-empty-prompt')).toBeInTheDocument())
  })

  it('refetches when harnessVersion bumps (SSE-driven invalidation)', async () => {
    let hits = 0
    server.use(
      http.get('/api/harness', () => {
        hits += 1
        return HttpResponse.json({ projects: [alphaSummary()] })
      }),
      http.get(`/api/harness/${ALPHA_KEY}`, () => HttpResponse.json(alphaStatus())),
    )
    const { rerender } = render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())
    const before = hits

    rerender(<PipelineView harnessVersion={1} />)
    await waitFor(() => expect(hits).toBeGreaterThan(before))
  })
})
