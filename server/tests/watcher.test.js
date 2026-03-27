import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

const CLAUDE_DIR = path.join(os.homedir(), '.claude')

const handlers = {}
const fakeWatcher = {
  on: vi.fn((event, handler) => {
    handlers[event] = handler
    return fakeWatcher
  }),
}

vi.mock('chokidar', () => ({
  default: {
    watch: vi.fn(() => fakeWatcher),
  },
}))

vi.mock('../sse.js', () => ({
  emit: vi.fn(),
  addClient: vi.fn(),
  removeClient: vi.fn(),
}))

vi.mock('../intelligence/triggers.js', () => ({
  onSessionEvent: vi.fn(),
}))

import chokidar from 'chokidar'
import { emit } from '../sse.js'
import { onSessionEvent } from '../intelligence/triggers.js'
import { startWatcher } from '../watcher.js'

describe('watcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const key of Object.keys(handlers)) {
      delete handlers[key]
    }
  })

  it('creates chokidar.watch with the correct CLAUDE_DIR path', () => {
    startWatcher()
    expect(chokidar.watch).toHaveBeenCalledWith(
      CLAUDE_DIR,
      expect.objectContaining({ persistent: true, ignoreInitial: true })
    )
  })

  it('emits session_update on change for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'myproject', 'abc123.jsonl')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('session_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('calls onSessionEvent with sessionId on change for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'myproject', 'sess42.jsonl')
    handlers.change(filePath)
    expect(onSessionEvent).toHaveBeenCalledWith('sess42')
  })

  it('emits task_update on change for tasks/*', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'tasks', 'task1.json')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('task_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('emits team_update on change for teams/*', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'teams', 'team-a.json')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('team_update', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('emits history_update on change for history.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'history.jsonl')
    handlers.change(filePath)
    expect(emit).toHaveBeenCalledWith('history_update', {
      ts: expect.any(Number),
    })
  })

  it('does not emit for unrecognized paths on change', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'random', 'unknown.txt')
    handlers.change(filePath)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emits new_session on add for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'newsess.jsonl')
    handlers.add(filePath)
    expect(emit).toHaveBeenCalledWith('new_session', {
      filePath: path.relative(CLAUDE_DIR, filePath),
      ts: expect.any(Number),
    })
  })

  it('calls onSessionEvent with sessionId on add for projects/*.jsonl', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'addsess.jsonl')
    handlers.add(filePath)
    expect(onSessionEvent).toHaveBeenCalledWith('addsess')
  })

  it('does not emit on add for non-.jsonl files in projects/', () => {
    startWatcher()
    const filePath = path.join(CLAUDE_DIR, 'projects', 'proj', 'readme.txt')
    handlers.add(filePath)
    expect(emit).not.toHaveBeenCalled()
    expect(onSessionEvent).not.toHaveBeenCalled()
  })
})
