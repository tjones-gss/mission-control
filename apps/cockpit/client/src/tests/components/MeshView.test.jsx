import { render, screen, fireEvent } from '@testing-library/react'
import { beforeAll, describe, it, expect, vi } from 'vitest'
import { MeshView } from '../../components/MeshView/index.js'

// jsdom ships neither ResizeObserver nor a useful RAF loop. Stub both at the
// module level (spec §8.3) — the RAF stub deliberately never invokes its
// callback so the packet animation stays inert and tests don't churn timers.
beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
})

describe('MeshView', () => {
  it('renders without crashing for 0 sessions', () => {
    render(<MeshView sessions={[]} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('renders N+1 nodes (sessions + Dispatch hub)', () => {
    const sessions = [
      { id: 'a', projectLabel: 'alpha', status: 'running', totalCost: 1.5, toolCount: 3 },
      { id: 'b', projectLabel: 'beta', status: 'idle', totalCost: 0.8, toolCount: 1 },
    ]
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(document.querySelectorAll('[data-node]').length).toBe(3) // 2 + dispatch hub
  })

  it('hides the detail panel by default', () => {
    render(<MeshView sessions={[]} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })

  it('opens the detail panel when a node is clicked, and Escape closes it', () => {
    const sessions = [
      { id: 'a', projectLabel: 'alpha', status: 'running', totalCost: 1.5, toolCount: 3 },
      { id: 'b', projectLabel: 'beta', status: 'idle', totalCost: 0.8, toolCount: 1 },
    ]
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)

    fireEvent.click(document.querySelectorAll('[data-node]')[1])
    expect(document.querySelector('[data-panel]')).toHaveClass('open')

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })

  it('"Open in Triage" fires onSelectSession with the session id and closes the panel', () => {
    const onSelectSession = vi.fn()
    const sessions = [
      { id: 'a', projectLabel: 'alpha', status: 'running', totalCost: 1.5, toolCount: 3 },
    ]
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={onSelectSession} />)

    fireEvent.click(document.querySelectorAll('[data-node]')[1]) // the session node
    expect(document.querySelector('[data-panel]')).toHaveClass('open')

    fireEvent.click(screen.getByText('Open in Triage'))
    expect(onSelectSession).toHaveBeenCalledWith('a')
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })

  it('clicking the Dispatch hub does not open the panel', () => {
    const sessions = [
      { id: 'a', projectLabel: 'alpha', status: 'running', totalCost: 1.5, toolCount: 3 },
    ]
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)

    fireEvent.click(document.querySelector('[data-node="__dispatch"]'))
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })

  it('renders 82 sessions (plus hub) without error', () => {
    const sessions = Array.from({ length: 82 }, (_, i) => ({
      id: `s${i}`,
      projectLabel: `proj-${i}`,
      status: ['running', 'idle', 'done', 'error'][i % 4],
      totalCost: i * 0.1,
      toolCount: i,
    }))
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(document.querySelectorAll('[data-node]').length).toBe(83)
  })
})
