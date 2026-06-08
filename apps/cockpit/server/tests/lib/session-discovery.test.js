import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

vi.mock('fs', () => {
  const api = {
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    openSync: vi.fn(),
    readSync: vi.fn(),
    closeSync: vi.fn(),
  }
  return { default: api, ...api }
})

vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
}))

import fs from 'fs'
import { getSessionCwds } from '../../lib/session-discovery.js'
import { emit } from '../../sse.js'
import { _resetDegradedDedupe } from '../../lib/claude-format.js'

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const PROJECT_A = 'C:\\projects\\foo'

beforeEach(() => {
  vi.resetAllMocks()
  _resetDegradedDedupe()
})

describe('getSessionCwds()', () => {
  it('returns [] when the projects dir is missing', () => {
    fs.existsSync.mockReturnValue(false)
    expect(getSessionCwds()).toEqual([])
  })

  it('returns [] (never throws) when the projects dir read fails', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(getSessionCwds()).toEqual([])
  })

  it('scans the first ~8KB of each session JSONL to extract cwd', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }]) // project dirs
      .mockReturnValueOnce(['session-1.jsonl']) // jsonl files
    fs.openSync.mockReturnValue(7)
    const firstLine = JSON.stringify({ cwd: PROJECT_A, type: 'system' }) + '\n'
    fs.readSync.mockImplementation((_fd, buf) => buf.write(firstLine, 0, 'utf-8'))
    expect(getSessionCwds()).toEqual([PROJECT_A])
    expect(PROJECTS).toContain('.claude')
  })

  it('dedupes cwds across multiple session files', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['s1.jsonl', 's2.jsonl'])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockImplementation((_fd, buf) =>
      buf.write(JSON.stringify({ cwd: PROJECT_A }) + '\n', 0, 'utf-8'),
    )
    expect(getSessionCwds()).toEqual([PROJECT_A])
  })

  it('emits a degraded signal when a non-empty session has no cwd in the 8KB prefix', () => {
    // The fixed-prefix scan can MISS: a session whose cwd lives past 8192 bytes
    // is silently dropped today. That silent drop is a diagnostic blind spot —
    // flag it as a degraded signal rather than vanishing the project.
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
    fs.openSync.mockReturnValue(7)
    // Non-empty bytes, several complete lines, none carrying cwd.
    const noCwd =
      JSON.stringify({ type: 'ai-title', aiTitle: 'x' }) +
      '\n' +
      JSON.stringify({ type: 'system', foo: 'bar' }) +
      '\n'
    fs.readSync.mockImplementation((_fd, buf) => buf.write(noCwd, 0, 'utf-8'))
    expect(getSessionCwds()).toEqual([])
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'session-discovery' }),
    )
  })

  it('does not emit a degraded signal for an empty (zero-byte) session file', () => {
    fs.existsSync.mockReturnValue(true)
    fs.readdirSync
      .mockReturnValueOnce([{ name: 'proj-a', isDirectory: () => true }])
      .mockReturnValueOnce(['session-1.jsonl'])
    fs.openSync.mockReturnValue(7)
    fs.readSync.mockReturnValue(0) // zero bytes read → empty file, not a miss
    expect(getSessionCwds()).toEqual([])
    expect(emit).not.toHaveBeenCalled()
  })
})
