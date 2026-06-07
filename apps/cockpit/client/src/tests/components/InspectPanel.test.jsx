import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Mock the four inspector children so we can assert InspectPanel mounts the
// right one per sub-tab and threads the matching live-refetch version prop down.
vi.mock('../../components/ConfigViewer.jsx', () => ({
  ConfigViewer: ({ sessionId, configVersion }) => (
    <div data-testid="config-viewer" data-session={sessionId} data-version={configVersion} />
  ),
}))
vi.mock('../../components/HooksPanel.jsx', () => ({
  HooksPanel: ({ hooksVersion }) => <div data-testid="hooks-panel" data-version={hooksVersion} />,
}))
vi.mock('../../components/McpDashboard.jsx', () => ({
  McpDashboard: () => <div data-testid="mcp-dashboard" />,
}))
vi.mock('../../components/MemoryViewer.jsx', () => ({
  MemoryViewer: ({ sessionId, memoryVersion }) => (
    <div data-testid="memory-viewer" data-session={sessionId} data-version={memoryVersion} />
  ),
}))

import { InspectPanel } from '../../components/InspectPanel/InspectPanel.jsx'

describe('InspectPanel', () => {
  it('renders all four section tabs', () => {
    render(<InspectPanel sessionId="abc" />)
    expect(screen.getByText('config')).toBeInTheDocument()
    expect(screen.getByText('hooks')).toBeInTheDocument()
    expect(screen.getByText('mcp')).toBeInTheDocument()
    expect(screen.getByText('memory')).toBeInTheDocument()
  })

  it('shows config section by default and threads configVersion + sessionId', () => {
    render(<InspectPanel sessionId="abc" configVersion={3} />)
    const viewer = screen.getByTestId('config-viewer')
    expect(viewer).toBeInTheDocument()
    expect(viewer).toHaveAttribute('data-session', 'abc')
    expect(viewer).toHaveAttribute('data-version', '3')
  })

  it('clicking hooks shows the hooks panel and threads hooksVersion', async () => {
    render(<InspectPanel sessionId="abc" hooksVersion={5} />)
    await userEvent.click(screen.getByText('hooks'))
    const panel = screen.getByTestId('hooks-panel')
    expect(panel).toBeInTheDocument()
    expect(panel).toHaveAttribute('data-version', '5')
  })

  it('clicking mcp shows the MCP dashboard', async () => {
    render(<InspectPanel sessionId="abc" />)
    await userEvent.click(screen.getByText('mcp'))
    expect(screen.getByTestId('mcp-dashboard')).toBeInTheDocument()
  })

  it('clicking memory shows the memory viewer and threads memoryVersion + sessionId', async () => {
    render(<InspectPanel sessionId="abc" memoryVersion={7} />)
    await userEvent.click(screen.getByText('memory'))
    const viewer = screen.getByTestId('memory-viewer')
    expect(viewer).toBeInTheDocument()
    expect(viewer).toHaveAttribute('data-session', 'abc')
    expect(viewer).toHaveAttribute('data-version', '7')
  })
})
