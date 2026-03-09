vi.mock('fs', () => {
  const promises = {
    access: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(),
    mkdir: vi.fn(), unlink: vi.fn(),
  }
  return {
    default: { existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises },
    existsSync: vi.fn(), readdirSync: vi.fn(), readFileSync: vi.fn(), promises,
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
      JSON.stringify({ command: `cmd-${i}`, timestamp: `2024-01-0${i + 1}` })
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
    const lines = [
      JSON.stringify({ command: 'a' }),
      JSON.stringify({ command: 'b' }),
    ]
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
