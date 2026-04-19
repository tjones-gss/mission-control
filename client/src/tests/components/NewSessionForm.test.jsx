import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { NewSessionForm } from '../../components/NewSessionForm.jsx'

function stubFsHome(path = '/Users/alice', sep = '/') {
  server.use(
    http.get('/api/fs/home', () => HttpResponse.json({ path, sep })),
    http.get('/api/fs/list', () => HttpResponse.json({ path, parent: null, sep, entries: [] })),
  )
}

describe('NewSessionForm — layout', () => {
  it('does not crash when sessions is null', () => {
    render(<NewSessionForm onCreated={vi.fn()} sessions={null} />)
    expect(screen.getByPlaceholderText(/working directory/i)).toBeInTheDocument()
  })

  it('renders name, cwd, and prompt inputs', () => {
    render(<NewSessionForm onCreated={vi.fn()} />)
    expect(screen.getByPlaceholderText(/session name/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/working directory/i)).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/^prompt/i)).toBeInTheDocument()
  })

  it('renders Model and Mode selects stacked (not in a row)', () => {
    const { container } = render(<NewSessionForm onCreated={vi.fn()} />)
    const modelSelect = screen.getByRole('combobox', { name: /^model$/i })
    const modeSelect = screen.getByRole('combobox', { name: /^mode$/i })
    expect(modelSelect).toBeInTheDocument()
    expect(modeSelect).toBeInTheDocument()
    const selectsWrapper = container.querySelector('[data-testid="new-session-selects"]')
    expect(selectsWrapper).toBeTruthy()
    expect(selectsWrapper.className).toMatch(/flex-col/)
    expect(selectsWrapper.className).not.toMatch(/\bflex-row\b/)
  })

  it('does not render an Effort select on the new-session form (SDK-only option; CLI-created sessions ignore it)', () => {
    render(<NewSessionForm onCreated={vi.fn()} />)
    expect(screen.queryByRole('combobox', { name: /^effort$/i })).not.toBeInTheDocument()
  })

  it('renders a folder-picker icon button next to the working directory input', () => {
    render(<NewSessionForm onCreated={vi.fn()} />)
    expect(screen.getByRole('button', { name: /browse for folder/i })).toBeInTheDocument()
  })
})

describe('NewSessionForm — validation', () => {
  it('disables submit until both cwd and prompt are non-empty', () => {
    render(<NewSessionForm onCreated={vi.fn()} />)
    const submit = screen.getByRole('button', { name: /create session/i })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    expect(submit).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'do a thing' },
    })
    expect(submit).not.toBeDisabled()
  })
})

describe('NewSessionForm — submit', () => {
  it('POSTs to /api/sessions/new with the expected body shape', async () => {
    let received = null
    server.use(
      http.post('/api/sessions/new', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ ok: true, result: { sessionId: 'new-1' } }, { status: 201 })
      }),
    )
    const onCreated = vi.fn()
    render(<NewSessionForm onCreated={onCreated} />)
    fireEvent.change(screen.getByPlaceholderText(/session name/i), {
      target: { value: 'my-sess' },
    })
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'analyze this' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /^model$/i }), {
      target: { value: 'sonnet' },
    })
    fireEvent.change(screen.getByRole('combobox', { name: /^mode$/i }), {
      target: { value: 'plan' },
    })
    fireEvent.click(screen.getByLabelText(/worktree/i))
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))

    await waitFor(() => expect(received).not.toBeNull())
    expect(received).toEqual({
      cwd: '/tmp/proj',
      prompt: 'analyze this',
      name: 'my-sess',
      worktree: true,
      options: { model: 'sonnet', permissionMode: 'plan' },
    })
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })

  it('omits name, worktree, and options when not set', async () => {
    let received = null
    server.use(
      http.post('/api/sessions/new', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ ok: true }, { status: 201 })
      }),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'analyze this' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    await waitFor(() => expect(received).not.toBeNull())
    expect(received).toEqual({ cwd: '/tmp/proj', prompt: 'analyze this' })
  })

  it('pressing Enter in the prompt input submits the form', async () => {
    let received = null
    server.use(
      http.post('/api/sessions/new', async ({ request }) => {
        received = await request.json()
        return HttpResponse.json({ ok: true }, { status: 201 })
      }),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    const prompt = screen.getByPlaceholderText(/^prompt/i)
    fireEvent.change(prompt, { target: { value: 'hi' } })
    fireEvent.keyDown(prompt, { key: 'Enter' })
    await waitFor(() => expect(received).not.toBeNull())
    expect(received.cwd).toBe('/tmp/proj')
    expect(received.prompt).toBe('hi')
  })

  it('shows an inline error message when the server returns non-OK', async () => {
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json({ error: 'bad', detail: 'boom' }, { status: 503 }),
      ),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    expect(await screen.findByText(/boom/i)).toBeInTheDocument()
  })

  it('renders both detail and stderr when the server returns stderr', async () => {
    const stderrText =
      'error: unknown option --effort\n' +
      '  at CLI (claude-code/dist/cli.js:42:13)\n' +
      'Please report this at https://github.com/anthropics/claude-code/issues'
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json(
          {
            error: 'session_create_failed',
            detail: 'claude CLI exited with code=1 signal=null',
            stderr: stderrText,
          },
          { status: 503 },
        ),
      ),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))

    expect(await screen.findByText(/code=1/i)).toBeInTheDocument()
    const stderrEl = await screen.findByTestId('new-session-stderr')
    expect(stderrEl).toBeInTheDocument()
    expect(stderrEl.tagName).toBe('PRE')
    expect(stderrEl.textContent).toContain('unknown option --effort')
    expect(stderrEl.textContent).toContain('github.com/anthropics/claude-code')
    expect(stderrEl.className).toMatch(/font-mono/)
  })

  it('renders stdout block for quota-style errors (CLI writes JSON on stdout then exits 1)', async () => {
    const stdoutText =
      '{"is_error":true,"api_error_status":429,"result":"You\'ve hit your limit · resets 2am"}'
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json(
          {
            error: 'session_create_failed',
            detail: 'claude CLI exited with code=1 signal=null',
            stderr: null,
            stdout: stdoutText,
          },
          { status: 503 },
        ),
      ),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))

    const stdoutEl = await screen.findByTestId('new-session-stdout')
    expect(stdoutEl.tagName).toBe('PRE')
    expect(stdoutEl.textContent).toContain('hit your limit')
    expect(stdoutEl.textContent).toContain('api_error_status')
  })

  it('omits the stderr block when the server returns no stderr', async () => {
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json(
          { error: 'session_create_failed', detail: 'network blip', stderr: null },
          { status: 503 },
        ),
      ),
    )
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    await screen.findByText(/network blip/i)
    expect(screen.queryByTestId('new-session-stderr')).not.toBeInTheDocument()
  })

  it('resets all fields and calls onCreated after successful submit', async () => {
    server.use(
      http.post('/api/sessions/new', () => HttpResponse.json({ ok: true }, { status: 201 })),
    )
    const onCreated = vi.fn()
    render(<NewSessionForm onCreated={onCreated} />)
    const cwd = screen.getByPlaceholderText(/working directory/i)
    const prompt = screen.getByPlaceholderText(/^prompt/i)
    fireEvent.change(cwd, { target: { value: '/tmp/proj' } })
    fireEvent.change(prompt, { target: { value: 'hi' } })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(cwd.value).toBe('')
    expect(prompt.value).toBe('')
  })

  it('202 early-ack response calls onCreated with { pendingSessionId }', async () => {
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json(
          { ok: true, pendingSessionId: 'new-abc', status: 'streaming' },
          { status: 202 },
        ),
      ),
    )
    const onCreated = vi.fn()
    render(<NewSessionForm onCreated={onCreated} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ pendingSessionId: 'new-abc' }))
  })

  it('201 legacy response calls onCreated with no pendingSessionId argument', async () => {
    server.use(
      http.post('/api/sessions/new', () =>
        HttpResponse.json({ ok: true, result: { sessionId: 'old-1' } }, { status: 201 }),
      ),
    )
    const onCreated = vi.fn()
    render(<NewSessionForm onCreated={onCreated} />)
    fireEvent.change(screen.getByPlaceholderText(/working directory/i), {
      target: { value: '/tmp/proj' },
    })
    fireEvent.change(screen.getByPlaceholderText(/^prompt/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /create session/i }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    expect(onCreated.mock.calls[0][0]).toBeUndefined()
  })
})

describe('NewSessionForm — folder picker integration', () => {
  it('clicking the folder icon opens the folder picker modal', async () => {
    stubFsHome()
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /browse for folder/i }))
    expect(
      await screen.findByRole('button', { name: /select this directory/i }),
    ).toBeInTheDocument()
  })

  it('selecting a directory in the picker populates the cwd input and closes the modal', async () => {
    stubFsHome('/Users/alice', '/')
    render(<NewSessionForm onCreated={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: /browse for folder/i }))
    const confirm = await screen.findByRole('button', { name: /select this directory/i })
    fireEvent.click(confirm)
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/working directory/i).value).toBe('/Users/alice')
    })
    expect(screen.queryByRole('button', { name: /select this directory/i })).not.toBeInTheDocument()
  })

  it('passes sessions as recent cwds to the picker', async () => {
    stubFsHome('/Users/alice', '/')
    const sessions = [
      { sessionId: 's1', cwd: '/Users/alice/Projects/one', lastModified: 2 },
      { sessionId: 's2', cwd: '/Users/alice/Projects/two', lastModified: 1 },
    ]
    render(<NewSessionForm onCreated={vi.fn()} sessions={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: /browse for folder/i }))
    expect(await screen.findByText('/Users/alice/Projects/one')).toBeInTheDocument()
    expect(screen.getByText('/Users/alice/Projects/two')).toBeInTheDocument()
  })
})
