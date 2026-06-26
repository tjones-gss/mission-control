import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChildCard } from '../../components/FleetTab/FleetRunCard.jsx'

function makeChild(overrides = {}) {
  return {
    idx: 0,
    cwd: 'C:/proj/a',
    sessionId: 'sess-a',
    worktree: true,
    branch: 'fleet/run/c0',
    status: 'running',
    cost: { totalCost: 2.5, family: 'opus' },
    error: null,
    ...overrides,
  }
}

const ESCALATION = {
  childIdx: 0,
  source: 'tool',
  approvalId: 'ap-1',
  tool: 'Bash',
  command: 'git push --force',
  riskLevel: 'DESTRUCTIVE',
}

describe('ChildCard', () => {
  it('renders cwd basename, branch, cost and model family', () => {
    render(
      <ChildCard child={makeChild()} escalations={[]} onDecide={vi.fn()} onOpenSession={vi.fn()} />,
    )
    const card = screen.getByTestId('fleet-child-0')
    expect(within(card).getByText('a')).toBeInTheDocument()
    expect(within(card).getByText('fleet/run/c0')).toBeInTheDocument()
    expect(within(card).getByText('$2.50')).toBeInTheDocument()
    expect(within(card).getByText('opus')).toBeInTheDocument()
  })

  it('shows a placeholder dash when cost is null', () => {
    render(
      <ChildCard
        child={makeChild({ cost: null })}
        escalations={[]}
        onDecide={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    )
    expect(within(screen.getByTestId('fleet-child-0')).getByText('—')).toBeInTheDocument()
  })

  it('renders a quarantine badge when quarantined', () => {
    render(
      <ChildCard
        child={makeChild({ quarantine: true })}
        escalations={[]}
        onDecide={vi.fn()}
        onOpenSession={vi.fn()}
      />,
    )
    expect(screen.getByTestId('fleet-quarantine-0')).toBeInTheDocument()
  })

  it('renders verdict rows with reasons', () => {
    const child = makeChild({
      status: 'rejected',
      verdicts: [{ round: 1, verdict: 'reject', reasons: ['No tests added', 'Leaks a secret'] }],
    })
    render(<ChildCard child={child} escalations={[]} onDecide={vi.fn()} onOpenSession={vi.fn()} />)
    const verdict = screen.getByTestId('fleet-verdict-0')
    expect(within(verdict).getByText(/no tests added; leaks a secret/i)).toBeInTheDocument()
  })

  it('renders an escalation banner and routes Allow through onDecide', async () => {
    const onDecide = vi.fn().mockResolvedValue(undefined)
    render(
      <ChildCard
        child={makeChild()}
        escalations={[ESCALATION]}
        onDecide={onDecide}
        onOpenSession={vi.fn()}
      />,
    )
    const card = screen.getByTestId('fleet-child-0')
    expect(within(card).getByText('Bash')).toBeInTheDocument()
    expect(within(card).getByText('git push --force')).toBeInTheDocument()
    await userEvent.click(within(card).getByRole('button', { name: /allow/i }))
    await waitFor(() => expect(onDecide).toHaveBeenCalledWith(ESCALATION, 'allow'))
  })

  it('fires onOpenSession when the open-session link is clicked', async () => {
    const onOpenSession = vi.fn()
    render(
      <ChildCard
        child={makeChild()}
        escalations={[]}
        onDecide={vi.fn()}
        onOpenSession={onOpenSession}
      />,
    )
    await userEvent.click(
      within(screen.getByTestId('fleet-child-0')).getByRole('button', { name: /open session/i }),
    )
    expect(onOpenSession).toHaveBeenCalledWith('sess-a')
  })
})
