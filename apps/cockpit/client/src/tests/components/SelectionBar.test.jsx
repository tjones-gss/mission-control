import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { SelectionBar } from '../../components/TriageView/SelectionBar.jsx'

describe('SelectionBar', () => {
  it('renders nothing when no sessions are selected', () => {
    const { container } = render(<SelectionBar selectedIds={[]} onClear={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the selected count (pluralized)', () => {
    render(<SelectionBar selectedIds={['a', 'b']} onClear={() => {}} />)
    expect(screen.getByText('2 sessions selected')).toBeInTheDocument()
  })

  it('shows a singular count for a single selection', () => {
    render(<SelectionBar selectedIds={['a']} onClear={() => {}} />)
    expect(screen.getByText('1 session selected')).toBeInTheDocument()
  })

  it('sends the message to every selected session via POST', async () => {
    const posts = []
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ params, request }) => {
        const body = await request.json()
        posts.push({ sessionId: params.sessionId, message: body.message })
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )

    render(<SelectionBar selectedIds={['a', 'b']} onClear={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/send message to all selected/i), {
      target: { value: 'ship it' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(posts).toHaveLength(2))
    expect(posts.map((p) => p.sessionId).sort()).toEqual(['a', 'b'])
    expect(posts.every((p) => p.message === 'ship it')).toBe(true)
  })

  it('clears the selection after a successful send', async () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a', 'b']} onClear={onClear} />)
    fireEvent.change(screen.getByPlaceholderText(/send message to all selected/i), {
      target: { value: 'go' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))
    await waitFor(() => expect(onClear).toHaveBeenCalled())
  })

  it('keeps the bar (does not clear) when a send fails', async () => {
    const onClear = vi.fn()
    server.use(
      http.post('/api/sessions/:sessionId/message', () =>
        HttpResponse.json({ error: 'Session not found' }, { status: 404 }),
      ),
    )
    render(<SelectionBar selectedIds={['a']} onClear={onClear} />)
    fireEvent.change(screen.getByPlaceholderText(/send message to all selected/i), {
      target: { value: 'will fail' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => expect(screen.getByText(/failed/i)).toBeInTheDocument())
    expect(onClear).not.toHaveBeenCalled()
  })

  it('calls onClear when the clear (×) button is clicked', () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a']} onClear={onClear} />)
    fireEvent.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('calls onClear on Escape', () => {
    const onClear = vi.fn()
    render(<SelectionBar selectedIds={['a']} onClear={onClear} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables Send when the message is empty', () => {
    render(<SelectionBar selectedIds={['a']} onClear={() => {}} />)
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled()
  })
})
