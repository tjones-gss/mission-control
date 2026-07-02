import { render, screen, fireEvent, act } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { AnomalyToast } from '../../components/AnomalyToast.jsx'
import { AnomalyPanel } from '../../components/AnomalyPanel.jsx'

const mk = (over = {}) => ({
  id: 'a1',
  sessionId: 's1',
  kind: 'stall',
  detail: 'No activity for 6m while mid-task.',
  ts: 1700000000000,
  ...over,
})

afterEach(() => {
  vi.useRealTimers()
})

describe('AnomalyToast', () => {
  it('renders nothing when there are no anomalies', () => {
    const { container } = render(<AnomalyToast anomalies={[]} />)
    expect(container.querySelector('[data-testid="anomaly-toast"]')).toBeNull()
  })

  it('renders one toast per anomaly with its detail text', () => {
    render(
      <AnomalyToast anomalies={[mk(), mk({ id: 'a2', kind: 'budget', detail: 'Over budget.' })]} />,
    )
    const toasts = screen.getAllByTestId('anomaly-toast')
    expect(toasts.length).toBe(2)
    expect(screen.getByText('No activity for 6m while mid-task.')).toBeInTheDocument()
    expect(screen.getByText('Over budget.')).toBeInTheDocument()
  })

  it('shows a human-readable label for the anomaly kind', () => {
    render(<AnomalyToast anomalies={[mk({ kind: 'approval' })]} />)
    // Some label for the kind is present (not the raw enum on its own line only).
    expect(screen.getByTestId('anomaly-toast')).toHaveTextContent(/approval/i)
  })

  it('calls onOpen with the sessionId when the toast body is clicked', () => {
    const onOpen = vi.fn()
    render(<AnomalyToast anomalies={[mk()]} onOpen={onOpen} />)
    fireEvent.click(screen.getByTestId('anomaly-toast'))
    expect(onOpen).toHaveBeenCalledWith('s1')
  })

  it('calls onDismiss (not onOpen) when the dismiss button is clicked', () => {
    const onOpen = vi.fn()
    const onDismiss = vi.fn()
    render(<AnomalyToast anomalies={[mk()]} onOpen={onOpen} onDismiss={onDismiss} />)
    fireEvent.click(screen.getByLabelText('Dismiss'))
    expect(onDismiss).toHaveBeenCalledWith('a1')
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('renders the loop_detected message from its count and tool fields', () => {
    render(
      <AnomalyToast
        anomalies={[mk({ kind: 'loop_detected', count: 3, tool: 'bash', detail: undefined })]}
      />,
    )
    expect(
      screen.getByText('Agent looping: 3 consecutive bash calls — review and steer'),
    ).toBeInTheDocument()
  })

  it('renders the cost_runway message — approaching limit when not critical', () => {
    render(
      <AnomalyToast
        anomalies={[mk({ kind: 'cost_runway', pct: 80, critical: false, detail: undefined })]}
      />,
    )
    expect(screen.getByText('Budget runway: 80% consumed — approaching limit')).toBeInTheDocument()
  })

  it('renders the cost_runway message — ceiling imminent when critical', () => {
    render(
      <AnomalyToast
        anomalies={[mk({ kind: 'cost_runway', pct: 95, critical: true, detail: undefined })]}
      />,
    )
    expect(screen.getByText('Budget runway: 95% consumed — ceiling imminent')).toBeInTheDocument()
  })

  it('auto-dismisses after 8 seconds', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<AnomalyToast anomalies={[mk()]} onDismiss={onDismiss} />)
    expect(onDismiss).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(onDismiss).toHaveBeenCalledWith('a1')
  })
})

describe('AnomalyPanel', () => {
  it('renders anomaly states and supports acknowledge then resolve callbacks', () => {
    const onAcknowledge = vi.fn()
    const onResolve = vi.fn()
    render(
      <AnomalyPanel
        open
        anomalies={[mk({ state: 'new' })]}
        onClose={() => {}}
        onAcknowledge={onAcknowledge}
        onResolve={onResolve}
      />,
    )

    expect(screen.getByText('new')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }))
    expect(onAcknowledge).toHaveBeenCalledWith('a1')
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }))
    expect(onResolve).toHaveBeenCalledWith('a1')
  })

  it('opens the related session from a row', () => {
    const onOpenSession = vi.fn()
    render(
      <AnomalyPanel
        open
        anomalies={[mk({ state: 'acknowledged' })]}
        onClose={() => {}}
        onOpenSession={onOpenSession}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /open/i }))
    expect(onOpenSession).toHaveBeenCalledWith('s1')
  })
})
