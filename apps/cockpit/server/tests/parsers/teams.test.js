vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    readFileSync: vi.fn(),
  },
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
}))

import fs from 'fs'
import { getAllTeams } from '../../parsers/teams.js'
import { emit } from '../../sse.js'
import { isDegraded, _resetDegradedDedupe } from '../../lib/claude-format.js'

beforeEach(() => {
  vi.resetAllMocks()
  _resetDegradedDedupe()
})

describe('getAllTeams()', () => {
  it('returns empty array when teams dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getAllTeams()).toEqual([])
  })

  it('returns teams with config and inboxes', () => {
    const config = { name: 'team-alpha', members: ['alice', 'bob'] }
    const inboxMessages = [{ id: 1, text: 'hello' }]

    fs.existsSync.mockImplementation((p) => {
      if (p.includes('teams')) return true
      if (p.includes('config.json')) return true
      if (p.includes('inboxes')) return true
      return false
    })
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [{ name: 'team-alpha', isDirectory: () => true }]
      }
      // inboxes dir listing
      if (p.includes('inboxes')) return ['agent1.json']
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('config.json')) return JSON.stringify(config)
      if (p.includes('agent1.json')) return JSON.stringify(inboxMessages)
      return '{}'
    })

    const result = getAllTeams()
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('team-alpha')
    expect(result[0].members).toEqual(['alice', 'bob'])
    expect(result[0].inboxes).toEqual({ agent1: inboxMessages })
  })

  it('skips directories without config.json', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('config.json')) return false
      return true
    })
    fs.readdirSync.mockReturnValue([{ name: 'no-config-team', isDirectory: () => true }])

    expect(getAllTeams()).toEqual([])
  })

  it('surfaces a present-but-unparseable team config.json as degraded (not silently dropped)', () => {
    // A team dir exists with a config.json we cannot parse. Silently dropping it
    // (returning []) would render "no teams" when a team is in fact configured —
    // a blank that looks like a fact. It must surface as a distinguishable
    // degraded marker AND emit a persistent parser_degraded SSE event.
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('inboxes')) return false
      return true
    })
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [{ name: 'bad-team', isDirectory: () => true }]
      }
      return []
    })
    fs.readFileSync.mockReturnValue('not valid json{{{')

    const result = getAllTeams()
    expect(result).toHaveLength(1)
    expect(isDegraded(result[0])).toBe(true)
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'teams' }),
    )
  })

  it('stays silent (no degrade) for a team dir with no config.json — nothing configured', () => {
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('config.json')) return false
      return true
    })
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) return [{ name: 'no-config', isDirectory: () => true }]
      return []
    })

    expect(getAllTeams()).toEqual([])
    expect(emit).not.toHaveBeenCalled()
  })

  it('returns empty inboxes when inboxes dir does not exist', () => {
    const config = { name: 'team-no-inbox' }

    fs.existsSync.mockImplementation((p) => {
      if (p.includes('inboxes')) return false
      return true
    })
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [{ name: 'team-no-inbox', isDirectory: () => true }]
      }
      return []
    })
    fs.readFileSync.mockReturnValue(JSON.stringify(config))

    const result = getAllTeams()
    expect(result).toHaveLength(1)
    expect(result[0].inboxes).toEqual({})
  })

  it('surfaces a present-but-unparseable inbox as degraded (not a misreported empty inbox)', () => {
    // An inbox file that exists but cannot be parsed must NOT read as [] — that
    // would render "no messages waiting" when messages may in fact be queued.
    // It must be a distinguishable degraded marker + a persistent SSE event.
    const config = { name: 'team-bad-inbox' }

    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [{ name: 'team-bad-inbox', isDirectory: () => true }]
      }
      if (p.includes('inboxes')) return ['broken.json']
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('config.json')) return JSON.stringify(config)
      if (p.includes('broken.json')) return '{invalid'
      return '{}'
    })

    const result = getAllTeams()
    expect(result).toHaveLength(1)
    expect(isDegraded(result[0].inboxes.broken)).toBe(true)
    expect(result[0].inboxes.broken).not.toEqual([])
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'teams' }),
    )
  })

  it('ignores non-directory entries in teams dir', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([{ name: 'a-file.txt', isDirectory: () => false }])

    expect(getAllTeams()).toEqual([])
  })

  it('handles multiple teams', () => {
    const config1 = { name: 'team-a' }
    const config2 = { name: 'team-b' }

    fs.existsSync.mockImplementation((p) => {
      if (p.includes('inboxes')) return false
      return true
    })
    fs.readdirSync.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [
          { name: 'team-a', isDirectory: () => true },
          { name: 'team-b', isDirectory: () => true },
        ]
      }
      return []
    })
    fs.readFileSync.mockImplementation((p) => {
      if (p.includes('team-a')) return JSON.stringify(config1)
      if (p.includes('team-b')) return JSON.stringify(config2)
      return '{}'
    })

    const result = getAllTeams()
    expect(result).toHaveLength(2)
    expect(result.map((t) => t.name)).toEqual(['team-a', 'team-b'])
  })
})
