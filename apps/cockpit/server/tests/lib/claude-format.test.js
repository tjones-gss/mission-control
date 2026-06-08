import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../sse.js', () => ({
  emit: vi.fn(),
}))

import { emit } from '../../sse.js'
import {
  DEGRADED_MARKER,
  makeDegraded,
  isDegraded,
  readClaudeJson,
  signalDegraded,
  _resetDegradedDedupe,
} from '../../lib/claude-format.js'

beforeEach(() => {
  vi.resetAllMocks()
  _resetDegradedDedupe()
})

describe('makeDegraded() / isDegraded()', () => {
  it('produces a marker distinguishable from an empty object', () => {
    const marker = makeDegraded('sessions', 'lines>0 but parsed==0')
    expect(isDegraded(marker)).toBe(true)
    expect(isDegraded({})).toBe(false)
    expect(isDegraded([])).toBe(false)
    expect(isDegraded(null)).toBe(false)
    // The marker must carry the discriminator field, not be a bare {}
    expect(marker[DEGRADED_MARKER]).toBe(true)
    expect(marker.parser).toBe('sessions')
    expect(marker.reason).toBe('lines>0 but parsed==0')
  })

  it('never confuses a "none configured" empty object for degraded', () => {
    // settings.json present but empty {} is "none configured", NOT degraded.
    expect(isDegraded({ hooks: {} })).toBe(false)
  })
})

describe('signalDegraded()', () => {
  it('emits exactly one parser_degraded SSE event per parser+reason', () => {
    signalDegraded('sessions', 'format-change', { filePath: '/a.jsonl' })
    signalDegraded('sessions', 'format-change', { filePath: '/a.jsonl' })
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'sessions', reason: 'format-change' }),
    )
  })

  it('emits again for a distinct parser', () => {
    signalDegraded('sessions', 'format-change')
    signalDegraded('config', 'parse-failed')
    expect(emit).toHaveBeenCalledTimes(2)
  })
})

describe('readClaudeJson()', () => {
  it('returns absent when the file does not exist (normal, not degraded)', () => {
    const fakeFs = {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('should not be called')
      },
    }
    const result = readClaudeJson('/missing.json', 'config', { fsImpl: fakeFs })
    expect(result.status).toBe('absent')
    expect(result.value).toBe(null)
    expect(isDegraded(result.value)).toBe(false)
    expect(emit).not.toHaveBeenCalled()
  })

  it('returns ok with parsed value for valid JSON', () => {
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => JSON.stringify({ hooks: { PreToolUse: [] } }),
    }
    const result = readClaudeJson('/settings.json', 'config', { fsImpl: fakeFs })
    expect(result.status).toBe('ok')
    expect(result.value).toEqual({ hooks: { PreToolUse: [] } })
    expect(emit).not.toHaveBeenCalled()
  })

  it('returns degraded + emits SSE when the file is present but unparseable', () => {
    const fakeFs = {
      existsSync: () => true,
      readFileSync: () => '{ this is not valid json',
    }
    const result = readClaudeJson('/settings.json', 'config', { fsImpl: fakeFs })
    expect(result.status).toBe('degraded')
    expect(isDegraded(result.value)).toBe(true)
    expect(result.value).not.toEqual({})
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      'parser_degraded',
      expect.objectContaining({ parser: 'config' }),
    )
  })
})
