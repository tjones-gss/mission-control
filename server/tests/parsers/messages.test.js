vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    promises,
  }
})

import fs from 'fs'
import { getSessionMessages } from '../../parsers/messages.js'

beforeEach(() => {
  vi.resetAllMocks()
})

function makeProjectDirEntry(name) {
  return { name, isDirectory: () => true }
}

// Sets up fs mocks to simulate finding (or not) a session file
function setupSessionFile(sessionId, content) {
  const projectDir = makeProjectDirEntry('C--project')
  fs.existsSync.mockImplementation((p) => {
    // CLAUDE_DIR (projects dir) always exists
    if (!p.includes(sessionId)) return true
    // The actual .jsonl file exists
    return p.endsWith(`${sessionId}.jsonl`)
  })
  fs.readdirSync.mockReturnValue([projectDir])
  fs.readFileSync.mockReturnValue(content)
}

describe('getSessionMessages()', () => {
  it('returns null when projects dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getSessionMessages('any-session')).toBeNull()
  })

  it('returns null when session file is not found in any project dir', () => {
    fs.existsSync.mockImplementation(() => false)
    expect(getSessionMessages('missing-session')).toBeNull()
  })

  it('returns { sessionId, messages: [] } for empty session file', () => {
    setupSessionFile('sess-1', '')
    // Override: CLAUDE_DIR exists, session file exists
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue('')

    const result = getSessionMessages('sess-1')
    // The parser now returns paging metadata alongside the messages array
    // (totalCount/offset/hasMore) so the dashboard can render a Load older
    // button. Match on the core fields the original test cared about.
    expect(result).toMatchObject({ sessionId: 'sess-1', messages: [] })
    expect(result.totalCount).toBe(0)
    expect(result.hasMore).toBe(false)
  })

  it('parses user messages with string content', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: { content: 'Hello, world!' },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    expect(result.messages).toHaveLength(1)
    const msg = result.messages[0]
    expect(msg.uuid).toBe('u1')
    expect(msg.type).toBe('user')
    expect(msg.blocks).toEqual([{ type: 'text', text: 'Hello, world!' }])
  })

  it('parses user messages with array content (text blocks)', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: {
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    expect(result.messages[0].blocks).toEqual([
      { type: 'text', text: 'Part 1' },
      { type: 'text', text: 'Part 2' },
    ])
  })

  it('parses user messages with image blocks', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: {
        content: [
          { type: 'text', text: 'Look at this image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: 'iVBORw0KGgo=',
            },
          },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    expect(result.messages[0].blocks).toHaveLength(2)
    expect(result.messages[0].blocks[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' },
    })
  })

  it('parses user messages with tool_result blocks', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-123',
            content: 'Command output here',
          },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    const block = result.messages[0].blocks[0]
    expect(block.type).toBe('tool_result')
    expect(block.toolUseId).toBe('tu-123')
    expect(block.content).toBe('Command output here')
  })

  it('parses assistant messages with text, thinking, and tool_use blocks', () => {
    const record = {
      uuid: 'a1',
      type: 'assistant',
      timestamp: '2024-01-01T00:00:01Z',
      isSidechain: false,
      message: {
        model: 'claude-3-5-sonnet',
        content: [
          { type: 'thinking', thinking: 'Let me think...' },
          { type: 'text', text: 'Here is my answer.' },
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    const msg = result.messages[0]
    expect(msg.type).toBe('assistant')
    expect(msg.model).toBe('claude-3-5-sonnet')
    expect(msg.blocks).toHaveLength(3)
    expect(msg.blocks[0]).toEqual({ type: 'thinking', text: 'Let me think...' })
    expect(msg.blocks[1]).toEqual({ type: 'text', text: 'Here is my answer.' })
    expect(msg.blocks[2]).toEqual({
      type: 'tool_use',
      id: 'tu-1',
      name: 'Bash',
      input: { command: 'ls' },
    })
  })

  it('excludes sidechain records from messages', () => {
    const main = {
      uuid: 'main-1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: { content: 'Main message' },
    }
    const side = {
      uuid: 'side-1',
      type: 'user',
      timestamp: '2024-01-01T00:00:01Z',
      isSidechain: true,
      message: { content: 'Sidechain message' },
    }
    const jsonl = [main, side].map((r) => JSON.stringify(r)).join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getSessionMessages('sess-1')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].uuid).toBe('main-1')
  })

  it('skips records without a uuid field', () => {
    const withoutUuid = {
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: { content: 'No UUID' },
    }
    const withUuid = {
      uuid: 'has-uuid',
      type: 'user',
      timestamp: '2024-01-01T00:00:01Z',
      isSidechain: false,
      message: { content: 'Has UUID' },
    }
    const jsonl = [withoutUuid, withUuid].map((r) => JSON.stringify(r)).join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getSessionMessages('sess-1')
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].uuid).toBe('has-uuid')
  })

  it('returns null when readFileSync throws', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockImplementation(() => {
      throw new Error('disk error')
    })

    expect(getSessionMessages('sess-1')).toBeNull()
  })

  it('stringifies tool_result content array into joined text', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu-999',
            content: [
              { type: 'text', text: 'Line 1' },
              { type: 'text', text: 'Line 2' },
            ],
          },
        ],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    const block = result.messages[0].blocks[0]
    expect(block.content).toBe('Line 1\nLine 2')
  })

  it('includes usage data in assistant messages when present', () => {
    const record = {
      uuid: 'a1',
      type: 'assistant',
      timestamp: '2024-01-01T00:00:01Z',
      isSidechain: false,
      message: {
        model: 'claude-sonnet-4-6',
        content: [{ type: 'text', text: 'Hello' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    expect(result.messages[0].usage).toEqual({
      input: 100,
      output: 50,
      cacheRead: 20,
      cacheWrite: 10,
    })
  })

  it('sets usage to null when not present in assistant record', () => {
    const record = {
      uuid: 'a1',
      type: 'assistant',
      timestamp: '2024-01-01T00:00:01Z',
      isSidechain: false,
      message: {
        model: 'claude-3',
        content: [{ type: 'text', text: 'Hello' }],
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('sess-1')
    expect(result.messages[0].usage).toBeNull()
  })

  it('returns correct sessionId in result', () => {
    const record = {
      uuid: 'u1',
      type: 'user',
      timestamp: '2024-01-01T00:00:00Z',
      isSidechain: false,
      message: { content: 'Hi' },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionMessages('my-session-id')
    expect(result.sessionId).toBe('my-session-id')
  })
})
