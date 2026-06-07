import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { NewHarnessProjectDialog } from '../../components/MissionControlTab/NewHarnessProjectDialog.jsx'

const CANDIDATES = ['C:/work/fresh-app', 'C:/work/another']

function mockCandidates(list) {
  server.use(
    http.get('/api/harness/scaffold-candidates', () => HttpResponse.json({ candidates: list })),
  )
}

describe('NewHarnessProjectDialog', () => {
  it('loads scaffold candidates and lists them in the picker', async () => {
    mockCandidates(CANDIDATES)
    render(<NewHarnessProjectDialog onClose={() => {}} onCreated={() => {}} />)

    const select = await screen.findByLabelText('Directory')
    expect(select).toHaveValue('C:/work/fresh-app') // first is preselected
    expect(screen.getByRole('option', { name: 'C:/work/another' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no eligible directories', async () => {
    mockCandidates([])
    render(<NewHarnessProjectDialog onClose={() => {}} onCreated={() => {}} />)
    expect(await screen.findByText(/No eligible directories/i)).toBeInTheDocument()
    // No create button in the empty state.
    expect(screen.queryByRole('button', { name: /create project/i })).not.toBeInTheDocument()
  })

  it('POSTs the selected path + mode and shows success', async () => {
    mockCandidates(CANDIDATES)
    let received = null
    server.use(
      http.post('/api/harness/create', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json(
          {
            ok: true,
            root: received.projectPath,
            mode: received.mode,
            stage: 'reproduce',
            phase: 'reproduce',
            created: ['.harness/project-state.yml', 'AGENTS.md'],
          },
          { status: 201 },
        )
      }),
    )

    render(<NewHarnessProjectDialog onClose={() => {}} onCreated={() => {}} />)
    const select = await screen.findByLabelText('Directory')
    fireEvent.change(select, { target: { value: 'C:/work/another' } })
    fireEvent.change(screen.getByLabelText('Mode'), { target: { value: 'bugfix' } })
    fireEvent.click(screen.getByRole('button', { name: /create project/i }))

    expect(await screen.findByText(/Harness project created/i)).toBeInTheDocument()
    expect(received).toEqual({ projectPath: 'C:/work/another', mode: 'bugfix' })
    expect(screen.getByText(/2 files written/i)).toBeInTheDocument()
  })

  it('calls onCreated when Done is clicked after success', async () => {
    mockCandidates(CANDIDATES)
    const onCreated = vi.fn()
    render(<NewHarnessProjectDialog onClose={() => {}} onCreated={onCreated} />)
    fireEvent.click(await screen.findByRole('button', { name: /create project/i }))
    const done = await screen.findByRole('button', { name: /done/i })
    fireEvent.click(done)
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('surfaces a server error (e.g. path_not_allowed) without claiming success', async () => {
    mockCandidates(CANDIDATES)
    server.use(
      http.post('/api/harness/create', () =>
        HttpResponse.json({ error: 'path_not_allowed' }, { status: 403 }),
      ),
    )
    render(<NewHarnessProjectDialog onClose={() => {}} onCreated={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /create project/i }))

    expect(await screen.findByText('path_not_allowed')).toBeInTheDocument()
    expect(screen.queryByText(/Harness project created/i)).not.toBeInTheDocument()
  })
})
