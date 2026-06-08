import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { AddRailsDialog } from '../../components/MissionControlTab/AddRailsDialog.jsx'

const CANDIDATES = ['C:/work/app-without-rails', 'C:/work/another']

function mockCandidates(list) {
  server.use(http.get('/api/rails/adopt-candidates', () => HttpResponse.json({ candidates: list })))
}

describe('AddRailsDialog', () => {
  it('loads adopt candidates into the picker', async () => {
    mockCandidates(CANDIDATES)
    render(<AddRailsDialog onClose={() => {}} onAdopted={() => {}} />)
    const select = await screen.findByLabelText('Directory')
    expect(select).toHaveValue('C:/work/app-without-rails')
    expect(screen.getByRole('option', { name: 'C:/work/another' })).toBeInTheDocument()
  })

  it('shows the empty state when nothing is eligible', async () => {
    mockCandidates([])
    render(<AddRailsDialog onClose={() => {}} onAdopted={() => {}} />)
    expect(await screen.findByText(/No eligible directories/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /adopt rails/i })).not.toBeInTheDocument()
  })

  it('POSTs the selected path and shows success', async () => {
    mockCandidates(CANDIDATES)
    let received = null
    server.use(
      http.post('/api/rails/adopt', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json(
          { ok: true, hooks: 'node', installed: ['.claude/', 'CLAUDE.md'] },
          { status: 201 },
        )
      }),
    )
    render(<AddRailsDialog onClose={() => {}} onAdopted={() => {}} />)
    fireEvent.change(await screen.findByLabelText('Directory'), {
      target: { value: 'C:/work/another' },
    })
    fireEvent.click(screen.getByRole('button', { name: /adopt rails/i }))

    expect(await screen.findByText(/Rails adopted/i)).toBeInTheDocument()
    expect(received).toEqual({ projectPath: 'C:/work/another' })
  })

  it('surfaces a server error without claiming success', async () => {
    mockCandidates(CANDIDATES)
    server.use(
      http.post('/api/rails/adopt', () =>
        HttpResponse.json({ error: 'already_present' }, { status: 409 }),
      ),
    )
    render(<AddRailsDialog onClose={() => {}} onAdopted={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /adopt rails/i }))
    expect(await screen.findByText('already_present')).toBeInTheDocument()
    expect(screen.queryByText(/Rails adopted/i)).not.toBeInTheDocument()
  })

  it('calls onAdopted when Done is clicked after success', async () => {
    mockCandidates(CANDIDATES)
    const onAdopted = vi.fn()
    server.use(
      http.post('/api/rails/adopt', () =>
        HttpResponse.json({ ok: true, hooks: 'node' }, { status: 201 }),
      ),
    )
    render(<AddRailsDialog onClose={() => {}} onAdopted={onAdopted} />)
    fireEvent.click(await screen.findByRole('button', { name: /adopt rails/i }))
    fireEvent.click(await screen.findByRole('button', { name: /done/i }))
    expect(onAdopted).toHaveBeenCalledTimes(1)
  })
})
