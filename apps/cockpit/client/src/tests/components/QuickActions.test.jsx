import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { QuickActions } from '../../components/QuickActions.jsx'

describe('QuickActions', () => {
  it('renders default replies (yes, continue, approve)', () => {
    render(<QuickActions sessionId="s1" />)
    expect(screen.getByText('yes')).toBeInTheDocument()
    expect(screen.getByText('continue')).toBeInTheDocument()
    expect(screen.getByText('approve')).toBeInTheDocument()
  })

  it('renders custom replies when provided', () => {
    render(<QuickActions sessionId="s1" replies={['go', 'stop']} />)
    expect(screen.getByText('go')).toBeInTheDocument()
    expect(screen.getByText('stop')).toBeInTheDocument()
    expect(screen.queryByText('yes')).not.toBeInTheDocument()
  })

  it('sends POST /api/sessions/:sessionId/message on click', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    await userEvent.click(screen.getByText('yes'))
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.message).toBe('yes')
    })
  })

  it('shows "..." while sending', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/message', async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    await userEvent.click(screen.getByText('yes'))
    expect(screen.getByText('...')).toBeInTheDocument()
    // Let the in-flight request settle before the test ends. Otherwise the
    // delayed fetch resolves after jsdom has torn down `window`, and the
    // `finally { setSending(null) }` state update throws an unhandled
    // `ReferenceError: window is not defined` that flakes the whole run.
    await waitFor(() => expect(screen.getByText('yes')).toBeInTheDocument())
  })

  it('shows "failed" on error response', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/message', () => {
        return HttpResponse.json({ error: 'bad' }, { status: 500 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    await userEvent.click(screen.getByText('yes'))
    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
    })
  })

  it('onReply callback fires with sessionId when reply button clicked', async () => {
    const onReply = vi.fn()
    render(<QuickActions sessionId="s1" onReply={onReply} />)
    await userEvent.click(screen.getByText('reply'))
    expect(onReply).toHaveBeenCalledWith('s1')
  })

  it('supports Enter key activation', async () => {
    const onReply = vi.fn()
    render(<QuickActions sessionId="s1" onReply={onReply} />)
    const replyBtn = screen.getByText('reply')
    replyBtn.focus()
    await userEvent.keyboard('{Enter}')
    expect(onReply).toHaveBeenCalledWith('s1')
  })

  it('renders a smart suggestion chip before the default replies', () => {
    render(<QuickActions sessionId="s1" suggestion="Approved — go ahead." />)
    expect(screen.getByText(/Approved — go ahead\./)).toBeInTheDocument()
    // Default replies still present alongside it.
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('sends the full suggestion text when the suggestion chip is clicked', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" suggestion="Approved — go ahead." />)
    await userEvent.click(screen.getByText(/Approved — go ahead\./))
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.message).toBe('Approved — go ahead.')
    })
  })

  it('renders no suggestion chip when suggestion is null', () => {
    render(<QuickActions sessionId="s1" suggestion={null} />)
    expect(screen.queryByText(/✨/)).not.toBeInTheDocument()
    expect(screen.getByText('yes')).toBeInTheDocument()
  })

  it('renders reply chips as real <button> elements (keyboard + screen-reader accessible)', () => {
    render(<QuickActions sessionId="s1" />)
    expect(screen.getByText('yes').tagName).toBe('BUTTON')
    expect(screen.getByText('continue').tagName).toBe('BUTTON')
    expect(screen.getByText('approve').tagName).toBe('BUTTON')
    expect(screen.getByText('yes')).toHaveAttribute('title', 'Approve (Y)')
    expect(screen.getByText('continue')).toHaveAttribute('title', 'Continue (C)')
  })

  it('announces send status through an aria-live region', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/message', () => {
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    await userEvent.click(screen.getByText('yes'))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/sent yes/i))
  })

  it('renders the suggestion chip as a real <button>', () => {
    render(<QuickActions sessionId="s1" suggestion="Approved — go ahead." />)
    expect(screen.getByText(/Approved — go ahead\./).tagName).toBe('BUTTON')
  })

  it('renders the reply trigger as a real <button>', () => {
    render(<QuickActions sessionId="s1" onReply={vi.fn()} />)
    expect(screen.getByText('reply').closest('button')).not.toBeNull()
    expect(screen.getByText('reply').tagName).toBe('BUTTON')
  })

  it('activates a reply on Space key (native button semantics)', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    screen.getByText('yes').focus()
    await userEvent.keyboard('[Space]')
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.message).toBe('yes')
    })
  })

  it('activates the suggestion chip on Space key', async () => {
    let capturedBody = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      }),
    )
    render(<QuickActions sessionId="s1" suggestion="Approved — go ahead." />)
    screen.getByText(/Approved — go ahead\./).focus()
    await userEvent.keyboard('[Space]')
    await waitFor(() => {
      expect(capturedBody).toBeTruthy()
      expect(capturedBody.message).toBe('Approved — go ahead.')
    })
  })

  it('fires onReply on Space key', async () => {
    const onReply = vi.fn()
    render(<QuickActions sessionId="s1" onReply={onReply} />)
    screen.getByText('reply').focus()
    await userEvent.keyboard('[Space]')
    expect(onReply).toHaveBeenCalledWith('s1')
  })

  it('clears error after 3s', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    server.use(
      http.post('/api/sessions/:sessionId/message', () => {
        return HttpResponse.json({ error: 'bad' }, { status: 500 })
      }),
    )
    render(<QuickActions sessionId="s1" />)
    await userEvent.click(screen.getByText('yes'))
    await waitFor(() => {
      expect(screen.getByText('failed')).toBeInTheDocument()
    })
    vi.advanceTimersByTime(3100)
    await waitFor(() => {
      expect(screen.queryByText('failed')).not.toBeInTheDocument()
    })
    vi.useRealTimers()
  })
})
