vi.mock('fs', () => {
  const promises = {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    unlink: vi.fn(),
  }
  return {
    default: {
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(),
      promises,
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
    promises,
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
      .mockReturnValueOnce([makeProjectDirEntry('C--project')]) // projects dir
      .mockReturnValueOnce([]) // project subdir — no .jsonl files
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

  it('ignores metadata-only jsonl files that have no conversation records', () => {
    const jsonl = [
      JSON.stringify({ type: 'ai-title', aiTitle: 'Analyze session', sessionId: 's1' }),
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', sessionId: 's1' }),
    ].join('\n')
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['session-abc.jsonl'])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(jsonl)

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
    const jsonl = [userRecord, assistantRecord].map((r) => JSON.stringify(r)).join('\n')

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
        content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'echo hello' } }],
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
    fs.statSync.mockReturnValueOnce({ mtimeMs: older }).mockReturnValueOnce({ mtimeMs: newer })
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getAllSessions()
    expect(result).toHaveLength(2)
    expect(result[0].lastModified).toBe(newer)
    expect(result[1].lastModified).toBe(older)
  })

  it('builds agentTree with main and sidechain message counts', () => {
    const main = makeRecord({ uuid: 'u1', isSidechain: false })
    const side = makeRecord({ uuid: 'u2', isSidechain: true, parentToolUseID: 'tuid-1' })
    const jsonl = [main, side].map((r) => JSON.stringify(r)).join('\n')

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
    fs.statSync.mockImplementation(() => {
      throw new Error('stat failed')
    })

    expect(getAllSessions()).toEqual([])
  })
})

describe('needsInput detection', () => {
  // The default mtime is now 10 minutes ago. The needsInput logic
  // requires !isActive (active = mtime within 5 minutes), so any test
  // expecting needsInput=true must use a mtime older than 5 minutes.
  // The previous default of 10 seconds always made isActive=true and
  // forced needsInput=false, masking the entire feature.
  const NEEDS_INPUT_MTIME = Date.now() - 10 * 60 * 1000
  function setupSession(records, mtimeMs = NEEDS_INPUT_MTIME) {
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue({ mtimeMs })
    fs.readFileSync.mockReturnValue(jsonl)
    return getAllSessions()[0]
  }

  it('sets needsInput=true when last main record is assistant with stop_reason end_turn', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done!' }],
      },
    })
    const sess = setupSession([user, assistant])
    expect(sess.needsInput).toBe(true)
  })

  it('sets needsInput=false when last main record is an assistant tool_use turn', () => {
    // Tool_use means the assistant is mid-turn waiting for tool RESULTS,
    // not for the user. The previous heuristic incorrectly flagged this
    // as needsInput=true and produced constant false-positive notifications.
    // The new heuristic only triggers on stop_reason='end_turn'.
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }],
      },
    })
    const sess = setupSession([user, assistant])
    expect(sess.needsInput).toBe(false)
  })

  it('sets needsInput=false when last main record is a user message', () => {
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'What next?' }],
      },
    })
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const sess = setupSession([assistant, user])
    expect(sess.needsInput).toBe(false)
  })

  it('sets needsInput=false for sessions older than 4 hours (abandoned)', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Done!' }],
      },
    })
    // Modified 5 hours ago
    const sess = setupSession([user, assistant], Date.now() - 5 * 60 * 60 * 1000)
    expect(sess.needsInput).toBe(false)
  })

  it('skips sidechain records when determining last main record', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Thinking...' }],
      },
    })
    // Sidechain record comes after the assistant message
    const sidechain = makeRecord({
      uuid: 'sc1',
      type: 'user',
      isSidechain: true,
      parentToolUseID: 'tuid-1',
    })
    const sess = setupSession([user, assistant, sidechain])
    expect(sess.needsInput).toBe(true)
  })

  it('sets needsInput=false when last record is assistant with no stop_reason and no tool_use', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      message: {
        model: 'claude-3',
        content: [{ type: 'text', text: 'Hello' }],
      },
    })
    const sess = setupSession([user, assistant])
    expect(sess.needsInput).toBe(false)
  })

  it('detects stop_reason on top-level record field as fallback', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const assistant = makeRecord({
      uuid: 'a1',
      type: 'assistant',
      stop_reason: 'end_turn',
      message: {
        model: 'claude-3',
        content: [{ type: 'text', text: 'Finished' }],
      },
    })
    const sess = setupSession([user, assistant])
    expect(sess.needsInput).toBe(true)
  })

  it('sets needsInput=false for session with only user messages', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const sess = setupSession([user])
    expect(sess.needsInput).toBe(false)
  })
})

describe('permissionMode extraction', () => {
  function setupSession(records, mtimeMs = Date.now() - 10_000) {
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue({ mtimeMs })
    fs.readFileSync.mockReturnValue(jsonl)
    return getAllSessions()[0]
  }

  it('extracts permissionMode from user records', () => {
    const user = makeRecord({ type: 'user', permissionMode: 'plan' })
    const sess = setupSession([user])
    expect(sess.permissionMode).toBe('plan')
  })

  it('uses the most recent permissionMode when mode changes mid-session', () => {
    const user1 = makeRecord({ uuid: 'u1', type: 'user', permissionMode: 'default' })
    const user2 = makeRecord({ uuid: 'u2', type: 'user', permissionMode: 'bypassPermissions' })
    const sess = setupSession([user1, user2])
    expect(sess.permissionMode).toBe('bypassPermissions')
  })

  it('returns null when no user record has permissionMode', () => {
    const user = makeRecord({ type: 'user' })
    const sess = setupSession([user])
    expect(sess.permissionMode).toBeNull()
  })
})

describe('subagent type enrichment', () => {
  function setupSession(records, metaFiles = {}, mtimeMs = Date.now() - 10_000) {
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    fs.existsSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('subagents')) return Object.keys(metaFiles).length > 0
      return true
    })
    let readdirCall = 0
    fs.readdirSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('subagents')) {
        return Object.keys(metaFiles).map((k) => `agent-${k}.meta.json`)
      }
      // First call: project dirs listing (returns objects with isDirectory)
      // Second call: jsonl files listing (returns strings)
      readdirCall++
      if (readdirCall === 1) return [makeProjectDirEntry('C--project')]
      return ['sess.jsonl']
    })
    fs.statSync.mockReturnValue({ mtimeMs })
    fs.readFileSync.mockImplementation((p) => {
      if (typeof p === 'string' && p.includes('.meta.json')) {
        const agentId = Object.keys(metaFiles).find((k) => p.includes(k))
        return agentId ? JSON.stringify(metaFiles[agentId]) : '{}'
      }
      return jsonl
    })
    return getAllSessions()[0]
  }

  it('enriches subagent with agentType from meta file', () => {
    const main = makeRecord({ uuid: 'u1', isSidechain: false })
    const side = makeRecord({ uuid: 'u2', isSidechain: true, parentToolUseID: 'abc123' })
    const meta = { abc123: { agentType: 'Explore', description: 'Explore the codebase' } }
    const sess = setupSession([main, side], meta)
    const sub = sess.agentTree.subagents.find((s) => s.toolUseId === 'abc123')
    expect(sub.agentType).toBe('Explore')
    expect(sub.description).toBe('Explore the codebase')
  })

  it('returns null agentType when no meta file matches', () => {
    const main = makeRecord({ uuid: 'u1', isSidechain: false })
    const side = makeRecord({ uuid: 'u2', isSidechain: true, parentToolUseID: 'nomatch' })
    const sess = setupSession([main, side])
    const sub = sess.agentTree.subagents.find((s) => s.toolUseId === 'nomatch')
    expect(sub.agentType).toBeNull()
  })
})

describe('compaction detection', () => {
  function setupSession(records, mtimeMs = Date.now() - 10_000) {
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([makeProjectDirEntry('C--project')])
      .mockReturnValueOnce(['sess.jsonl'])
    fs.statSync.mockReturnValue({ mtimeMs })
    fs.readFileSync.mockReturnValue(jsonl)
    return getAllSessions()[0]
  }

  it('detects compaction from system message with continuation preamble', () => {
    const systemMsg = makeRecord({
      uuid: 's1',
      type: 'system',
      message: {
        content:
          'This session is being continued from a previous conversation that ran out of context.',
      },
    })
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const sess = setupSession([systemMsg, user])
    expect(sess.hasBeenCompacted).toBe(true)
    expect(sess.compactionSummary).toContain('continued from a previous conversation')
  })

  it('detects compaction from string message field', () => {
    const systemMsg = makeRecord({
      uuid: 's1',
      type: 'system',
      message:
        'This session is being continued from a previous conversation that ran out of context.',
    })
    const sess = setupSession([systemMsg])
    expect(sess.hasBeenCompacted).toBe(true)
  })

  it('sets hasBeenCompacted=false when no compaction preamble found', () => {
    const user = makeRecord({ uuid: 'u1', type: 'user' })
    const sess = setupSession([user])
    expect(sess.hasBeenCompacted).toBe(false)
    expect(sess.compactionSummary).toBeNull()
  })
})

describe('getSessionById()', () => {
  it('returns null when projects dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getSessionById('nonexistent')).toBeNull()
  })

  it('returns null when session file not found in any project dir', () => {
    fs.existsSync.mockImplementation((p) => {
      // Projects dir exists, but session file does not
      if (p.endsWith('projects')) return true
      return false
    })
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])

    expect(getSessionById('nonexistent')).toBeNull()
  })

  it('returns the matching session without scanning all files', () => {
    const record = makeRecord({ slug: 'my-proj' })

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([makeProjectDirEntry('C--project')])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionById('target-session')
    expect(result).not.toBeNull()
    expect(result.sessionId).toBe('target-session')
    // Verify it only called readFileSync once (for the target file, not all files)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('searches across multiple project dirs', () => {
    const record = makeRecord({ slug: 'found-it' })

    fs.existsSync.mockImplementation((p) => {
      // Only the second project dir has the session file
      if (p.includes('C--project-2') && p.endsWith('.jsonl')) return true
      if (p.endsWith('.jsonl')) return false
      return true // dirs exist
    })
    fs.readdirSync.mockReturnValue([
      makeProjectDirEntry('C--project-1'),
      makeProjectDirEntry('C--project-2'),
    ])
    fs.statSync.mockReturnValue(makeStat())
    fs.readFileSync.mockReturnValue(JSON.stringify(record))

    const result = getSessionById('my-session')
    expect(result).not.toBeNull()
    expect(result.sessionId).toBe('my-session')
  })
})
