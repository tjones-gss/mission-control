import { render, screen } from '@testing-library/react'
import { MessageList } from '../../components/MessageList.jsx'

function renderList(messages, overrides = {}) {
  return render(
    <MessageList
      messages={messages}
      toolNameMap={overrides.toolNameMap || {}}
      isStreaming={overrides.isStreaming || false}
    />,
  )
}

describe('MessageList', () => {
  it('renders a user text message', () => {
    renderList([{ uuid: 'u1', type: 'user', blocks: [{ type: 'text', text: 'hello there' }] }])
    expect(screen.getByText('hello there')).toBeInTheDocument()
    expect(screen.getByText('USER')).toBeInTheDocument()
  })

  it('renders an assistant text message', () => {
    renderList([{ uuid: 'a1', type: 'assistant', blocks: [{ type: 'text', text: 'sure, on it' }] }])
    expect(screen.getByText('sure, on it')).toBeInTheDocument()
  })

  it('renders an assistant thinking block', () => {
    renderList([
      { uuid: 'a2', type: 'assistant', blocks: [{ type: 'thinking', text: 'pondering' }] },
    ])
    expect(screen.getByText('THINK')).toBeInTheDocument()
  })

  it('renders an assistant tool_use block with the tool name', () => {
    renderList([
      {
        uuid: 'a3',
        type: 'assistant',
        blocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }],
      },
    ])
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })

  it('shows the streaming indicator when isStreaming is true', () => {
    renderList([], { isStreaming: true })
    expect(screen.getByText(/generating response/i)).toBeInTheDocument()
  })
})
