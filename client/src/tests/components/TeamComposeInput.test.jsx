import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { server } from '../mocks/server.js'
import { http, HttpResponse } from 'msw'
import { TeamComposeInput } from '../../components/TeamsPanel/TeamComposeInput.jsx'

const defaultProps = () => ({
  teamName: 'my-team',
  onSent: vi.fn(),
})

// ─── Rendering ───────────────────────────────────────────────────────────────

describe('TeamComposeInput — rendering', () => {
  it('renders input with placeholder "Message my-team..."', () => {
    render(<TeamComposeInput {...defaultProps()} />)
    expect(screen.getByPlaceholderText('Message my-team...')).toBeInTheDocument()
  })

  it('Send button is disabled when input is empty', () => {
    render(<TeamComposeInput {...defaultProps()} />)
    const sendBtn = screen.getByRole('button', { name: /send/i })
    expect(sendBtn).toBeDisabled()
  })
})

// ─── Sending ─────────────────────────────────────────────────────────────────

describe('TeamComposeInput — sending', () => {
  it('clicking Send posts to /api/teams/my-team/inbox and clears input', async () => {
    let postBody = null
    server.use(
      http.post('/api/teams/:teamName/inbox', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 'new-msg', content: postBody.content })
      }),
    )

    const props = defaultProps()
    render(<TeamComposeInput {...props} />)

    const input = screen.getByPlaceholderText('Message my-team...')
    await userEvent.type(input, 'Hello world')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(postBody).toEqual({ content: 'Hello world' })
    })
    await waitFor(() => {
      expect(input).toHaveValue('')
    })
    await waitFor(() => expect(props.onSent).toHaveBeenCalled())
  })

  it('Enter key sends (without Shift)', async () => {
    let postBody = null
    server.use(
      http.post('/api/teams/:teamName/inbox', async ({ request }) => {
        postBody = await request.json()
        return HttpResponse.json({ id: 'new-msg', content: postBody.content })
      }),
    )

    const props = defaultProps()
    render(<TeamComposeInput {...props} />)

    const input = screen.getByPlaceholderText('Message my-team...')
    await userEvent.type(input, 'Quick message{Enter}')

    await waitFor(() => {
      expect(postBody).toEqual({ content: 'Quick message' })
    })
    await waitFor(() => expect(props.onSent).toHaveBeenCalled())
  })

  it('shows error on failed send', async () => {
    server.use(
      http.post('/api/teams/:teamName/inbox', () => {
        return HttpResponse.json({ error: 'Server error' }, { status: 500 })
      }),
    )

    render(<TeamComposeInput {...defaultProps()} />)

    const input = screen.getByPlaceholderText('Message my-team...')
    await userEvent.type(input, 'This will fail')
    await userEvent.click(screen.getByRole('button', { name: /send/i }))

    await waitFor(() => {
      expect(screen.getByText('Failed to send message')).toBeInTheDocument()
    })
  })
})
