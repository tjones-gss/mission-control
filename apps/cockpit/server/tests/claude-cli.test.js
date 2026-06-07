import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock at the spawn boundary (NOT at runClaude) — this is the whole point: route
// tests mock runClaude and never see the real arg array, so the --verbose
// contract is invisible to them. Here we inspect the FINAL args handed to spawn.
const spawnMock = vi.fn()
vi.mock('child_process', () => ({ spawn: (...a) => spawnMock(...a) }))
vi.mock('../lib/claude-bin.js', () => ({
  getClaudeBin: () => '/usr/bin/claude',
  isShellScript: () => false,
}))

import { runClaude, withStreamJsonVerbose } from '../claude-cli.js'

function fakeChild(stdout = '{"type":"result","result":"ok"}\n', exit = 0) {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter()
  child.stdin = { end: () => {} }
  child.kill = () => {}
  queueMicrotask(() => {
    if (stdout) child.stdout.emit('data', stdout)
    child.emit('close', exit)
  })
  return child
}

beforeEach(() => {
  spawnMock.mockReset()
})

describe('withStreamJsonVerbose (pure)', () => {
  it('appends --verbose for --output-format stream-json', () => {
    expect(withStreamJsonVerbose(['-p', 'x', '--output-format', 'stream-json'])).toEqual([
      '-p',
      'x',
      '--output-format',
      'stream-json',
      '--verbose',
    ])
  })

  it('is a no-op for --output-format json', () => {
    expect(withStreamJsonVerbose(['-p', 'x', '--output-format', 'json'])).toEqual([
      '-p',
      'x',
      '--output-format',
      'json',
    ])
  })

  it('does not duplicate an existing --verbose', () => {
    const a = ['-p', 'x', '--output-format', 'stream-json', '--verbose']
    expect(withStreamJsonVerbose(a)).toEqual(a)
  })

  it('does not match a stray "stream-json" that is not the --output-format value', () => {
    const a = ['-p', 'mentions stream-json in text', '--output-format', 'json']
    expect(withStreamJsonVerbose(a)).toEqual(a)
  })

  it('also handles the equals form --output-format=stream-json', () => {
    expect(withStreamJsonVerbose(['-p', 'x', '--output-format=stream-json'])).toEqual([
      '-p',
      'x',
      '--output-format=stream-json',
      '--verbose',
    ])
  })

  it('does not mutate the caller’s array', () => {
    const input = ['-p', 'x', '--output-format', 'stream-json']
    const copy = [...input]
    withStreamJsonVerbose(input)
    expect(input).toEqual(copy) // unchanged — a new array is returned
  })
})

describe('runClaude → final spawn args', () => {
  it('injects --verbose into the FINAL args for a stream-json spawn', async () => {
    spawnMock.mockImplementation(() => fakeChild())
    await runClaude({ args: ['-p', 'do it', '--output-format', 'stream-json'], timeoutMs: 5000 })
    const finalArgs = spawnMock.mock.calls[0][1]
    expect(finalArgs).toContain('--verbose')
    // immediately after the format value, order preserved
    expect(finalArgs).toEqual(['-p', 'do it', '--output-format', 'stream-json', '--verbose'])
  })

  it('does NOT inject --verbose for --output-format json (analyzer path)', async () => {
    spawnMock.mockImplementation(() => fakeChild('{}'))
    await runClaude({ args: ['-p', 'x', '--output-format', 'json'], timeoutMs: 5000 })
    expect(spawnMock.mock.calls[0][1]).not.toContain('--verbose')
  })
})
