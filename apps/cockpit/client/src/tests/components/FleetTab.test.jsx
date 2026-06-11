import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { FleetTab } from '../../components/FleetTab/FleetTab.jsx'

// A running fleet run with two children — child 0 is escalated (a live tool
// approval surfaces it), child 1 is succeeded. Used to exercise child cards,
// the escalation banner, and the synthesis panel.
function makeRun(overrides = {}) {
  return {
    id: 'add-oauth-2026',
    goal: 'Add OAuth across services',
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    policy: { maxConcurrency: 4 },
    children: [
      {
        idx: 0,
        cwd: 'C:/proj/a',
        prompt: 'Add OAuth to service A',
        workflow: null,
        sessionId: 'sess-a',
        worktree: true,
        branch: 'fleet/add-oauth-2026/c0',
        status: 'escalated',
        cost: { totalCost: 2.0 },
        escalation: null,
        error: null,
      },
      {
        idx: 1,
        cwd: 'C:/proj/b',
        prompt: null,
        workflow: 'add-oauth',
        sessionId: 'sess-b',
        worktree: true,
        branch: 'fleet/add-oauth-2026/c1',
        status: 'succeeded',
        cost: { totalCost: 1.0 },
        escalation: null,
        error: null,
      },
    ],
    synthesis: { status: 'pending', sessionId: null, summary: null, completedAt: null },
    ...overrides,
  }
}

const ESCALATION = {
  childIdx: 0,
  source: 'tool',
  sessionId: 'sess-a',
  approvalId: 'ap-1',
  tool: 'Bash',
  command: 'git push --force',
  riskLevel: 'DESTRUCTIVE',
  requestedAt: null,
}

// A harness-source escalation — surfaced from a .harness/approvals/pending file,
// carries a requestId (not an approvalId) and resolves via the harness CLI path.
const HARNESS_ESCALATION = {
  childIdx: 0,
  source: 'harness',
  sessionId: 'sess-a',
  requestId: 'req-9',
  tool: 'Bash',
  command: 'rm -rf build',
  riskLevel: 'DESTRUCTIVE',
  requestedAt: null,
}

// Fleet-ready projects served by the stubbed GET /api/harness — these feed the
// launcher's cwd picker (the same set the server validates child cwds against).
const HARNESS_PROJECTS = [
  { projectPath: 'C:/proj/a', projectLabel: 'a', available: true },
  { projectPath: 'C:/proj/b', projectLabel: 'b', available: true },
]

// Stub the full fleet contract: list, detail, escalations. Returns the captured
// request log so a test can assert what was POSTed.
function stubFleet({ runs = [], run = null, escalations = [], templates = [], projects } = {}) {
  const captured = []
  server.use(
    http.get('/api/harness', () =>
      HttpResponse.json({ projects: projects === undefined ? HARNESS_PROJECTS : projects }),
    ),
    http.get('/api/fleet', () => HttpResponse.json({ runs })),
    // Templates MUST be registered before '/api/fleet/:id' so 'templates' is not
    // matched as a run id — mirrors the server-side route-ordering gotcha.
    http.get('/api/fleet/templates', () => HttpResponse.json({ templates })),
    http.post('/api/fleet/templates', async ({ request }) => {
      const body = await request.json()
      captured.push({ url: '/api/fleet/templates', body })
      return HttpResponse.json({ ok: true, template: body }, { status: 200 })
    }),
    http.get('/api/fleet/:id', () =>
      run ? HttpResponse.json(run) : HttpResponse.json({ error: 'not_found' }, { status: 404 }),
    ),
    http.get('/api/fleet/:id/escalations', () => HttpResponse.json({ escalations })),
    http.post('/api/fleet', async ({ request }) => {
      const body = await request.json()
      captured.push({ url: '/api/fleet', body })
      return HttpResponse.json(
        { ok: true, id: 'new-run', status: 'running', children: [] },
        { status: 202 },
      )
    }),
    http.post('/api/fleet/:id/decide', async ({ request, params }) => {
      const body = await request.json()
      captured.push({ url: `/api/fleet/${params.id}/decide`, body })
      return HttpResponse.json({ ok: true, ...body })
    }),
    // Legacy path — kept stubbed so an accidental POST here is captured and the
    // test can assert the UI no longer uses it.
    http.post('/api/sessions/:sessionId/tool-approval', async ({ request, params }) => {
      const body = await request.json()
      captured.push({ url: `/api/sessions/${params.sessionId}/tool-approval`, body })
      return HttpResponse.json({ ok: true })
    }),
  )
  return captured
}

describe('FleetTab', () => {
  it('renders the empty state when there are no runs', async () => {
    stubFleet({ runs: [] })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())
  })

  it('launches a run via the launch drawer (mocked POST /api/fleet)', async () => {
    const captured = stubFleet({ runs: [] })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())

    // Open the launch drawer.
    await userEvent.click(screen.getAllByRole('button', { name: /new fleet run/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /new fleet run/i })

    // Fill the goal + the first child's cwd + prompt.
    await userEvent.type(
      within(dialog).getByPlaceholderText(/what should the fleet accomplish/i),
      'Add OAuth across services',
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/child 0 working directory/i),
      'C:/proj/a',
    )
    await userEvent.type(within(dialog).getByLabelText(/child 0 prompt/i), 'Add OAuth to A')

    await userEvent.click(within(dialog).getByRole('button', { name: /launch fleet/i }))

    await waitFor(() => {
      const post = captured.find((c) => c.url === '/api/fleet')
      expect(post).toBeTruthy()
      expect(post.body.goal).toBe('Add OAuth across services')
      expect(post.body.children).toEqual([{ cwd: 'C:/proj/a', prompt: 'Add OAuth to A' }])
    })
  })

  it('offers only fleet-ready projects in the working-directory picker', async () => {
    stubFleet({ runs: [] })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /new fleet run/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /new fleet run/i })

    const picker = within(dialog).getByLabelText(/child 0 working directory/i)
    await waitFor(() => {
      const values = Array.from(picker.querySelectorAll('option')).map((o) => o.value)
      expect(values).toEqual(['', 'C:/proj/a', 'C:/proj/b'])
    })
  })

  it('explains the fleet-ready requirements when no project qualifies', async () => {
    stubFleet({ runs: [], projects: [] })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /new fleet run/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /new fleet run/i })

    const notice = within(dialog).getByTestId('fleet-no-roots')
    expect(notice).toHaveTextContent(/no fleet-ready projects/i)
    // The three requirements are stated: git repo, harness rails, opened in Claude Code.
    expect(notice).toHaveTextContent(/git/i)
    expect(notice).toHaveTextContent(/\.harness\/project-state\.yml/i)
    expect(notice).toHaveTextContent(/opened it in claude code/i)
    // And alternatives are suggested for projects without rails.
    expect(notice).toHaveTextContent(/agent teams/i)
  })

  it('shows child cards with branch, cost and status for a running run', async () => {
    stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 1,
          synthesis: 'pending',
        },
      ],
      run: makeRun(),
      escalations: [],
    })
    render(<FleetTab fleetVersion={0} />)

    // Both child cards render with their cwd basename + branch.
    await waitFor(() => expect(screen.getByTestId('fleet-child-0')).toBeInTheDocument())
    const c0 = screen.getByTestId('fleet-child-0')
    expect(within(c0).getByText('a')).toBeInTheDocument()
    expect(within(c0).getByText('fleet/add-oauth-2026/c0')).toBeInTheDocument()
    const c1 = screen.getByTestId('fleet-child-1')
    expect(within(c1).getByText('succeeded')).toBeInTheDocument()
  })

  it('renders a tool escalation banner and routes Allow through /decide (source tool)', async () => {
    const captured = stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 1,
          synthesis: 'pending',
        },
      ],
      run: makeRun(),
      escalations: [ESCALATION],
    })
    render(<FleetTab fleetVersion={0} />)

    // The escalation banner shows the tool, risk and command on child 0.
    await waitFor(() => expect(screen.getByText(/escalation/i)).toBeInTheDocument())
    const c0 = screen.getByTestId('fleet-child-0')
    expect(within(c0).getByText('Bash')).toBeInTheDocument()
    expect(within(c0).getByText('DESTRUCTIVE')).toBeInTheDocument()
    expect(within(c0).getByText('git push --force')).toBeInTheDocument()

    // Allow routes through POST /api/fleet/:id/decide with the tool shape
    // (childIdx + source + approvalId) — NOT the legacy tool-approval path.
    await userEvent.click(within(c0).getByRole('button', { name: /allow/i }))
    await waitFor(() => {
      const decision = captured.find((c) => c.url === '/api/fleet/add-oauth-2026/decide')
      expect(decision).toBeTruthy()
      expect(decision.body).toEqual({
        childIdx: 0,
        source: 'tool',
        decision: 'allow',
        approvalId: 'ap-1',
      })
    })
    // The legacy session tool-approval endpoint must NOT be hit anymore.
    expect(captured.find((c) => c.url === '/api/sessions/sess-a/tool-approval')).toBeFalsy()
  })

  it('routes Deny on a harness escalation through /decide (source harness, requestId)', async () => {
    const captured = stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 1,
          synthesis: 'pending',
        },
      ],
      run: makeRun(),
      escalations: [HARNESS_ESCALATION],
    })
    render(<FleetTab fleetVersion={0} />)

    await waitFor(() => expect(screen.getByText(/escalation/i)).toBeInTheDocument())
    const c0 = screen.getByTestId('fleet-child-0')
    // The source tag identifies this as a harness-surfaced escalation.
    expect(within(c0).getByText('harness')).toBeInTheDocument()
    expect(within(c0).getByText('rm -rf build')).toBeInTheDocument()

    // Deny routes through /decide with the harness shape (requestId, not approvalId).
    await userEvent.click(within(c0).getByRole('button', { name: /deny/i }))
    await waitFor(() => {
      const decision = captured.find((c) => c.url === '/api/fleet/add-oauth-2026/decide')
      expect(decision).toBeTruthy()
      expect(decision.body).toEqual({
        childIdx: 0,
        source: 'harness',
        decision: 'deny',
        requestId: 'req-9',
      })
    })
    expect(captured.find((c) => c.url === '/api/sessions/sess-a/tool-approval')).toBeFalsy()
  })

  it('renders per-child cost (canonical shape), model family, and a persisted escalated status', async () => {
    stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 1,
          synthesis: 'pending',
        },
      ],
      run: makeRun({
        children: [
          {
            idx: 0,
            cwd: 'C:/proj/a',
            prompt: 'Add OAuth to service A',
            workflow: null,
            sessionId: 'sess-a',
            worktree: true,
            branch: 'fleet/add-oauth-2026/c0',
            // Persisted 'escalated' status (now driven by the runner, not just
            // a live escalation), plus the canonical cost shape.
            status: 'escalated',
            cost: {
              totalCost: 2.5,
              breakdown: { input: 1.0, output: 1.0, cacheWrite: 0.3, cacheRead: 0.2 },
              family: 'opus',
            },
            escalation: null,
            error: null,
          },
          {
            idx: 1,
            cwd: 'C:/proj/b',
            prompt: null,
            workflow: 'add-oauth',
            sessionId: 'sess-b',
            worktree: true,
            branch: 'fleet/add-oauth-2026/c1',
            status: 'succeeded',
            cost: null,
            escalation: null,
            error: null,
          },
        ],
      }),
      // No live escalations — the 'escalated' badge must come from child.status.
      escalations: [],
    })
    render(<FleetTab fleetVersion={0} />)

    await waitFor(() => expect(screen.getByTestId('fleet-child-0')).toBeInTheDocument())
    const c0 = screen.getByTestId('fleet-child-0')
    // Cost total formatted from child.cost.totalCost, plus the model family.
    expect(within(c0).getByText('$2.50')).toBeInTheDocument()
    expect(within(c0).getByText('opus')).toBeInTheDocument()
    // 'escalated' status pill is rendered even with no live escalation banner.
    expect(within(c0).getByText('escalated')).toBeInTheDocument()
    expect(within(c0).queryByText(/^escalation$/i)).not.toBeInTheDocument()

    // Child with null cost shows the placeholder dash, not a crash.
    const c1 = screen.getByTestId('fleet-child-1')
    expect(within(c1).getByText('—')).toBeInTheDocument()
  })

  it('renders the synthesis summary when synthesis is done', async () => {
    stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'succeeded',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 2,
          synthesis: 'done',
        },
      ],
      run: makeRun({
        status: 'succeeded',
        synthesis: { status: 'done', summary: 'Merged report: both branches landed OAuth.' },
      }),
      escalations: [],
    })
    render(<FleetTab fleetVersion={0} />)

    await waitFor(() =>
      expect(screen.getByText(/merged report: both branches landed oauth/i)).toBeInTheDocument(),
    )
  })

  it('launches with a budget cap and verify toggle (policy in the POST body)', async () => {
    const captured = stubFleet({ runs: [] })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /new fleet run/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /new fleet run/i })

    await userEvent.type(
      within(dialog).getByPlaceholderText(/what should the fleet accomplish/i),
      'Ship the thing',
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/child 0 working directory/i),
      'C:/proj/a',
    )
    await userEvent.type(within(dialog).getByLabelText(/child 0 prompt/i), 'Do it')
    // Set a budget cap, flip verify on, and quarantine the single child.
    await userEvent.type(within(dialog).getByLabelText(/budget usd/i), '12.5')
    await userEvent.click(within(dialog).getByLabelText(/verify results/i))
    await userEvent.click(within(dialog).getByLabelText(/child 0 quarantine/i))

    await userEvent.click(within(dialog).getByRole('button', { name: /launch fleet/i }))

    await waitFor(() => {
      const post = captured.find((c) => c.url === '/api/fleet')
      expect(post).toBeTruthy()
      expect(post.body.goal).toBe('Ship the thing')
      expect(post.body.policy).toEqual({ budgetUsd: 12.5, verify: true })
      expect(post.body.children).toEqual([{ cwd: 'C:/proj/a', prompt: 'Do it', quarantine: true }])
    })
  })

  it('renders the budget bar, a budget_exceeded run state and a rejected verdict', async () => {
    stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'budget_exceeded',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 2,
          synthesis: 'skipped',
        },
      ],
      run: makeRun({
        status: 'budget_exceeded',
        spentUsd: 10,
        budgetRemaining: 0,
        policy: { maxConcurrency: 4, budgetUsd: 8, verify: true },
        children: [
          {
            idx: 0,
            cwd: 'C:/proj/a',
            prompt: 'Add OAuth to service A',
            workflow: null,
            sessionId: 'sess-a',
            worktree: true,
            branch: 'fleet/add-oauth-2026/c0',
            status: 'rejected',
            quarantine: true,
            cost: { totalCost: 6.0 },
            verdicts: [
              {
                round: 1,
                verifierSessionId: 'ver-1',
                verdict: 'reject',
                reasons: ['No tests added', 'Leaks a secret'],
                at: new Date().toISOString(),
              },
            ],
            escalation: null,
            error: null,
          },
          {
            idx: 1,
            cwd: 'C:/proj/b',
            prompt: null,
            workflow: 'add-oauth',
            sessionId: 'sess-b',
            worktree: true,
            branch: 'fleet/add-oauth-2026/c1',
            status: 'budget_skipped',
            cost: null,
            escalation: null,
            error: null,
          },
        ],
      }),
      escalations: [],
    })
    render(<FleetTab fleetVersion={0} />)

    await waitFor(() => expect(screen.getByTestId('fleet-child-0')).toBeInTheDocument())
    // Budget bar shows spent / cap and the exceeded label.
    const bar = screen.getByTestId('fleet-budget-bar')
    expect(within(bar).getByText('budget exceeded')).toBeInTheDocument()
    expect(within(bar).getByText(/\$10\.00 \/ \$8\.00/)).toBeInTheDocument()

    const c0 = screen.getByTestId('fleet-child-0')
    // The rejected status pill + the verdict row both say 'rejected'.
    expect(within(c0).getAllByText('rejected').length).toBeGreaterThanOrEqual(2)
    // The rejected verdict renders with its reasons in a dedicated verdict row.
    const verdict = within(c0).getByTestId('fleet-verdict-0')
    expect(within(verdict).getByText(/no tests added; leaks a secret/i)).toBeInTheDocument()
    // Quarantine badge present on the child card.
    expect(within(c0).getByTestId('fleet-quarantine-0')).toBeInTheDocument()

    // The skipped child renders its budget_skipped status.
    const c1 = screen.getByTestId('fleet-child-1')
    expect(within(c1).getByText('budget_skipped')).toBeInTheDocument()
  })

  it('saves the form as a template and launches from a saved template', async () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('oauth-fleet')
    const captured = stubFleet({
      runs: [],
      templates: [
        {
          name: 'oauth-fleet',
          goal: 'Add OAuth across services',
          children: [{ cwd: 'C:/proj/a', prompt: 'Add OAuth to A', quarantine: true }],
          policy: { budgetUsd: 20, verify: true },
        },
      ],
    })
    render(<FleetTab fleetVersion={0} />)
    await waitFor(() => expect(screen.getByText(/no fleet runs yet/i)).toBeInTheDocument())

    await userEvent.click(screen.getAllByRole('button', { name: /new fleet run/i })[0])
    const dialog = await screen.findByRole('dialog', { name: /new fleet run/i })

    // Populate the form FROM the saved template via the picker.
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/launch from template/i)).toBeInTheDocument(),
    )
    await userEvent.selectOptions(
      within(dialog).getByLabelText(/launch from template/i),
      'oauth-fleet',
    )
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/child 0 working directory/i)).toHaveValue('C:/proj/a'),
    )

    // 1) Save the populated form as a template — POSTs to /templates (the name
    // comes from the mocked window.prompt).
    await userEvent.click(within(dialog).getByRole('button', { name: /save as template/i }))
    await waitFor(() => {
      const save = captured.find((c) => c.url === '/api/fleet/templates')
      expect(save).toBeTruthy()
      expect(save.body.name).toBe('oauth-fleet')
      expect(save.body.goal).toBe('Add OAuth across services')
      expect(save.body.policy).toEqual({ budgetUsd: 20, verify: true })
      expect(save.body.children).toEqual([
        { cwd: 'C:/proj/a', prompt: 'Add OAuth to A', quarantine: true },
      ])
    })

    // 2) Launch FROM the template (the form is still populated) — POSTs to /api/fleet.
    await userEvent.click(within(dialog).getByRole('button', { name: /launch fleet/i }))
    await waitFor(() => {
      const post = captured.find((c) => c.url === '/api/fleet')
      expect(post).toBeTruthy()
      expect(post.body.goal).toBe('Add OAuth across services')
      expect(post.body.policy).toEqual({ budgetUsd: 20, verify: true })
      expect(post.body.children).toEqual([
        { cwd: 'C:/proj/a', prompt: 'Add OAuth to A', quarantine: true },
      ])
    })
    promptSpy.mockRestore()
  })

  it('fires onOpenSession when a child card open-session link is clicked', async () => {
    const onOpenSession = vi.fn()
    stubFleet({
      runs: [
        {
          id: 'add-oauth-2026',
          goal: 'Add OAuth across services',
          status: 'running',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          childCount: 2,
          settledCount: 1,
          synthesis: 'pending',
        },
      ],
      run: makeRun(),
      escalations: [],
    })
    render(<FleetTab fleetVersion={0} onOpenSession={onOpenSession} />)

    await waitFor(() => expect(screen.getByTestId('fleet-child-0')).toBeInTheDocument())
    const c0 = screen.getByTestId('fleet-child-0')
    await userEvent.click(within(c0).getByRole('button', { name: /open session/i }))
    expect(onOpenSession).toHaveBeenCalledWith('sess-a')
  })
})
