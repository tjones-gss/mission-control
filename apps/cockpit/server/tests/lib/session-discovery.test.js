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

import fs from 'fs'
import { getSessionCwds } from '../../lib/session-discovery.js'

const PROJECTS = path.join(os.homedir(), '.claude', 'projects')
const PROJECT_A = 'C:\\projects\\foo'

beforeEach(() => {
  vi.resetAllMocks()
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
})
