import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { PipelineCanvas } from '../../components/PipelineCanvas/index.js'

// Default fetch: GET /api/pipelines (load list on mount) returns empty; POSTs ok.
function stubFetch(impl) {
  const fn = vi.fn(
    impl || (async () => ({ ok: true, status: 200, json: async () => ({ pipelines: [] }) })),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  stubFetch()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('PipelineCanvas', () => {
  it('shows the empty-state instruction prompt when there are no nodes', () => {
    render(<PipelineCanvas />)
    expect(screen.getByTestId('pipeline-empty-prompt')).toBeInTheDocument()
  })

  it('renders a palette with all seven node types', () => {
    render(<PipelineCanvas />)
    const palette = document.querySelectorAll('[data-palette-type]')
    expect(palette.length).toBe(7)
  })

  it('adds a node to the canvas when a palette type is clicked, and hides the empty prompt', () => {
    render(<PipelineCanvas />)
    fireEvent.click(document.querySelector('[data-palette-type="agent"]'))
    expect(document.querySelectorAll('[data-node]').length).toBe(1)
    expect(screen.queryByTestId('pipeline-empty-prompt')).not.toBeInTheDocument()
  })

  it('disables Run Pipeline until at least one agent node exists', () => {
    render(<PipelineCanvas />)
    const run = screen.getByRole('button', { name: /run pipeline/i })
    expect(run).toBeDisabled()
    fireEvent.click(document.querySelector('[data-palette-type="agent"]'))
    expect(run).toBeEnabled()
  })

  it('serialises the canvas and POSTs to /api/fleet when Run Pipeline is clicked', async () => {
    const fetchFn = stubFetch(async (url) => {
      if (String(url).includes('/api/fleet')) {
        return { ok: true, status: 202, json: async () => ({ ok: true, id: 'run-1' }) }
      }
      return { ok: true, status: 200, json: async () => ({ pipelines: [] }) }
    })
    render(<PipelineCanvas />)
    fireEvent.click(document.querySelector('[data-palette-type="agent"]'))
    fireEvent.click(screen.getByRole('button', { name: /run pipeline/i }))

    await waitFor(() => {
      const fleetCall = fetchFn.mock.calls.find((c) => String(c[0]).includes('/api/fleet'))
      expect(fleetCall).toBeTruthy()
      const body = JSON.parse(fleetCall[1].body)
      expect(Array.isArray(body.children)).toBe(true)
      expect(body.children).toHaveLength(1)
      expect(typeof body.children[0].cwd).toBe('string')
      expect(typeof body.children[0].prompt).toBe('string')
      expect(typeof body.goal).toBe('string')
      expect(body.policy).toBeTruthy()
    })
  })

  it('POSTs the canvas to /api/pipelines when Save is clicked', async () => {
    const fetchFn = stubFetch(async (url, opts) => {
      if (String(url).includes('/api/pipelines') && opts && opts.method === 'POST') {
        return { ok: true, status: 200, json: async () => ({ ok: true, pipeline: {} }) }
      }
      return { ok: true, status: 200, json: async () => ({ pipelines: [] }) }
    })
    render(<PipelineCanvas />)
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: 'My flow' } })
    fireEvent.click(document.querySelector('[data-palette-type="trigger"]'))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => {
      const saveCall = fetchFn.mock.calls.find(
        (c) => String(c[0]).includes('/api/pipelines') && c[1] && c[1].method === 'POST',
      )
      expect(saveCall).toBeTruthy()
      const body = JSON.parse(saveCall[1].body)
      expect(body.name).toBe('My flow')
      expect(Array.isArray(body.nodes)).toBe(true)
      expect(body.nodes.length).toBe(1)
    })
  })

  it('applies the runtime status as a data-status attribute on the matching node', () => {
    render(<PipelineCanvas />)
    fireEvent.click(document.querySelector('[data-palette-type="agent"]'))
    const node = document.querySelector('[data-node]')
    const id = node.getAttribute('data-node-id')
    // Re-render with a runtime status for that node.
    render(
      <PipelineCanvas
        runtimeStatus={{ [id]: 'done' }}
        initialNodes={[{ id, type: 'agent', x: 0, y: 0, config: { goal: '' } }]}
      />,
    )
    const statused = document.querySelector(`[data-node-id="${id}"][data-status="done"]`)
    expect(statused).toBeTruthy()
  })
})
