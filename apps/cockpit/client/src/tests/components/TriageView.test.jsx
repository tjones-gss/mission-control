import { render, screen, fireEvent, within, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
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

describe('TriageView — meta build banner (S1)', () => {
  it('shows the "Building Oversight" banner when a meta session is present', () => {
    renderView([makeSession('a', { meta: true, isActive: true }), makeSession('b')])
    expect(screen.getByText(/building oversight/i)).toBeInTheDocument()
  })

  it('does not show the banner when no session is meta', () => {
    renderView([makeSession('a', { isActive: true }), makeSession('b')])
    expect(screen.queryByText(/building oversight/i)).not.toBeInTheDocument()
  })
})

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

  it('renders a Destructive badge when the summary carries riskLevel DESTRUCTIVE', () => {
    renderView([
      makeSession('api-gateway', {
        needsInput: true,
        riskLevel: 'DESTRUCTIVE',
        riskDescription: 'Recursive force remove',
      }),
    ])
    const badge = screen.getByText('Destructive')
    expect(badge).toBeInTheDocument()
    expect(badge).toHaveAttribute('title', 'Recursive force remove')
  })

  it('renders review/code badges for the lesser risk levels', () => {
    renderView([
      makeSession('a', { needsInput: true, riskLevel: 'REQUIRES_REVIEW' }),
      makeSession('b', { needsInput: true, riskLevel: 'CODE_EXECUTION' }),
    ])
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByText('Runs code')).toBeInTheDocument()
  })

  it('renders NO risk badge when riskLevel is null or safe (never fabricated)', () => {
    renderView([
      makeSession('clean', { needsInput: true, riskLevel: null }),
      makeSession('safe', { needsInput: true, riskLevel: 'SAFE_READONLY' }),
    ])
    expect(screen.queryByText('Destructive')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs review')).not.toBeInTheDocument()
    expect(screen.queryByText('Runs code')).not.toBeInTheDocument()
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

  it('surfaces a smart suggestion chip from the session transcript', async () => {
    server.use(
      http.get('/api/sessions/:sessionId/messages', () =>
        HttpResponse.json({
          sessionId: 'a',
          messages: [{ type: 'assistant', blocks: [{ type: 'text', text: 'Should I proceed?' }] }],
        }),
      ),
    )
    renderView([makeSession('a', { needsInput: true })])
    await waitFor(() => expect(screen.getByText(/go ahead/i)).toBeInTheDocument())
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
