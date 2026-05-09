import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { ConductorTab } from '../../components/ConductorTab/ConductorTab.jsx'

const RUN_RUNNING = {
  projectPath: 'C:\\projects\\foo',
  projectLabel: 'foo',
  adr: '0011',
  phase: 'build',
  startedAt: '2026-05-01T00:00:00Z',
  currentTaskId: 't-1',
  taskIters: { 't-1': 2 },
  splits: {},
  acceptanceCommandsRequired: ['npm test'],
  acceptanceCommandsRun: [],
  escalationReason: null,
  isPaused: false,
  hasJournalDraft: false,
  hasRatificationProposal: false,
  hasSkillDiffProposal: false,
  paths: {
    status: '',
    plan: '',
    events: '',
    journalDraft: '',
    ratificationProposal: '',
    skillDiffProposal: '',
  },
}

const RUN_PAUSED = {
  ...RUN_RUNNING,
  adr: '0012',
  phase: 'escalated',
  escalationReason: 'OAuth login required',
  isPaused: true,
  hasRatificationProposal: true,
}

function setupRuns(runs) {
  server.use(http.get('/api/conductor', () => HttpResponse.json(runs)))
}

describe('ConductorTab — list', () => {
  it('renders empty state when there are no runs', async () => {
    setupRuns([])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/no conductor runs/i)).toBeInTheDocument())
  })

  it('renders run rows grouped by project', async () => {
    setupRuns([RUN_RUNNING, RUN_PAUSED])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    // Both ADR labels appear in the master pane
    await waitFor(() => expect(screen.getAllByText(/ADR 0011/i).length).toBeGreaterThan(0))
    expect(screen.getAllByText(/ADR 0012/i).length).toBeGreaterThan(0)
    // Project label header shows once
    expect(screen.getAllByText('foo').length).toBeGreaterThan(0)
  })
})

describe('ConductorTab — detail pane', () => {
  it('shows phase pill and current task for the selected run', async () => {
    setupRuns([RUN_RUNNING])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getAllByText(/ADR 0011/i).length).toBeGreaterThan(0))
    // The "build" phase appears at least once (master row badge + detail header)
    expect(screen.getAllByText('build').length).toBeGreaterThan(0)
    // Iter card
    expect(screen.getByText('2 / 5')).toBeInTheDocument()
  })

  it('renders the paused banner when isPaused with the escalation reason', async () => {
    setupRuns([RUN_PAUSED])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/Paused/i)).toBeInTheDocument())
    expect(screen.getByText(/OAuth login required/i)).toBeInTheDocument()
  })

  it('shows acceptance commands as a checklist', async () => {
    setupRuns([RUN_RUNNING])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText('npm test')).toBeInTheDocument())
  })
})

describe('ConductorTab — Start dialog', () => {
  it('opens the launcher dialog when Start is clicked', async () => {
    setupRuns([])
    render(<ConductorTab conductorVersion={0} sessions={[]} />)
    await waitFor(() => screen.getByText(/no conductor runs/i))
    await userEvent.click(screen.getByRole('button', { name: /start/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/Start Conductor run/i)).toBeInTheDocument()
  })

  it('disables submit until ADR is 4 digits', async () => {
    setupRuns([])
    render(
      <ConductorTab
        conductorVersion={0}
        sessions={[{ cwd: 'C:\\projects\\foo', lastModified: 1 }]}
      />,
    )
    await waitFor(() => screen.getByText(/no conductor runs/i))
    await userEvent.click(screen.getByRole('button', { name: /start/i }))
    const submit = screen.getByRole('button', { name: /Run \/conductor/i })
    expect(submit).toBeDisabled()

    const adrInput = screen.getByPlaceholderText('0012')
    await userEvent.type(adrInput, '12') // only 2 digits — still invalid
    expect(submit).toBeDisabled()

    await userEvent.type(adrInput, '34') // now 4 digits → valid
    expect(submit).not.toBeDisabled()
  })
})
