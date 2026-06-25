// Phase S1 — build-outcome log.
//
// When a meta session (Oversight building itself) commits, its outcome is
// recorded to an append-only server/data/build-log.jsonl so every build session
// has a durable, verifiable record. Commit detection is deterministic (no LLM)
// from the transcript. The append-only contract mirrors anomalies.jsonl.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {
  setBuildLogPath,
  getBuildLogPath,
  recordBuildOutcome,
  readBuildLog,
  sessionDidCommit,
  runBuildVerification,
} from '../../intelligence/build-log.js'

let tmpDir
let logPath
const ORIG = getBuildLogPath()

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-buildlog-test-'))
  logPath = path.join(tmpDir, 'build-log.jsonl')
  setBuildLogPath(logPath)
})

afterEach(() => {
  setBuildLogPath(ORIG)
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('sessionDidCommit', () => {
  it('is true when the transcript contains a git commit', () => {
    const records = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git commit -m "x"' } }],
        },
      },
    ]
    expect(sessionDidCommit(records)).toBe(true)
  })

  it('is false for a transcript with no commit (git status only)', () => {
    const records = [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', name: 'Bash', input: { command: 'git status' } }],
        },
      },
    ]
    expect(sessionDidCommit(records)).toBe(false)
  })

  it('is false for an empty/invalid transcript', () => {
    expect(sessionDidCommit([])).toBe(false)
    expect(sessionDidCommit(null)).toBe(false)
  })
})

describe('recordBuildOutcome + readBuildLog', () => {
  it('appends a build_outcome record and reads it back', () => {
    recordBuildOutcome({ sessionId: 's1', committed: true, now: 1000 })
    const log = readBuildLog()
    expect(log).toHaveLength(1)
    expect(log[0]).toMatchObject({
      type: 'build_outcome',
      sessionId: 's1',
      committed: true,
      ts: 1000,
    })
  })

  it('is append-only — earlier records are never mutated by later writes', () => {
    recordBuildOutcome({ sessionId: 's1', committed: true, now: 1000 })
    recordBuildOutcome({ sessionId: 's2', committed: false, now: 2000 })
    const log = readBuildLog()
    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({ sessionId: 's1', ts: 1000 })
    expect(log[1]).toMatchObject({ sessionId: 's2', ts: 2000 })
  })

  it('carries an optional test result when provided', () => {
    recordBuildOutcome({
      sessionId: 's1',
      committed: true,
      test: { passed: false, code: 1 },
      now: 5,
    })
    expect(readBuildLog()[0].test).toEqual({ passed: false, code: 1 })
  })

  it('returns an empty array when no log exists yet', () => {
    expect(readBuildLog()).toEqual([])
  })
})

describe('runBuildVerification', () => {
  it('is a no-op (returns null) unless explicitly enabled via env', async () => {
    delete process.env.OVERSIGHT_BUILD_VERIFY
    expect(await runBuildVerification()).toBeNull()
  })
})
