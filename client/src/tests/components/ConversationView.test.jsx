import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { server } from '../mocks/server.js'
import { ConversationView } from '../../components/ConversationView.jsx'

// Mock URL.createObjectURL / revokeObjectURL (jsdom lacks blob URL support)
const mockCreateObjectURL = vi.fn(() => 'blob:preview-url')
const mockRevokeObjectURL = vi.fn()
beforeAll(() => {
  URL.createObjectURL = mockCreateObjectURL
  URL.revokeObjectURL = mockRevokeObjectURL
})

beforeEach(() => {
  mockCreateObjectURL.mockClear()
  mockRevokeObjectURL.mockClear()
})

function createTestFile(name = 'test.png', type = 'image/png', sizeBytes = 1024) {
  return new File([new Uint8Array(sizeBytes)], name, { type })
}

function renderView(overrides = {}) {
  return render(
    <ConversationView
      sessionId="test-session"
      sessionUpdateVersion={0}
      active={true}
      sessionOptions={null}
      skills={null}
      streaming={{ isStreaming: false, pendingApprovals: [], sdkError: null }}
      {...overrides}
    />
  )
}

// ─── A. ImageBlock rendering ──────────────────────────────────────────────────

describe('ImageBlock rendering', () => {
  it('renders base64 image', async () => {
    server.use(
      http.get('/api/sessions/:sessionId/messages', () =>
        HttpResponse.json({
          sessionId: 'test-session',
          messages: [{
            uuid: 'm1',
            type: 'user',
            blocks: [{
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'abc123' },
            }],
          }],
        })
      )
    )
    renderView()
    const img = await screen.findByAltText('User attached image')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,abc123')
  })

  it('renders URL image', async () => {
    server.use(
      http.get('/api/sessions/:sessionId/messages', () =>
        HttpResponse.json({
          sessionId: 'test-session',
          messages: [{
            uuid: 'm2',
            type: 'user',
            blocks: [{
              type: 'image',
              source: { type: 'url', url: 'https://example.com/img.png' },
            }],
          }],
        })
      )
    )
    renderView()
    const img = await screen.findByAltText('User attached image')
    expect(img).toHaveAttribute('src', 'https://example.com/img.png')
  })

  it('skips image when source is null', async () => {
    server.use(
      http.get('/api/sessions/:sessionId/messages', () =>
        HttpResponse.json({
          sessionId: 'test-session',
          messages: [{
            uuid: 'm3',
            type: 'user',
            blocks: [
              { type: 'image', source: null },
              { type: 'text', text: 'hello' },
            ],
          }],
        })
      )
    )
    renderView()
    await screen.findByText('hello')
    expect(screen.queryByAltText('User attached image')).not.toBeInTheDocument()
  })

  it('skips image when source has no url or data', async () => {
    server.use(
      http.get('/api/sessions/:sessionId/messages', () =>
        HttpResponse.json({
          sessionId: 'test-session',
          messages: [{
            uuid: 'm4',
            type: 'user',
            blocks: [
              { type: 'image', source: { type: 'url' } },
              { type: 'text', text: 'test' },
            ],
          }],
        })
      )
    )
    renderView()
    await screen.findByText('test')
    expect(screen.queryByAltText('User attached image')).not.toBeInTheDocument()
  })
})

// ─── B. MessageInput UI ──────────────────────────────────────────────────────

describe('MessageInput UI', () => {
  it('shows attach image button', () => {
    renderView()
    expect(screen.getByTitle('Attach image')).toBeInTheDocument()
  })

  it('file input has correct accept attribute', () => {
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    expect(fileInput).toHaveAttribute('accept', 'image/png,image/jpeg,image/gif,image/webp')
  })

  it('attach button disabled when streaming', () => {
    renderView({ streaming: { isStreaming: true, pendingApprovals: [], sdkError: null } })
    expect(screen.getByTitle('Attach image')).toBeDisabled()
  })
})

// ─── C. File validation ─────────────────────────────────────────────────────

describe('File validation', () => {
  it('shows preview after valid image selection', async () => {
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    const file = createTestFile()
    fireEvent.change(fileInput, { target: { files: [file] } })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toHaveAttribute('src', 'blob:preview-url')
    })
  })

  it('rejects file over 5MB', async () => {
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    const bigFile = createTestFile('big.png', 'image/png', 6 * 1024 * 1024)
    fireEvent.change(fileInput, { target: { files: [bigFile] } })
    await waitFor(() => {
      expect(screen.queryByAltText('Attached')).not.toBeInTheDocument()
    })
  })

  it('rejects non-image MIME type', async () => {
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    const pdfFile = createTestFile('doc.pdf', 'application/pdf', 1024)
    fireEvent.change(fileInput, { target: { files: [pdfFile] } })
    await waitFor(() => {
      expect(screen.queryByAltText('Attached')).not.toBeInTheDocument()
    })
  })

  it('clear button removes preview and revokes URL', async () => {
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, { target: { files: [createTestFile()] } })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toBeInTheDocument()
    })
    // The clear button is the small one overlaid on the preview image
    const previewContainer = screen.getByAltText('Attached').closest('.relative')
    const xButton = previewContainer.querySelector('button')
    fireEvent.click(xButton)
    await waitFor(() => {
      expect(screen.queryByAltText('Attached')).not.toBeInTheDocument()
    })
    expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:preview-url')
  })
})

// ─── D. Send flow ───────────────────────────────────────────────────────────

describe('Send flow', () => {
  it('sends FormData when image attached', async () => {
    let capturedRequest = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedRequest = request
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      })
    )
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, { target: { files: [createTestFile()] } })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toBeInTheDocument()
    })
    const textInput = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(textInput, { target: { value: 'check this image' } })
    fireEvent.submit(textInput.closest('form'))
    await waitFor(() => {
      expect(capturedRequest).not.toBeNull()
    })
    const formData = await capturedRequest.formData()
    expect(formData.get('message')).toBe('check this image')
    expect(formData.get('image')).toBeTruthy()
  })

  it('sends JSON when no image', async () => {
    let capturedRequest = null
    server.use(
      http.post('/api/sessions/:sessionId/message', async ({ request }) => {
        capturedRequest = request
        return HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      })
    )
    renderView()
    const textInput = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(textInput, { target: { value: 'hello world' } })
    fireEvent.submit(textInput.closest('form'))
    await waitFor(() => {
      expect(capturedRequest).not.toBeNull()
    })
    const json = await capturedRequest.json()
    expect(json.message).toBe('hello world')
  })

  it('image cleared after successful send', async () => {
    server.use(
      http.post('/api/sessions/:sessionId/message', () =>
        HttpResponse.json({ ok: true, streaming: true }, { status: 202 })
      )
    )
    renderView()
    const fileInput = document.querySelector('input[type="file"]')
    fireEvent.change(fileInput, { target: { files: [createTestFile()] } })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toBeInTheDocument()
    })
    const textInput = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(textInput, { target: { value: 'send it' } })
    fireEvent.submit(textInput.closest('form'))
    await waitFor(() => {
      expect(screen.queryByAltText('Attached')).not.toBeInTheDocument()
    })
  })
})

// ─── E. Drag-and-drop ───────────────────────────────────────────────────────

describe('Drag-and-drop', () => {
  it('drop sets image preview', async () => {
    renderView()
    const form = document.querySelector('form')
    const file = createTestFile()
    fireEvent.drop(form, {
      dataTransfer: { files: [file] },
    })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toHaveAttribute('src', 'blob:preview-url')
    })
  })

  it('dragOver adds visual highlight', () => {
    renderView()
    const form = document.querySelector('form')
    fireEvent.dragOver(form)
    expect(form).toHaveClass('border-indigo-500')
  })
})

// ─── F. Clipboard paste ─────────────────────────────────────────────────────

describe('Clipboard paste', () => {
  it('paste with image sets preview', async () => {
    renderView()
    const textInput = screen.getByPlaceholderText(/send a message/i)
    const file = createTestFile()
    fireEvent.paste(textInput, {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }],
      },
    })
    await waitFor(() => {
      expect(screen.getByAltText('Attached')).toHaveAttribute('src', 'blob:preview-url')
    })
  })

  it('paste with non-image does nothing', async () => {
    renderView()
    const textInput = screen.getByPlaceholderText(/send a message/i)
    fireEvent.paste(textInput, {
      clipboardData: {
        items: [{ kind: 'string', type: 'text/plain' }],
      },
    })
    await waitFor(() => {
      expect(screen.queryByAltText('Attached')).not.toBeInTheDocument()
    })
  })
})
