import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { SessionControlBar } from '../../components/SessionControlBar.jsx'

const SESSION = { sessionId: 'test-123', slug: 'my-proj', displayName: 'My Session', model: 'claude-sonnet-4-20250514', isActive: true, needsInput: false }

const defaultProps = () => ({
  session: SESSION,
  sessionOptions: { permissionMode: '', model: '', effort: '' },
  onOptionsChange: vi.fn(),
})

describe('SessionControlBar', () => {
  it('returns null when no session', () => {
    const { container } = render(
      <SessionControlBar session={null} sessionOptions={{ permissionMode: '', model: '', effort: '' }} onOptionsChange={vi.fn()} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('shows active status with "active" text', () => {
    render(<SessionControlBar {...defaultProps()} />)
    expect(screen.getByText('active')).toBeInTheDocument()
  })

  it('shows "needs input" for needsInput session', () => {
    render(<SessionControlBar {...defaultProps()} session={{ ...SESSION, isActive: false, needsInput: true }} />)
    expect(screen.getByText('needs input')).toBeInTheDocument()
  })

  it('shows "idle" for inactive session', () => {
    render(<SessionControlBar {...defaultProps()} session={{ ...SESSION, isActive: false, needsInput: false }} />)
    expect(screen.getByText('idle')).toBeInTheDocument()
  })

  it('shows pencil icon and session name', () => {
    render(<SessionControlBar {...defaultProps()} />)
    expect(screen.getByText('My Session')).toBeInTheDocument()
    expect(screen.getByTitle('Rename session')).toBeInTheDocument()
  })

  it('clicking pencil opens edit input', async () => {
    render(<SessionControlBar {...defaultProps()} />)
    await userEvent.click(screen.getByTitle('Rename session'))
    expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
    expect(screen.getByDisplayValue('My Session')).toBeInTheDocument()
  })

  it('Enter key saves name via POST', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/sessions/:sessionId/name', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true })
      })
    )
    render(<SessionControlBar {...defaultProps()} />)
    await userEvent.click(screen.getByTitle('Rename session'))
    const input = screen.getByPlaceholderText('Session name...')
    await userEvent.clear(input)
    await userEvent.type(input, 'New Name{Enter}')
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.name).toBe('New Name')
    })
  })

  it('Escape cancels editing', async () => {
    render(<SessionControlBar {...defaultProps()} />)
    await userEvent.click(screen.getByTitle('Rename session'))
    expect(screen.getByPlaceholderText('Session name...')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByPlaceholderText('Session name...')).not.toBeInTheDocument()
    expect(screen.getByText('My Session')).toBeInTheDocument()
  })

  it('shows Fork button', () => {
    render(<SessionControlBar {...defaultProps()} />)
    expect(screen.getByText('Fork')).toBeInTheDocument()
  })

  it('clicking Fork shows prompt input', async () => {
    render(<SessionControlBar {...defaultProps()} />)
    await userEvent.click(screen.getByText('Fork'))
    expect(screen.getByPlaceholderText('Fork prompt...')).toBeInTheDocument()
  })

  it('renders Mode, Model, Effort dropdowns', () => {
    render(<SessionControlBar {...defaultProps()} />)
    expect(screen.getByText('Mode')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(screen.getByText('Effort')).toBeInTheDocument()
  })
})
