import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MessageInput } from '../../components/MessageInput.jsx'

// jsdom lacks blob URL support — stub it for the image-attach path.
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

function renderInput(overrides = {}) {
  const onSend = vi.fn()
  const onCancel = vi.fn()
  const utils = render(
    <MessageInput
      sessionId="s1"
      sending={false}
      onSend={onSend}
      sessionOptions={null}
      skills={null}
      active={false}
      isStreaming={false}
      onCancel={onCancel}
      {...overrides}
    />,
  )
  return { onSend, onCancel, ...utils }
}

describe('MessageInput', () => {
  it('renders the text input and attach button', () => {
    renderInput()
    expect(screen.getByPlaceholderText(/send a message/i)).toBeInTheDocument()
    expect(screen.getByTitle('Attach image')).toBeInTheDocument()
  })

  it('calls onSend with trimmed text on submit', () => {
    const { onSend } = renderInput()
    const input = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(input, { target: { value: '  hello  ' } })
    fireEvent.submit(input.closest('form'))
    expect(onSend).toHaveBeenCalledWith('hello', null)
  })

  it('does not send empty/whitespace-only text', () => {
    const { onSend } = renderInput()
    const input = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.submit(input.closest('form'))
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows a Cancel button while streaming and calls onCancel', () => {
    const { onCancel } = renderInput({ isStreaming: true })
    const cancel = screen.getByRole('button', { name: /cancel/i })
    fireEvent.click(cancel)
    expect(onCancel).toHaveBeenCalled()
    // The Send button is replaced by Cancel while streaming.
    expect(screen.queryByRole('button', { name: /^send$/i })).not.toBeInTheDocument()
  })

  it('renders option pills from sessionOptions', () => {
    renderInput({ sessionOptions: { permissionMode: 'acceptEdits', model: 'opus' } })
    expect(screen.getByText('acceptEdits')).toBeInTheDocument()
    expect(screen.getByText('opus')).toBeInTheDocument()
  })

  it('shows slash autocomplete and fills the command on select', async () => {
    renderInput({ skills: { userSkills: [{ name: 'deploy', command: '/deploy' }] } })
    const input = screen.getByPlaceholderText(/send a message/i)
    fireEvent.change(input, { target: { value: '/dep' } })
    const option = await screen.findByText('/deploy')
    fireEvent.mouseDown(option)
    await waitFor(() => expect(input.value).toBe('/deploy '))
  })
})
