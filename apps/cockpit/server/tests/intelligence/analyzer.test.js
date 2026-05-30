import { describe, it, expect, vi, beforeEach } from 'vitest'
import { analyzeSession } from '../../intelligence/analyzer.js'

vi.mock('../../claude-cli.js', () => ({
  runClaude: vi.fn(),
}))

import { runClaude } from '../../claude-cli.js'

function makeSession(overrides = {}) {
  return {
    sessionId: 'abcdef1234567890',
    slug: null,
    cwd: '/home/user/project',
    model: 'claude-sonnet-4-20250514',
    gitBranch: 'main',
    isActive: true,
    agentTree: { mainMessageCount: 10, subagents: [] },
    toolUseCounts: {},
    tokenUsage: { input: 1000, output: 500, cacheRead: 200 },
    lastThought: 'Thinking about the problem',
    lastAction: { name: 'Read', summary: 'Read file foo.js' },
    lastText: 'Here is the answer',
    messageCount: 25,
    ...overrides,
  }
}

function makeClaudeResult(intelligence) {
  return {
    stdout: JSON.stringify({
      result: JSON.stringify(intelligence),
    }),
  }
}

const defaultIntelligence = {
  goal: 'Implement feature X',
  progress: 'Halfway done',
  flags: [],
  subagents: 'none',
  recommendation: null,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('analyzeSession', () => {
  it('calls runClaude with correct args', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(makeSession())

    expect(runClaude).toHaveBeenCalledOnce()
    const callArgs = runClaude.mock.calls[0][0]
    expect(callArgs.args).toContain('--output-format')
    expect(callArgs.args).toContain('json')
    expect(callArgs.args).toContain('--mcp-config')
    expect(callArgs.args).toContain('--strict-mcp-config')
    expect(callArgs.args).toContain('--no-session-persistence')
    expect(callArgs.timeoutMs).toBe(60_000)
  })

  it('parses stdout JSON with .result field', async () => {
    const intel = {
      goal: 'Build API',
      progress: 'Starting',
      flags: ['slow'],
      subagents: 'none',
      recommendation: 'Speed up',
    }
    runClaude.mockResolvedValue({
      stdout: JSON.stringify({ result: JSON.stringify(intel) }),
    })

    const result = await analyzeSession(makeSession())
    expect(result.goal).toBe('Build API')
    expect(result.progress).toBe('Starting')
    expect(result.flags).toEqual(['slow'])
    expect(result.recommendation).toBe('Speed up')
  })

  it('parses stdout JSON with .content field', async () => {
    const intel = {
      goal: 'Fix bug',
      progress: 'Done',
      flags: [],
      subagents: 'none',
      recommendation: null,
    }
    runClaude.mockResolvedValue({
      stdout: JSON.stringify({ content: JSON.stringify(intel) }),
    })

    const result = await analyzeSession(makeSession())
    expect(result.goal).toBe('Fix bug')
    expect(result.progress).toBe('Done')
  })

  it('falls back to raw stdout when no .result or .content', async () => {
    const intel = {
      goal: 'Deploy app',
      progress: 'Pending',
      flags: [],
      subagents: 'none',
      recommendation: null,
    }
    runClaude.mockResolvedValue({
      stdout: JSON.stringify(intel),
    })

    const result = await analyzeSession(makeSession())
    expect(result.goal).toBe('Deploy app')
  })

  it('throws on completely malformed stdout', async () => {
    runClaude.mockResolvedValue({ stdout: '<<<not json at all>>>' })

    await expect(analyzeSession(makeSession())).rejects.toThrow('Failed to parse claude output')
  })
})

describe('buildPrompt (via runClaude args)', () => {
  it('includes session slug when present', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(makeSession({ slug: 'my-cool-session' }))

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('my-cool-session')
  })

  it('falls back to sessionId prefix when no slug', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(makeSession({ slug: null, sessionId: 'xyz789abcdef0000' }))

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('xyz789ab')
  })

  it('includes cwd, model, gitBranch, isActive', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(
      makeSession({
        cwd: '/tmp/work',
        model: 'opus-5',
        gitBranch: 'feature/login',
        isActive: false,
      }),
    )

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('CWD: /tmp/work')
    expect(prompt).toContain('Model: opus-5')
    expect(prompt).toContain('Branch: feature/login')
    expect(prompt).toContain('Active: false')
  })

  it('includes agent tree summary and subagent details', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(
      makeSession({
        agentTree: {
          mainMessageCount: 15,
          subagents: [
            { description: 'Linting subagent', messageCount: 5 },
            { description: 'Testing subagent', messageCount: 8 },
          ],
        },
      }),
    )

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('main=15 messages, 2 subagents')
    expect(prompt).toContain('Subagent: Linting subagent (5 msgs)')
    expect(prompt).toContain('Subagent: Testing subagent (8 msgs)')
  })

  it('includes top 5 tools sorted by count', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(
      makeSession({
        toolUseCounts: {
          Read: 50,
          Write: 30,
          Bash: 20,
          Grep: 15,
          Glob: 10,
          Edit: 5,
        },
      }),
    )

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('Top tools:')
    expect(prompt).toContain('Read\u00d750')
    expect(prompt).toContain('Glob\u00d710')
    // Edit (6th) should NOT appear in top 5
    expect(prompt).not.toContain('Edit\u00d75')
  })

  it('includes token usage line', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(
      makeSession({
        tokenUsage: { input: 5000, output: 2000, cacheRead: 800 },
      }),
    )

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('Tokens: input=5000 output=2000 cacheRead=800')
  })

  it('includes lastThought truncated to 200 chars', async () => {
    const longThought = 'A'.repeat(300)
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(makeSession({ lastThought: longThought }))

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('Last thought: ' + 'A'.repeat(200))
    expect(prompt).not.toContain('A'.repeat(201))
  })

  it('includes lastAction name and summary', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))
    await analyzeSession(
      makeSession({
        lastAction: { name: 'Bash', summary: 'Ran npm test' },
      }),
    )

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('Last action: Bash \u2014 Ran npm test')
  })

  it('handles missing/null fields gracefully', async () => {
    runClaude.mockResolvedValue(makeClaudeResult(defaultIntelligence))

    await expect(
      analyzeSession(
        makeSession({
          slug: null,
          cwd: null,
          model: null,
          gitBranch: null,
          agentTree: null,
          toolUseCounts: null,
          tokenUsage: null,
          lastThought: null,
          lastAction: null,
          lastText: null,
          messageCount: null,
        }),
      ),
    ).resolves.toBeDefined()

    const prompt = runClaude.mock.calls[0][0].args[1]
    expect(prompt).toContain('CWD: unknown')
    expect(prompt).toContain('Model: unknown')
    expect(prompt).toContain('Branch: unknown')
  })
})

describe('parseIntelligence (via analyzeSession return)', () => {
  it('strips markdown ```json code fences', async () => {
    const json = JSON.stringify(defaultIntelligence)
    runClaude.mockResolvedValue({
      stdout: JSON.stringify({ result: '```json\n' + json + '\n```' }),
    })

    const result = await analyzeSession(makeSession())
    expect(result.goal).toBe('Implement feature X')
    expect(result.progress).toBe('Halfway done')
  })

  it('validates and coerces output shape', async () => {
    runClaude.mockResolvedValue({
      stdout: JSON.stringify({
        result: JSON.stringify({
          goal: 123,
          progress: null,
          flags: ['warn1', 'warn2'],
          subagents: undefined,
          recommendation: 'Do something',
        }),
      }),
    })

    const result = await analyzeSession(makeSession())
    expect(typeof result.goal).toBe('string')
    expect(typeof result.progress).toBe('string')
    expect(Array.isArray(result.flags)).toBe(true)
    expect(result.flags).toEqual(['warn1', 'warn2'])
    expect(typeof result.subagents).toBe('string')
    expect(result.recommendation).toBe('Do something')
  })

  it('coerces non-array flags to empty array', async () => {
    runClaude.mockResolvedValue({
      stdout: JSON.stringify({
        result: JSON.stringify({
          goal: 'Test',
          progress: 'Done',
          flags: 'not-an-array',
          subagents: 'none',
          recommendation: null,
        }),
      }),
    })

    const result = await analyzeSession(makeSession())
    expect(result.flags).toEqual([])
    expect(result.recommendation).toBeNull()
  })
})
