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

  // ─── v10 canvas: full stage graph + guardrails + budget ─────────────────
  // A v10 harness emits phases/gates/transitions/guardrails/budget; the live
  // view renders the full canvas instead of the 3-slot window.

  function v10Status(overrides = {}) {
    return {
      ...alphaStatus(),
      phases: [
        { id: 'plan', agent: 'planner', gate: { required: ['human_approval_for_plan'] } },
        { id: 'build', agent: 'implementer', gate: { required: ['scope_adherence'] } },
        { id: 'review', agent: 'reviewer', gate: { required: [] } },
      ],
      gates: {
        human_approval_for_plan: { auto: false },
        scope_adherence: { auto: true },
      },
      transitions: {
        allowed: { plan: ['build'], build: ['review'] },
        blocked: { deploy_without_release_gate: true, dangerous_operation_without_approval: true },
      },
      guardrails: {
        danger_zone: { present: true, approval_required_count: 14, blocked_pattern_count: 9 },
        quality_gates: {
          present: true,
          stages: { before_pr: ['tests_green', 'lint_clean'] },
        },
        human_approval: { present: true, categories: ['production', 'security'] },
      },
      budget: { ceiling_usd: 20, spent_usd: 5, exceeded: false },
      ...overrides,
    }
  }

  it('renders the full stage canvas with derived states when phases are emitted', async () => {
    stub({ status: v10Status() })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    const canvas = screen.getByRole('list', { name: /pipeline stages/i })
    const cards = within(canvas).getAllByRole('listitem')
    expect(cards).toHaveLength(3)
    // pipeline.phase = 'build' → plan done, build running, review pending.
    expect(within(canvas).getByText('plan').closest('[data-stage-state]')).toHaveAttribute(
      'data-stage-state',
      'done',
    )
    expect(within(canvas).getByText('build').closest('[data-stage-state]')).toHaveAttribute(
      'data-stage-state',
      'running',
    )
    expect(within(canvas).getByText('review').closest('[data-stage-state]')).toHaveAttribute(
      'data-stage-state',
      'pending',
    )
    // The 3-slot fallback strip must NOT also render.
    expect(screen.queryByRole('list', { name: /pipeline phases/i })).not.toBeInTheDocument()
  })

  it('classifies gate pins as manual vs auto from the gates map', async () => {
    stub({ status: v10Status() })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    const pins = screen.getAllByTestId('canvas-gate-pin')
    expect(pins[0]).toHaveAttribute('data-gate-kind', 'manual') // human_approval_for_plan
    expect(pins[1]).toHaveAttribute('data-gate-kind', 'auto') // scope_adherence
  })

  it('renders guardrail cards from real config summaries + hard blocks', async () => {
    stub({ status: v10Status() })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    const rails = screen.getByRole('region', { name: /guardrails/i })
    expect(within(rails).getByText('14 ops need approval')).toBeInTheDocument()
    expect(within(rails).getByText(/before pr · 2/)).toBeInTheDocument()
    expect(within(rails).getByText('production')).toBeInTheDocument()
    expect(within(rails).getByText(/deploy without release gate/)).toBeInTheDocument()
  })

  it('renders the budget bar only when the harness tracks cost', async () => {
    stub({ status: v10Status() })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByTestId('budget-bar')).toBeInTheDocument())
    expect(screen.getByText(/\$5\.00 \/ \$20\.00/)).toBeInTheDocument()
  })

  it('omits canvas, guardrails, and budget entirely for a pre-v10 harness (no invention)', async () => {
    stub() // plain alphaStatus — no v10 fields
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByText('Ship the alpha MVP')).toBeInTheDocument())

    expect(screen.queryByRole('list', { name: /pipeline stages/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /guardrails/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('budget-bar')).not.toBeInTheDocument()
    // The honest 3-slot window still renders.
    expect(screen.getByRole('list', { name: /pipeline phases/i })).toBeInTheDocument()
  })

  it('marks the budget as exceeded when the harness latch trips', async () => {
    stub({ status: v10Status({ budget: { ceiling_usd: 10, spent_usd: 12, exceeded: true } }) })
    render(<PipelineView harnessVersion={0} />)
    await waitFor(() => expect(screen.getByTestId('budget-bar')).toBeInTheDocument())
    expect(screen.getByText(/ceiling exceeded/)).toBeInTheDocument()
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
