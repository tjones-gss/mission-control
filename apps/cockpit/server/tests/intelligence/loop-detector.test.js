import { describe, it, expect, afterEach } from 'vitest'
import {
  detectLoop,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_MS,
} from '../../intelligence/loop-detector.js'

// Sprint 2 — semantic alerting. detectLoop is a PURE, synchronous function over a
// parsed session (a `messages` array, same record shape as parseSessionRecord).
// A session is "looping" when it emits THRESHOLD+ consecutive tool calls of the
// same type, with the same content hash, within the window, and with no genuine
// human turn breaking the streak. tool_result user records (the harness echoing a
// tool's output) sit between every pair of tool calls and must NOT break it.

const T0 = Date.parse('2024-01-01T00:00:00.000Z')
const at = (ms) => new Date(T0 + ms).toISOString()

const toolCall = (name, ts, input = { command: 'ls' }) => ({
  type: 'assistant',
  timestamp: ts,
  message: { content: [{ type: 'tool_use', name, input }] },
})
const toolResult = (ts) => ({
  type: 'user',
  timestamp: ts,
  message: { content: [{ type: 'tool_result', content: 'ok' }] },
})
const humanMsg = (ts, text = 'please stop') => ({
  type: 'user',
  timestamp: ts,
  message: { content: text },
})

afterEach(() => {
  delete process.env.LOOP_DETECTION_THRESHOLD
})

describe('detectLoop', () => {
  it('test_no_loop_on_different_tools — 5 calls of different types → no loop', () => {
    const messages = [
      toolCall('Read', at(0)),
      toolResult(at(1000)),
      toolCall('Bash', at(2000)),
      toolResult(at(3000)),
      toolCall('Grep', at(4000)),
      toolResult(at(5000)),
      toolCall('Edit', at(6000)),
      toolResult(at(7000)),
      toolCall('Write', at(8000)),
    ]
    expect(detectLoop({ messages })).toEqual({ looping: false })
  })

  it('test_no_loop_on_user_message_between — 3 same-tool calls split by a human turn → no loop', () => {
    const messages = [
      toolCall('bash', at(0)),
      toolResult(at(1000)),
      toolCall('bash', at(2000)),
      humanMsg(at(3000)),
      toolCall('bash', at(4000)),
    ]
    expect(detectLoop({ messages })).toEqual({ looping: false })
  })

  it('test_loop_detected_three_consecutive_same — 3 consecutive bash, same hash, in-window → loop', () => {
    const messages = [
      toolCall('bash', at(0)),
      toolResult(at(1000)),
      toolCall('bash', at(30_000)),
      toolResult(at(31_000)),
      toolCall('bash', at(60_000)),
    ]
    expect(detectLoop({ messages })).toEqual({
      looping: true,
      tool: 'bash',
      count: 3,
      duration_ms: 60_000,
    })
  })

  it('test_loop_clears_on_user_message — loop, then a human turn arrives → not looping', () => {
    const messages = [
      toolCall('bash', at(0)),
      toolCall('bash', at(30_000)),
      toolCall('bash', at(60_000)),
      humanMsg(at(70_000)),
    ]
    expect(detectLoop({ messages })).toEqual({ looping: false })
  })

  it('test_loop_threshold_configurable — LOOP_DETECTION_THRESHOLD overrides the default of 3', () => {
    process.env.LOOP_DETECTION_THRESHOLD = '2'
    const messages = [toolCall('bash', at(0)), toolCall('bash', at(10_000))]
    // Two identical calls: a loop under threshold 2, but not under the default 3.
    expect(DEFAULT_THRESHOLD).toBe(3)
    expect(detectLoop({ messages })).toMatchObject({ looping: true, tool: 'bash', count: 2 })
  })

  it('exposes the detection window as a stable constant', () => {
    expect(DEFAULT_WINDOW_MS).toBe(90_000)
  })
})
