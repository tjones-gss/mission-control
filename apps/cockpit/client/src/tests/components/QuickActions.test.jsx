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
