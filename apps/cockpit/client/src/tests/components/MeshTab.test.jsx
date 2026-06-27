import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { MeshTab, snrTier, relativeTime } from '../../components/MeshTab/MeshTab.jsx'

const NODES = [
  { nodeId: '!aaa', shortName: 'BASE', snr: 12.5, lastHeard: 1719360000, battery: 87, hopLimit: 0 },
  { nodeId: '!bbb', shortName: 'RELAY', snr: 7, lastHeard: 1719360000, battery: 50, hopLimit: 2 },
  { nodeId: '!ccc', shortName: 'EDGE', snr: 2, lastHeard: 1719360000, battery: null, hopLimit: 4 },
]

function mockNodes(payload) {
  server.use(http.get('/api/mesh/nodes', () => HttpResponse.json(payload)))
}

describe('snrTier()', () => {
  it('maps SNR to green/amber/red tiers at the 10dB and 5dB thresholds', () => {
    expect(snrTier(12.5)).toBe('green')
    expect(snrTier(10)).toBe('green')
    expect(snrTier(7)).toBe('amber')
    expect(snrTier(5)).toBe('amber')
    expect(snrTier(2)).toBe('red')
  })

  it('treats a missing SNR as unknown rather than green', () => {
    expect(snrTier(null)).toBe('unknown')
    expect(snrTier(undefined)).toBe('unknown')
  })
})

describe('relativeTime()', () => {
  it('renders unix-second timestamps as a relative "ago" string', () => {
    const now = 1719360120 * 1000 // 2 minutes after the fixture timestamp
    expect(relativeTime(1719360000, now)).toMatch(/2m ago/)
  })

  it('renders an em dash for a missing timestamp', () => {
    expect(relativeTime(null, Date.now())).toBe('—')
  })
})

describe('MeshTab', () => {
  it('shows a loading state before the fetch resolves', () => {
    mockNodes({ nodes: [], degraded: false })
    render(<MeshTab />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('renders a card per node with name, battery and hop count', async () => {
    mockNodes({ nodes: NODES, degraded: false })
    render(<MeshTab />)

    expect(await screen.findByText('BASE')).toBeInTheDocument()
    expect(screen.getByText('RELAY')).toBeInTheDocument()
    expect(screen.getByText('EDGE')).toBeInTheDocument()

    const base = screen.getByTestId('mesh-node-!aaa')
    expect(within(base).getByText(/87%/)).toBeInTheDocument()
  })

  it('color-codes each card by its SNR tier', async () => {
    mockNodes({ nodes: NODES, degraded: false })
    render(<MeshTab />)
    await screen.findByText('BASE')

    expect(screen.getByTestId('mesh-node-!aaa')).toHaveAttribute('data-snr-tier', 'green')
    expect(screen.getByTestId('mesh-node-!bbb')).toHaveAttribute('data-snr-tier', 'amber')
    expect(screen.getByTestId('mesh-node-!ccc')).toHaveAttribute('data-snr-tier', 'red')
  })

  it('shows the empty state pointing at MESHTASTIC_DATA_PATH when there are no nodes', async () => {
    mockNodes({ nodes: [], degraded: true })
    render(<MeshTab />)
    expect(await screen.findByText(/MESHTASTIC_DATA_PATH/)).toBeInTheDocument()
  })
})
