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
import { getTasksForSession, getAllTaskSessions } from '../../parsers/tasks.js'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('getTasksForSession()', () => {
  it('returns [] when session dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getTasksForSession('sess-abc')).toEqual([])
  })

  it('returns [] when session dir is empty', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    expect(getTasksForSession('sess-abc')).toEqual([])
  })

  it('parses valid JSON task files and sorts by numeric id', () => {
    const task1 = { id: '2', title: 'Second' }
    const task2 = { id: '1', title: 'First' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['2.json', '1.json'])
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify(task1))
      .mockReturnValueOnce(JSON.stringify(task2))

    const result = getTasksForSession('sess-abc')
    expect(result).toHaveLength(2)
    // Sorted by numeric id ascending
    expect(result[0].id).toBe('1')
    expect(result[1].id).toBe('2')
  })

  it('skips malformed JSON files', () => {
    const task = { id: '1', title: 'Good' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['1.json', 'bad.json'])
    fs.readFileSync.mockReturnValueOnce(JSON.stringify(task)).mockImplementationOnce(() => {
      throw new Error('bad JSON')
    })

    const result = getTasksForSession('sess-abc')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
  })

  it('ignores non-.json files', () => {
    const task = { id: '1', title: 'Task' }
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['notes.txt', '1.json'])
    fs.readFileSync.mockReturnValue(JSON.stringify(task))

    const result = getTasksForSession('sess-abc')
    expect(result).toHaveLength(1)
    expect(fs.readFileSync).toHaveBeenCalledTimes(1)
  })

  it('returns tasks sorted correctly with single-digit and multi-digit ids', () => {
    const tasks = [
      { id: '10', title: 'Ten' },
      { id: '2', title: 'Two' },
      { id: '1', title: 'One' },
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(['10.json', '2.json', '1.json'])
    fs.readFileSync
      .mockReturnValueOnce(JSON.stringify(tasks[0]))
      .mockReturnValueOnce(JSON.stringify(tasks[1]))
      .mockReturnValueOnce(JSON.stringify(tasks[2]))

    const result = getTasksForSession('sess-abc')
    expect(result.map((t) => t.id)).toEqual(['1', '2', '10'])
  })
})

describe('getAllTaskSessions()', () => {
  it('returns [] when tasks dir does not exist', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getAllTaskSessions()).toEqual([])
  })

  it('returns [] when tasks dir has no subdirectories', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue([])
    expect(getAllTaskSessions()).toEqual([])
  })

  it('returns session ids from subdirectory names', () => {
    const fakeDirs = [
      { name: 'session-1', isDirectory: () => true },
      { name: 'session-2', isDirectory: () => true },
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(fakeDirs)

    const result = getAllTaskSessions()
    expect(result).toEqual(['session-1', 'session-2'])
  })

  it('filters out files (non-directories)', () => {
    const entries = [
      { name: 'session-1', isDirectory: () => true },
      { name: 'somefile.json', isDirectory: () => false },
    ]
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockReturnValue(entries)

    const result = getAllTaskSessions()
    expect(result).toEqual(['session-1'])
  })
})
