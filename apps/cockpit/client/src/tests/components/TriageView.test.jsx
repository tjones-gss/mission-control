import { render, screen, fireEvent, within } from '@testing-library/react'
import { TriageView } from '../../components/TriageView/TriageView.jsx'

const HOUR = 3_600_000

function makeSession(id, overrides = {}) {
  return {
    sessionId: id,
    cwd: `/home/user/${id}`,
    isActive: false,
    needsInput: false,
    lastText: `last text for ${id}`,
    lastModified: Date.now(),
    model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

function renderView(sessions, props = {}) {
  return render(
    <TriageView
      sessions={sessions}
      selectedId={props.selectedId ?? null}
      onSelect={props.onSelect ?? (() => {})}
    />,
  )
}

describe('TriageView — grouping', () => {
  it('puts needsInput sessions under "Needs you" with a count', () => {
    renderView([
      makeSession('a', { needsInput: true, isActive: true }),
      makeSession('b', { needsInput: true }),
      makeSession('c', { isActive: true }),
    ])
    const needs = screen.getByRole('region', { name: /needs you/i })
    expect(within(needs).getByText('a')).toBeInTheDocument()
    expect(within(needs).getByText('b')).toBeInTheDocument()
    expect(within(needs).queryByText('c')).not.toBeInTheDocument()
  })

  it('puts active non-waiting sessions under "Running"', () => {
    renderView([
      makeSession('a', { needsInput: true, isActive: true }),
      makeSession('c', { isActive: true }),
    ])
    const running = screen.getByRole('region', { name: /running/i })
    expect(within(running).getByText('c')).toBeInTheDocument()
    expect(within(running).queryByText('a')).not.toBeInTheDocument()
  })

  it('puts inactive, non-waiting sessions under "Idle & done"', () => {
    renderView([
      makeSession('old', { isActive: false, lastModified: Date.now() - 2 * HOUR }),
      makeSession('idle', { isActive: false, lastModified: Date.now() }),
    ])
    const calm = screen.getByRole('region', { name: /idle & done/i })
    expect(within(calm).getByText('old')).toBeInTheDocument()
    expect(within(calm).getByText('idle')).toBeInTheDocument()
  })
})

describe('TriageView — needs-you cards', () => {
  it('shows the project slug and the last text as context', () => {
    renderView([makeSession('api-gateway', { needsInput: true, lastText: 'wants to run tests' })])
    expect(screen.getByText('api-gateway')).toBeInTheDocument()
    expect(screen.getByText('wants to run tests')).toBeInTheDocument()
  })

  it('offers the real one-tap reply actions (reuses QuickActions)', () => {
    renderView([makeSession('a', { needsInput: true })])
    const needs = screen.getByRole('region', { name: /needs you/i })
    // QuickActions default replies — the real /api/sessions/:id/message write path
    expect(within(needs).getByText('yes')).toBeInTheDocument()
  })

  it('calls onSelect when a needs-you card is opened', () => {
    const onSelect = vi.fn()
    renderView([makeSession('a', { needsInput: true })], { onSelect })
    fireEvent.click(screen.getByText('a'))
    expect(onSelect).toHaveBeenCalledWith('a')
  })
})

describe('TriageView — empty + calm', () => {
  it('shows an all-clear message when nothing needs the user', () => {
    renderView([makeSession('c', { isActive: true })])
    expect(screen.getByText(/all clear/i)).toBeInTheDocument()
  })

  it('does not crash on an empty session list', () => {
    expect(() => renderView([])).not.toThrow()
  })
})
