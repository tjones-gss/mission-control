import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Mock the shared SSE channel — assert the receiver broadcasts on the SAME
// channel the watcher uses (emit), so tool_call reaches every connected client.
const emit = vi.fn()
vi.mock('../../sse.js', () => ({ emit: (...a) => emit(...a) }))
vi.mock('../../lib/logger.js', () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { receiveHookEvent, consumeHookLogFile } from '../../lib/hook-receiver.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('receiveHookEvent', () => {
  it('emits a normalized tool_call SSE event for a valid hook event', () => {
    const r = receiveHookEvent({ sessionId: 'sess-1', tool: 'Bash', ts: 1700000000000 })
    expect(r.ok).toBe(true)
    expect(emit).toHaveBeenCalledTimes(1)
    const [name, payload] = emit.mock.calls[0]
    expect(name).toBe('tool_call')
    expect(payload).toMatchObject({
      type: 'tool_call',
      sessionId: 'sess-1',
      tool: 'Bash',
      ts: 1700000000000,
    })
  })

  it('defaults a missing ts to a number so the client can animate immediately', () => {
    const r = receiveHookEvent({ sessionId: 's', tool: 'Read' })
    expect(r.ok).toBe(true)
    expect(typeof emit.mock.calls[0][1].ts).toBe('number')
  })

  it('rejects an event with no sessionId and emits nothing', () => {
    const r = receiveHookEvent({ tool: 'Bash' })
    expect(r.ok).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('rejects an event with no tool and emits nothing', () => {
    const r = receiveHookEvent({ sessionId: 's' })
    expect(r.ok).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('rejects a non-object payload', () => {
    expect(receiveHookEvent(null).ok).toBe(false)
    expect(receiveHookEvent('nope').ok).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('coerces tool/sessionId to trimmed strings and drops unknown fields', () => {
    const r = receiveHookEvent({
      sessionId: '  sess-2  ',
      tool: '  Edit  ',
      ts: 5,
      secret: 'drop-me',
    })
    expect(r.ok).toBe(true)
    const payload = emit.mock.calls[0][1]
    expect(payload.sessionId).toBe('sess-2')
    expect(payload.tool).toBe('Edit')
    expect(payload.secret).toBeUndefined()
  })
})

describe('consumeHookLogFile', () => {
  let tmpDir
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oversight-hooklog-'))
  })
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads a dropped event file, emits tool_call, and consumes (deletes) the file', () => {
    const fp = path.join(tmpDir, 'sess-1-1.json')
    fs.writeFileSync(fp, JSON.stringify({ sessionId: 'sess-1', tool: 'Bash', ts: 9 }))
    const r = consumeHookLogFile(fp)
    expect(r.ok).toBe(true)
    expect(emit).toHaveBeenCalledWith('tool_call', expect.objectContaining({ tool: 'Bash' }))
    expect(fs.existsSync(fp)).toBe(false)
  })

  it('deletes a poison (unparseable) file without emitting', () => {
    const fp = path.join(tmpDir, 'bad-1.json')
    fs.writeFileSync(fp, 'not json{')
    const r = consumeHookLogFile(fp)
    expect(r.ok).toBe(false)
    expect(emit).not.toHaveBeenCalled()
    expect(fs.existsSync(fp)).toBe(false)
  })

  it('ignores a non-.json path', () => {
    const fp = path.join(tmpDir, 'note.txt')
    fs.writeFileSync(fp, 'hello')
    const r = consumeHookLogFile(fp)
    expect(r.ok).toBe(false)
    expect(emit).not.toHaveBeenCalled()
    expect(fs.existsSync(fp)).toBe(true) // not ours — left alone
  })
})
