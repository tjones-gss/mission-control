import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The hook bridge lives in packages/hook-server (opt-in, separable). It is pure
// Node with ZERO deps; we exercise it from the server runner so it stays in CI.
import { buildEvent, writeToolCallEvent } from '../../../../../packages/hook-server/hook-emitter.js'

describe('buildEvent', () => {
  it('maps a Claude Code PreToolUse hook payload to the normalized shape', () => {
    const ev = buildEvent({ session_id: 'abc', tool_name: 'Bash' }, 123)
    expect(ev).toEqual({ sessionId: 'abc', tool: 'Bash', ts: 123 })
  })

  it('returns null when session_id or tool_name is missing', () => {
    expect(buildEvent({ tool_name: 'Bash' }, 1)).toBeNull()
    expect(buildEvent({ session_id: 'abc' }, 1)).toBeNull()
    expect(buildEvent(null, 1)).toBeNull()
  })
})

describe('writeToolCallEvent', () => {
  let dir
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oversight-emitter-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('writes a JSON event file the cockpit can consume and returns its path', () => {
    const fp = writeToolCallEvent(dir, { sessionId: 's', tool: 'Read', ts: 7 })
    expect(fp).toBeTruthy()
    expect(fs.existsSync(fp)).toBe(true)
    expect(JSON.parse(fs.readFileSync(fp, 'utf8'))).toEqual({
      sessionId: 's',
      tool: 'Read',
      ts: 7,
    })
  })

  it('creates the drop dir if it does not exist', () => {
    const nested = path.join(dir, 'a', 'b')
    const fp = writeToolCallEvent(nested, { sessionId: 's', tool: 'Read', ts: 7 })
    expect(fs.existsSync(fp)).toBe(true)
  })

  it('uses distinct filenames for two events in the same session', () => {
    const fp1 = writeToolCallEvent(dir, { sessionId: 's', tool: 'Read', ts: 1 })
    const fp2 = writeToolCallEvent(dir, { sessionId: 's', tool: 'Read', ts: 2 })
    expect(fp1).not.toBe(fp2)
    expect(fs.readdirSync(dir)).toHaveLength(2)
  })

  it('returns null for an invalid event (no write)', () => {
    expect(writeToolCallEvent(dir, { tool: 'Read' })).toBeNull()
    expect(fs.readdirSync(dir)).toHaveLength(0)
  })
})
