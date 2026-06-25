import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { RunsTab } from '../../components/RunsTab/RunsTab.jsx'

// Both surfaces are reused as-is; we only assert that the mode switch swaps
// between MissionControlTab (Missions) and ConductorTab (Conductor). We stub
// each surface's data endpoint with an empty payload so the recognizable empty
// state of each renders without pulling in their full internals.
function setup() {
  server.use(
    http.get('/api/harness', () => HttpResponse.json({ projects: [] })),
    http.get('/api/conductor', () => HttpResponse.json([])),
  )
}

describe('RunsTab — mode switch', () => {
  it('renders the Missions surface by default', async () => {
    setup()
    render(<RunsTab harnessVersion={0} conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/no governed projects found/i)).toBeInTheDocument())
    // Conductor surface should not be mounted yet
    expect(screen.queryByText(/no conductor runs detected/i)).not.toBeInTheDocument()
  })

  it('switches to the Conductor surface when its mode is selected', async () => {
    setup()
    render(<RunsTab harnessVersion={0} conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/no governed projects found/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /conductor/i }))

    await waitFor(() => expect(screen.getByText(/no conductor runs detected/i)).toBeInTheDocument())
    // Missions surface should be unmounted now
    expect(screen.queryByText(/no governed projects found/i)).not.toBeInTheDocument()
  })

  it('switches back to the Missions surface', async () => {
    setup()
    render(<RunsTab harnessVersion={0} conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/no governed projects found/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /conductor/i }))
    await waitFor(() => expect(screen.getByText(/no conductor runs detected/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /missions/i }))
    await waitFor(() => expect(screen.getByText(/no governed projects found/i)).toBeInTheDocument())
  })

  it('switches to the Pipeline canvas mode (a mode inside Runs, not a sibling tab)', async () => {
    setup()
    server.use(http.get('/api/pipelines', () => HttpResponse.json({ pipelines: [] })))
    render(<RunsTab harnessVersion={0} conductorVersion={0} sessions={[]} />)
    await waitFor(() => expect(screen.getByText(/no governed projects found/i)).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /pipeline/i }))

    await waitFor(() => expect(screen.getByTestId('pipeline-empty-prompt')).toBeInTheDocument())
    // Missions surface should be unmounted now
    expect(screen.queryByText(/no governed projects found/i)).not.toBeInTheDocument()
  })
})
