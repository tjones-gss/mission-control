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
import { getHistory } from '../../parsers/history.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getHistory()', () => {
  it('returns [] when history file does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getHistory()).toEqual([])
  })

  it('returns [] when history file is empty', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('')
    expect(getHistory()).toEqual([])
  })

  it('parses valid JSONL lines and returns them newest-first', () => {
    const entry1 = { command: 'git status', timestamp: '2024-01-01T00:00:00Z' }
    const entry2 = { command: 'ls', timestamp: '2024-01-02T00:00:00Z' }
    const jsonl = [JSON.stringify(entry1), JSON.stringify(entry2)].join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getHistory()
    // reversed = newest first (entry2 is last line so it becomes first)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual(entry2)
    expect(result[1]).toEqual(entry1)
  })

  it('skips malformed JSON lines', () => {
    const entry = { command: 'valid', timestamp: '2024-01-01T00:00:00Z' }
    const jsonl = [JSON.stringify(entry), 'NOT JSON {{{'].join('\n')

    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(jsonl)

    const result = getHistory()
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(entry)
  })

  it('respects the limit parameter', () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({ command: `cmd-${i}`, timestamp: `2024-01-0${i + 1}` }),
    )
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(3)
    // slice(-3) takes last 3 lines, then reverse
    expect(result).toHaveLength(3)
  })

  it('returns last N lines when file has more entries than limit', () => {
    const lines = [
      JSON.stringify({ command: 'old-1' }),
      JSON.stringify({ command: 'old-2' }),
      JSON.stringify({ command: 'recent-1' }),
      JSON.stringify({ command: 'recent-2' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(2)
    expect(result).toHaveLength(2)
    // slice(-2) = ['recent-1', 'recent-2'], reversed = ['recent-2', 'recent-1']
    expect(result[0].command).toBe('recent-2')
    expect(result[1].command).toBe('recent-1')
  })

  it('returns all entries when limit is larger than file contents', () => {
    const lines = [JSON.stringify({ command: 'a' }), JSON.stringify({ command: 'b' })]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100)
    expect(result).toHaveLength(2)
  })

  it('handles file with only whitespace/blank lines', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue('   \n\n  \n')

    const result = getHistory()
    expect(result).toEqual([])
  })
})

// ─── getHistory() with offset and filters ────────────────────────────────────

describe('getHistory() with offset', () => {
  it('returns entries starting at offset', () => {
    const lines = Array.from({ length: 5 }, (_, i) =>
      JSON.stringify({ display: `cmd-${i}`, timestamp: i * 1000, project: '/p' }),
    )
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    // All 5 reversed = [cmd-4, cmd-3, cmd-2, cmd-1, cmd-0]. offset=2, limit=2 → [cmd-2, cmd-1]
    const result = getHistory(2, 2)
    expect(result).toHaveLength(2)
    expect(result[0].display).toBe('cmd-2')
    expect(result[1].display).toBe('cmd-1')
  })

  it('filters by project', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/projectA' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/projectB' }),
      JSON.stringify({ display: 'c', timestamp: 3000, project: '/projectA' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { project: '/projectA' })
    expect(result).toHaveLength(2)
    expect(result.every((e) => e.project === '/projectA')).toBe(true)
  })

  it('filters by from timestamp', () => {
    const lines = [
      JSON.stringify({ display: 'old', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'new', timestamp: 5000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { from: 3000 })
    expect(result).toHaveLength(1)
    expect(result[0].display).toBe('new')
  })

  it('filters by to timestamp', () => {
    const lines = [
      JSON.stringify({ display: 'old', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'new', timestamp: 5000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))

    const result = getHistory(100, 0, { to: 2000 })
    expect(result).toHaveLength(1)
    expect(result[0].display).toBe('old')
  })
})

// ─── getHistoryStats() ────────────────────────────────────────────────────────

import { getHistoryStats } from '../../parsers/history.js'

describe('getHistoryStats()', () => {
  it('returns zeroed stats when file does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    const stats = getHistoryStats()
    expect(stats.total).toBe(0)
    expect(stats.topCommand).toBeNull()
    expect(stats.topProject).toBeNull()
    expect(stats.today).toBe(0)
    expect(stats.dailyActivity).toHaveLength(7)
    expect(stats.dailyActivity.every((d) => d.count === 0)).toBe(true)
  })

  it('counts total entries', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().total).toBe(2)
  })

  it('identifies top command', () => {
    const lines = [
      JSON.stringify({ display: 'git status', timestamp: 1000, project: '/p' }),
      JSON.stringify({ display: 'git status', timestamp: 2000, project: '/p' }),
      JSON.stringify({ display: 'ls', timestamp: 3000, project: '/p' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().topCommand).toBe('git status')
  })

  it('identifies top project', () => {
    const lines = [
      JSON.stringify({ display: 'a', timestamp: 1000, project: '/projectA' }),
      JSON.stringify({ display: 'b', timestamp: 2000, project: '/projectA' }),
      JSON.stringify({ display: 'c', timestamp: 3000, project: '/projectB' }),
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(lines.join('\n'))
    expect(getHistoryStats().topProject).toBe('/projectA')
  })

  it('returns 7 daily activity buckets', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(
      JSON.stringify({ display: 'a', timestamp: Date.now(), project: '/p' }),
    )
    const { dailyActivity } = getHistoryStats()
    expect(dailyActivity).toHaveLength(7)
    expect(dailyActivity[6].count).toBeGreaterThanOrEqual(1) // today
  })

  it('skips malformed lines', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readFileSync.mockReturnValue(
      'NOT JSON\n' + JSON.stringify({ display: 'a', timestamp: 1000, project: '/p' }),
    )
    expect(getHistoryStats().total).toBe(1)
  })
})
