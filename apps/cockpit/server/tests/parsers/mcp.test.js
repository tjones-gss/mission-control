vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      readdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(),
    },
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
    statSync: vi.fn(),
  }
})

import fs from 'fs'
import { getMcpServers, getMcpServersForSession } from '../../parsers/mcp.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getMcpServers()', () => {
  it('returns empty array when no settings exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getMcpServers()).toEqual([])
  })

  it('parses stdio MCP servers from settings', () => {
    const settings = {
      mcpServers: {
        'my-server': {
          command: 'node',
          args: ['server.js'],
          env: { API_KEY: 'secret' },
        },
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getMcpServers()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('my-server')
    expect(result[0].transportType).toBe('stdio')
    expect(result[0].command).toBe('node')
    expect(result[0].args).toEqual(['server.js'])
    expect(result[0].env).toEqual(['API_KEY'])
    expect(result[0].toolPrefix).toBe('mcp__my-server__')
    expect(result[0].scope).toBe('user')
  })

  it('detects SSE transport when url is present', () => {
    const settings = {
      mcpServers: {
        remote: { url: 'https://example.com/mcp' },
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getMcpServers()
    expect(result[0].transportType).toBe('sse')
    expect(result[0].url).toBe('https://example.com/mcp')
  })

  it('returns multiple servers', () => {
    const settings = {
      mcpServers: {
        'server-a': { command: 'a' },
        'server-b': { command: 'b' },
        'server-c': { url: 'http://c' },
      },
    }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getMcpServers()
    expect(result).toHaveLength(3)
  })

  it('handles malformed settings gracefully', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('not json')

    expect(getMcpServers()).toEqual([])
  })

  it('reads user-scope MCP servers from ~/.claude.json', () => {
    // Claude Code's `claude mcp add -s user` writes to ~/.claude.json,
    // not ~/.claude/settings.json — make sure we pick those up.
    const claudeJson = { mcpServers: { 'cli-added': { command: 'cli' } } }

    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation((p) => {
      if (String(p).endsWith('.claude.json')) return JSON.stringify(claudeJson)
      return JSON.stringify({})
    })

    const result = getMcpServers()
    expect(result.map((s) => s.name)).toEqual(['cli-added'])
    expect(result[0].scope).toBe('user')
  })

  it('merges ~/.claude.json and ~/.claude/settings.json without duplicates', () => {
    const claudeJson = { mcpServers: { shared: { command: 'a' }, only_json: { command: 'b' } } }
    const settings = {
      mcpServers: { shared: { command: 'IGNORED' }, only_settings: { command: 'c' } },
    }

    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation((p) => {
      const s = String(p)
      if (s.endsWith('.claude.json')) return JSON.stringify(claudeJson)
      if (s.endsWith('settings.json')) return JSON.stringify(settings)
      return JSON.stringify({})
    })

    const result = getMcpServers()
    const names = result.map((s) => s.name).sort()
    expect(names).toEqual(['only_json', 'only_settings', 'shared'])
    // For overlaps, .claude.json wins (canonical source for `claude mcp add`).
    const shared = result.find((s) => s.name === 'shared')
    expect(shared.command).toBe('a')
  })
})

describe('getMcpServersForSession()', () => {
  it('includes project-level MCP servers', () => {
    const userSettings = { mcpServers: { global: { command: 'g' } } }
    const projectSettings = { mcpServers: { 'local-proj': { command: 'l' } } }

    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockImplementation((p) => {
      const s = String(p)
      // User settings path contains homedir .claude, project path contains the cwd
      if (s.includes('myproject')) return JSON.stringify(projectSettings)
      return JSON.stringify(userSettings)
    })

    const result = getMcpServersForSession('/tmp/myproject')
    expect(result.length).toBeGreaterThanOrEqual(2)
    const names = result.map((s) => s.name)
    expect(names).toContain('global')
    expect(names).toContain('local-proj')
  })

  it('returns user servers when cwd is null', () => {
    const settings = { mcpServers: { srv: { command: 'x' } } }
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(JSON.stringify(settings))

    const result = getMcpServersForSession(null)
    expect(result).toHaveLength(1)
    expect(result[0].scope).toBe('user')
  })
})
