vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: {
      existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
      statSync: vi.fn(), promises,
    },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(),
    statSync: vi.fn(), promises,
  }
})

import fs from 'fs'
import { getAllSessions, getSessionById } from '../../parsers/sessions.js'

beforeEach(() => {
  vi.resetAllMocks()
})

// Helpers
function makeStat(mtimeMs = Date.now() - 10_000) {
  return { mtimeMs }
}

function makeRecord(overrides = {}) {
  return {
    uuid: 'test-uuid-1',
    type: 'user',
    timestamp: '2024-01-01T00:00:00Z',
    message: { content: 'Hello' },
    isSidechain: false,
    ...overrides,
  }
}

function makeProjectDirEntry(name) {
  return { name, isDirectory: () => true }
}

describe('getAllSessions()', () => {
  it('returns [] when projects dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getAllSessions()).toEqual([])
  })

  it('returns [] when projects dir has no project subdirectories', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    expect(getAllSessions()).toEqual([])
  })

  it('returns [] when project dir has no .jsonl files', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])  // projects dir
      .mockReturnValueOnce([])  // project subdir — no .jsonl files
    expect(getAllSessions()).toEqual([])
  })

  it('returns [] when .jsonl file has no parseable records', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['session-abc.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue('')

    expect(getAllSessions()).toEqual([])
  })

  it('parses a minimal valid session file', () => {
    const record = makeRecord({ slug: 'my-project', cwd: '/home/user/project' })
    const jsonl = JSON.stringify(record)

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['session-abc.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getAllSessions()
    expect(result).toHaveLength(1)
    expect(result[0].sessionId).toBe('session-abc')
    expect(result[0].slug).toBe('my-project')
    expect(result[0].cwd).toBe('/home/user/project')
    expect(result[0].messageCount).toBe(1)
  })

  it('marks session as active when modified within 5 minutes', () => {
    const record = makeRecord()
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['active.jsonl'])
    // Modified 1 minute ago
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() - 60_000 })
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result[0].isActive).toBe(true)
  })

  it('marks session as inactive when modified more than 5 minutes ago', () => {
    const record = makeRecord()
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['old.jsonl'])
    // Modified 10 minutes ago
    fs.statSync.mockReturnValue({ mtimeMs: Date.now() - 10 * 60_000 })
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result[0].isActive).toBe(false)
  })

  it('extracts token usage from assistant records', () => {
    const userRecord = makeRecord({ type: 'user', uuid: 'u1' })
    const assistantRecord = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3-5-sonnet',
        content: [{ type: 'text', text: 'Hello!' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
        },
      },
    })
    const jsonl = [userRecord, assistantRecord].map(r => JSON.stringify(r)).join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getAllSessions()
    const sess = result[0]
    expect(sess.tokenUsage.input).toBe(100)
    expect(sess.tokenUsage.output).toBe(50)
    expect(sess.tokenUsage.cacheRead).toBe(20)
    expect(sess.tokenUsage.cacheWrite).toBe(10)
    expect(sess.model).toBe('claude-3-5-sonnet')
  })

  it('counts tool use by name across assistant messages', () => {
    const record = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
          { type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: '/foo' } },
          { type: 'tool_use', id: 'tu3', name: 'Bash', input: { command: 'pwd' } },
        ],
      },
    })
    const jsonl = JSON.stringify(record)

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getAllSessions()
    expect(result[0].toolUseCounts['Bash']).toBe(2)
    expect(result[0].toolUseCounts['Read']).toBe(1)
  })

  it('extracts lastAction from most recent tool_use block', () => {
    const record = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        content: [
          { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo hello' } },
        ],
      },
    })
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result[0].lastAction).toEqual({ name: 'Bash', summary: 'echo hello' })
  })

  it('extracts lastText from most recent text block', () => {
    const record = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        content: [{ type: 'text', text: 'Here is your answer.' }],
      },
    })
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result[0].lastText).toBe('Here is your answer.')
  })

  it('extracts gitBranch when present in any record', () => {
    const record = makeRecord({ gitBranch: 'feature/my-branch' })
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result[0].gitBranch).toBe('feature/my-branch')
  })

  it('sorts sessions newest-first by lastModified', () => {
    const record = makeRecord()
    const older = Date.now() - 60_000
    const newer = Date.now() - 10_000

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['old.jsonl', 'new.jsonl'])
    fs.statSync
      .mockReturnValueOnce({ mtimeMs: older })
      .mockReturnValueOnce({ mtimeMs: newer })
    fs.readFileSync
      .mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result).toHaveLength(2)
    expect(result[0].lastModified).toBe(newer)
    expect(result[1].lastModified).toBe(older)
  })

  it('builds agentTree with main and sidechain message counts', () => {
    const main = makeRecord({ uuid: 'u1', isSidechain: false })
    const side = makeRecord({ uuid: 'u2', isSidechain: true, parentToolUseID: 'tuid-1' })
    const jsonl = [main, side].map(r => JSON.stringify(r)).join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getAllSessions()
    const tree = result[0].agentTree
    expect(tree.mainMessageCount).toBe(1)
    expect(tree.subagents).toHaveLength(1)
    expect(tree.subagents[0].toolUseId).toBe('tuid-1')
  })

  it('skips files that throw during parsing', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['bad.jsonl'])
    fs.statSync.mockImplementation(() => { throw new Error('stat failed') })

    expect(getAllSessions()).toEqual([])
  })
})

describe('getSessionById()', () => {
  it('returns null when session not found', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getSessionById('nonexistent')).toBeNull()
  })

  it('returns the matching session when found', () => {
    const record = makeRecord({ slug: 'my-proj' })
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['target-session.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionById('target-session')
    expect(result).not.toBeNull()
    expect(result.sessionId).toBe('target-session')
  })
})
