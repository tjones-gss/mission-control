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
      {
        id: 'a',
        projectLabel: 'alpha',
        status: 'running',
        isActive: true,
        totalCost: 1.5,
        toolCount: 3,
      },
      {
        id: 'b',
        projectLabel: 'beta',
        status: 'idle',
        lastActivityAt: Date.now(),
        totalCost: 0.8,
        toolCount: 1,
      },
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
      {
        id: 'a',
        projectLabel: 'alpha',
        status: 'running',
        isActive: true,
        totalCost: 1.5,
        toolCount: 3,
      },
      {
        id: 'b',
        projectLabel: 'beta',
        status: 'idle',
        lastActivityAt: Date.now(),
        totalCost: 0.8,
        toolCount: 1,
      },
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
      {
        id: 'a',
        projectLabel: 'alpha',
        status: 'running',
        isActive: true,
        totalCost: 1.5,
        toolCount: 3,
      },
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
      {
        id: 'a',
        projectLabel: 'alpha',
        status: 'running',
        isActive: true,
        totalCost: 1.5,
        toolCount: 3,
      },
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
      lastActivityAt: Date.now(),
      totalCost: i * 0.1,
      toolCount: i,
    }))
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(document.querySelectorAll('[data-node]').length).toBe(83)
  })
})

describe('MeshView — V3 real tool_call packets', () => {
  const sessions = [
    {
      id: 'a',
      projectLabel: 'alpha',
      status: 'running',
      isActive: true,
      totalCost: 1,
      toolCount: 2,
    },
  ]

  it('spawns a real packet when a tool_call arrives for a session in the mesh', () => {
    const { rerender } = render(
      <MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />,
    )
    expect(document.querySelectorAll('[data-packet-real]').length).toBe(0)
    rerender(
      <MeshView
        sessions={sessions}
        sessionsVersion={0}
        onSelectSession={() => {}}
        lastToolCall={{ sessionId: 'a', tool: 'Bash', ts: 123 }}
      />,
    )
    expect(document.querySelectorAll('[data-packet-real]').length).toBe(1)
  })

  it('ignores a tool_call for a session not in the mesh', () => {
    const { rerender } = render(
      <MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />,
    )
    rerender(
      <MeshView
        sessions={sessions}
        sessionsVersion={0}
        onSelectSession={() => {}}
        lastToolCall={{ sessionId: 'ghost', tool: 'Bash', ts: 9 }}
      />,
    )
    expect(document.querySelectorAll('[data-packet-real]').length).toBe(0)
  })

  it('spawns a fresh packet for each new tool_call (by ts) on the same session', () => {
    const { rerender } = render(
      <MeshView
        sessions={sessions}
        sessionsVersion={0}
        onSelectSession={() => {}}
        lastToolCall={{ sessionId: 'a', tool: 'Bash', ts: 1 }}
      />,
    )
    expect(document.querySelectorAll('[data-packet-real]').length).toBe(1)
    rerender(
      <MeshView
        sessions={sessions}
        sessionsVersion={0}
        onSelectSession={() => {}}
        lastToolCall={{ sessionId: 'a', tool: 'Read', ts: 2 }}
      />,
    )
    expect(document.querySelectorAll('[data-packet-real]').length).toBe(2)
  })

  it('does not crash and renders the mesh when no lastToolCall is provided (simulated fallback path)', () => {
    render(<MeshView sessions={sessions} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })
})

describe('MeshView — V2 clarity pass', () => {
  const HOUR = 60 * 60 * 1000
  const NOW = Date.now()

  // 2 active, 1 recent-idle, 2 old (>24h) — the §2 reference fixture.
  const mixed = () => [
    {
      id: 'act1',
      projectLabel: 'act1',
      status: 'running',
      isActive: true,
      totalCost: 1,
      toolCount: 4,
    },
    {
      id: 'act2',
      projectLabel: 'act2',
      status: 'running',
      isActive: true,
      totalCost: 2,
      toolCount: 1,
    },
    {
      id: 'rec1',
      projectLabel: 'rec1',
      status: 'idle',
      lastActivityAt: NOW - 2 * HOUR,
      totalCost: 0.5,
    },
    {
      id: 'old1',
      projectLabel: 'old1',
      status: 'done',
      lastActivityAt: NOW - 30 * HOUR,
      totalCost: 0.1,
    },
    {
      id: 'old2',
      projectLabel: 'old2',
      status: 'done',
      lastActivityAt: NOW - 48 * HOUR,
      totalCost: 0.1,
    },
  ]

  const sessionNodes = () => document.querySelectorAll('[data-node]:not([data-node="__dispatch"])')

  // --- Recency filter -------------------------------------------------------

  it('renders only active/recent sessions when filter is "active"', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(sessionNodes().length).toBe(3) // 2 active + 1 recent, 2 old hidden
  })

  it('shows all sessions when filter is "all"', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(sessionNodes().length).toBe(5)
  })

  it('shows empty state when no recent sessions', () => {
    const old = [
      { id: 'o1', projectLabel: 'o1', status: 'done', lastActivityAt: NOW - 30 * HOUR },
      { id: 'o2', projectLabel: 'o2', status: 'done', lastActivityAt: NOW - 40 * HOUR },
      { id: 'o3', projectLabel: 'o3', status: 'done', lastActivityAt: NOW - 50 * HOUR },
    ]
    render(<MeshView sessions={old} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(screen.getByText(/No active sessions in the last 24h/i)).toBeInTheDocument()
    expect(sessionNodes().length).toBe(0)
  })

  it('toggle switches between active and all views', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(sessionNodes().length).toBe(3)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(sessionNodes().length).toBe(5)
    fireEvent.click(screen.getByRole('button', { name: 'Active' }))
    expect(sessionNodes().length).toBe(3)
  })

  // --- Activity-tiered node sizing -----------------------------------------

  const shapeR = (id) =>
    document.querySelector(`[data-node="${id}"] circle:not(.mesh-pulse)`)?.getAttribute('r')

  it('active session node has radius 28', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(shapeR('act1')).toBe('28')
  })

  it('old session node has radius 6', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(shapeR('old1')).toBe('6')
  })

  it('active sessions render in inner tier positions (closer to center than recent)', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    const dist = (id) => {
      const c = document.querySelector(`[data-node="${id}"] circle:not(.mesh-pulse)`)
      const cx = Number(c.getAttribute('cx'))
      const cy = Number(c.getAttribute('cy'))
      // default canvas is 800×600 → center (400, 300)
      return Math.hypot(cx - 400, cy - 300)
    }
    expect(dist('act1')).toBeLessThan(dist('rec1'))
  })

  // --- Node-detail drawer ---------------------------------------------------

  it('drawer is hidden when no node is selected', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })

  it('clicking a node opens the detail drawer', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    fireEvent.click(document.querySelector('[data-node="act1"]'))
    expect(document.querySelector('[data-panel]')).toHaveClass('open')
  })

  it('drawer shows session name and status', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    fireEvent.click(document.querySelector('[data-node="act1"]'))
    const panel = document.querySelector('[data-panel]')
    expect(panel).toHaveTextContent('act1')
    expect(panel).toHaveTextContent('running')
  })

  it('closing the drawer hides it', () => {
    render(<MeshView sessions={mixed()} sessionsVersion={0} onSelectSession={() => {}} />)
    fireEvent.click(document.querySelector('[data-node="act1"]'))
    expect(document.querySelector('[data-panel]')).toHaveClass('open')
    fireEvent.click(screen.getByText(/Close/i))
    expect(document.querySelector('[data-panel]')).not.toHaveClass('open')
  })
})
