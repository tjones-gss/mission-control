import { render, screen, fireEvent } from '@testing-library/react'
import { MessageList } from '../../components/MessageList.jsx'

const ESC = String.fromCharCode(27) // ANSI escape introducer

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

  it('renders nothing for an empty message list', () => {
    const { container } = renderList([])
    expect(container.textContent).toBe('')
  })

  it('renders nothing (and does not crash) for an unknown message type', () => {
    const { container } = renderList([{ uuid: 'x1', type: 'tool', blocks: [] }])
    expect(container.querySelector('div')).toBeInTheDocument()
    expect(container.textContent).toBe('')
  })

  describe('tool_result blocks', () => {
    const toolResultMsg = [
      {
        uuid: 'u-tr',
        type: 'user',
        blocks: [
          {
            type: 'tool_result',
            toolUseId: 't1',
            content: `${ESC}[31mred error${ESC}[0m\nsecond line`,
          },
        ],
      },
    ]

    it('shows a collapsed result summary with the mapped tool name and ANSI stripped', () => {
      renderList(toolResultMsg, { toolNameMap: { t1: 'Bash' } })
      expect(screen.getByText('TOOL OUTPUT')).toBeInTheDocument()
      // Summary text carries the cleaned first line, never the raw escape bytes.
      const btn = screen.getByRole('button', { name: /Bash result/ })
      expect(btn.textContent).toContain('red error')
      expect(btn.textContent).not.toContain(ESC)
    })

    it('expands to reveal the full ANSI-stripped output', () => {
      renderList(toolResultMsg, { toolNameMap: { t1: 'Bash' } })
      fireEvent.click(screen.getByRole('button', { name: /Bash result/ }))
      const pre = document.querySelector('pre')
      expect(pre).toBeInTheDocument()
      expect(pre.textContent).toContain('second line')
      expect(pre.textContent).not.toContain(ESC)
    })

    it('falls back to a generic "result" label when the tool name is unknown', () => {
      renderList(toolResultMsg) // no toolNameMap entry for t1
      expect(screen.getByRole('button', { name: /result/ })).toBeInTheDocument()
    })
  })

  describe('system-injected content', () => {
    it('routes a <system-reminder> block out of the USER bubble into a SystemMessage', () => {
      const { container } = renderList([
        {
          uuid: 'u-sys',
          type: 'user',
          blocks: [{ type: 'text', text: '<system-reminder>do the thing</system-reminder>' }],
        },
      ])
      // No USER bubble — the content is system, not user-authored.
      expect(screen.queryByText('USER')).not.toBeInTheDocument()
      expect(container.textContent).toContain('do the thing')
    })

    it('summarizes a <command-name> + <local-command-stdout> pair', () => {
      const { container } = renderList([
        {
          uuid: 'u-cmd',
          type: 'user',
          blocks: [
            {
              type: 'text',
              text: '<command-name>deploy</command-name><local-command-stdout>shipped</local-command-stdout>',
            },
          ],
        },
      ])
      expect(container.textContent).toContain('/deploy: shipped')
    })

    it('summarizes a <task-notification> via its <summary>', () => {
      const { container } = renderList([
        {
          uuid: 'u-task',
          type: 'user',
          blocks: [
            {
              type: 'text',
              text: '<task-notification><summary>Build finished</summary></task-notification>',
            },
          ],
        },
      ])
      expect(container.textContent).toContain('Build finished')
    })
  })

  describe('image blocks', () => {
    it('renders a base64 image as a data URI', () => {
      renderList([
        {
          uuid: 'u-img',
          type: 'user',
          blocks: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } },
          ],
        },
      ])
      expect(screen.getByAltText(/attached image/i)).toHaveAttribute(
        'src',
        'data:image/png;base64,AAAA',
      )
    })

    it('passes through a url image source', () => {
      renderList([
        {
          uuid: 'u-img2',
          type: 'user',
          blocks: [{ type: 'image', source: { type: 'url', url: 'https://x.test/y.png' } }],
        },
      ])
      expect(screen.getByAltText(/attached image/i)).toHaveAttribute('src', 'https://x.test/y.png')
    })

    it('renders no <img> when the image source is missing', () => {
      renderList([{ uuid: 'u-img3', type: 'user', blocks: [{ type: 'image', source: null }] }])
      expect(screen.queryByAltText(/attached image/i)).not.toBeInTheDocument()
    })
  })

  describe('redaction badge', () => {
    it('shows a singular badge for one redacted secret', () => {
      const { container } = renderList([
        {
          uuid: 'u-r1',
          type: 'user',
          blocks: [{ type: 'text', text: 'token is [REDACTED: api-key] ok' }],
        },
      ])
      expect(container.textContent).toContain('1 secret redacted')
    })

    it('pluralizes the badge for multiple redactions', () => {
      const { container } = renderList([
        {
          uuid: 'a-r2',
          type: 'assistant',
          blocks: [{ type: 'text', text: '[REDACTED: a] and [REDACTED: b]' }],
        },
      ])
      expect(container.textContent).toContain('2 secrets redacted')
    })
  })
})
