import { formatAsMarkdown, formatAsJson } from '../../utils/export.js'

const baseSession = {
  sessionId: 'abc-123',
  slug: 'my-session',
  model: 'claude-sonnet-4-6-20250514',
  cwd: '/home/user/project',
  firstTimestamp: '2025-06-01T12:00:00Z',
}

describe('formatAsMarkdown()', () => {
  it('produces header with session metadata', () => {
    const md = formatAsMarkdown(baseSession, [])
    expect(md).toContain('# Session: my-session')
    expect(md).toContain('**Model:** claude-sonnet-4-6-20250514')
    expect(md).toContain('**Started:** 2025-06-01T12:00:00Z')
    expect(md).toContain('**Messages:** 0')
    expect(md).toContain('**Project:** /home/user/project')
  })

  it('uses sessionId when slug is null', () => {
    const session = { ...baseSession, slug: null }
    const md = formatAsMarkdown(session, [])
    expect(md).toContain('# Session: abc-123')
  })

  it('formats user text blocks', () => {
    const messages = [
      {
        type: 'user',
        blocks: [{ type: 'text', text: 'Hello, Claude!' }],
      },
    ]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('## User')
    expect(md).toContain('Hello, Claude!')
  })

  it('formats assistant text blocks', () => {
    const messages = [
      {
        type: 'assistant',
        blocks: [{ type: 'text', text: 'Here is my response.' }],
      },
    ]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('## Assistant')
    expect(md).toContain('Here is my response.')
  })

  it('formats tool_use blocks', () => {
    const messages = [
      {
        type: 'assistant',
        blocks: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'ls -la' },
          },
        ],
      },
    ]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('### Tool: Bash')
    expect(md).toContain('```json')
    expect(md).toContain('"command": "ls -la"')
    expect(md).toContain('```')
  })

  it('formats tool_result blocks', () => {
    const messages = [
      {
        type: 'user',
        blocks: [
          {
            type: 'tool_result',
            content: 'file1.js\nfile2.js',
          },
        ],
      },
    ]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('#### Result')
    expect(md).toContain('file1.js\nfile2.js')
  })

  it('formats thinking blocks as collapsed details', () => {
    const messages = [
      {
        type: 'assistant',
        blocks: [{ type: 'thinking', text: 'Let me think about this...' }],
      },
    ]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('<details><summary>Thinking</summary>')
    expect(md).toContain('Let me think about this...')
    expect(md).toContain('</details>')
  })

  it('handles empty messages array', () => {
    const md = formatAsMarkdown(baseSession, [])
    expect(md).toContain('# Session: my-session')
    expect(md).toContain('**Messages:** 0')
    expect(md).not.toContain('## User')
    expect(md).not.toContain('## Assistant')
  })

  it('handles messages with empty blocks', () => {
    const messages = [{ type: 'user', blocks: [] }]
    const md = formatAsMarkdown(baseSession, messages)
    expect(md).toContain('## User')
  })
})

describe('formatAsJson()', () => {
  it('produces valid JSON', () => {
    const messages = [{ type: 'user', blocks: [{ type: 'text', text: 'hi' }] }]
    const json = formatAsJson(baseSession, messages)
    const parsed = JSON.parse(json)
    expect(parsed).toBeDefined()
    expect(parsed.messages).toHaveLength(1)
  })

  it('includes session metadata', () => {
    const json = formatAsJson(baseSession, [])
    const parsed = JSON.parse(json)
    expect(parsed.sessionId).toBe('abc-123')
    expect(parsed.slug).toBe('my-session')
    expect(parsed.model).toBe('claude-sonnet-4-6-20250514')
    expect(parsed.cwd).toBe('/home/user/project')
    expect(parsed.firstTimestamp).toBe('2025-06-01T12:00:00Z')
    expect(parsed.messageCount).toBe(0)
  })

  it('handles null optional fields', () => {
    const session = { sessionId: 'x', slug: null, model: null, cwd: null, firstTimestamp: null }
    const json = formatAsJson(session, [])
    const parsed = JSON.parse(json)
    expect(parsed.slug).toBeNull()
    expect(parsed.model).toBeNull()
  })
})
