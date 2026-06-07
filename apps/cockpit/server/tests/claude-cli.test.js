import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

// Mock at the spawn boundary (NOT at runClaude) — this is the whole point: route
// tests mock runClaude and never see the real arg array, so the --verbose
// contract is invisible to them. Here we inspect the FINAL args handed to spawn.
// Controllable mock state (hoisted so the vi.mock factories can close over it).
// Defaults reproduce the original mocks: a resolved .exe and isShellScript=false.
const { spawnMock, binState } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  binState: { bin: '/usr/bin/claude' },
}))
vi.mock('child_process', () => ({ spawn: (...a) => spawnMock(...a) }))
// getClaudeBin is state-controlled (point it at a .exe or a .cmd per test);
// isShellScript uses the REAL extension logic so buildSpawn detection is exercised.
vi.mock('../lib/claude-bin.js', () => ({
  getClaudeBin: () => binState.bin,
  isShellScript: (p) => /\.(cmd|bat|ps1)$/i.test(p),
}))

import { runClaude, withStreamJsonVerbose, buildSpawn } from '../claude-cli.js'

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
  binState.bin = '/usr/bin/claude'
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

describe('buildSpawn (Windows .cmd/.ps1 injection safety)', () => {
  it('passes a resolved .exe straight through (shell:false path)', () => {
    expect(buildSpawn('/usr/bin/claude', ['-p', 'hi'])).toEqual({
      command: '/usr/bin/claude',
      commandArgs: ['-p', 'hi'],
    })
  })

  it('routes a .cmd through cmd.exe with the bin + args as DISCRETE argv (no shell string)', () => {
    const { command, commandArgs } = buildSpawn('C:\\npm\\claude.cmd', ['-p', 'hi'])
    expect(command).toBe('cmd.exe')
    expect(commandArgs).toEqual(['/d', '/s', '/c', 'C:\\npm\\claude.cmd', '-p', 'hi'])
  })

  it('routes a .ps1 through powershell -File with discrete argv', () => {
    const { command, commandArgs } = buildSpawn('C:\\ps\\claude.ps1', ['-p', 'hi'])
    expect(command).toBe('powershell.exe')
    expect(commandArgs).toEqual([
      '-NoProfile',
      '-NonInteractive',
      '-File',
      'C:\\ps\\claude.ps1',
      '-p',
      'hi',
    ])
  })

  it('preserves shell metacharacters as ONE literal argv element (no concatenation)', () => {
    const evil = '; calc & echo $(whoami) `id` | cat %USERPROFILE% > x'
    const { commandArgs } = buildSpawn('C:\\npm\\claude.cmd', ['-p', evil, '--name', 'a&b'])
    // The payload must survive as a single discrete element — never spliced into a
    // shell command line where cmd.exe would interpret ; & | > $() backticks %VAR%.
    expect(commandArgs).toContain(evil)
    expect(commandArgs).toContain('a&b')
    // And it must be exactly: prefix + bin + the original args, in order.
    expect(commandArgs).toEqual([
      '/d',
      '/s',
      '/c',
      'C:\\npm\\claude.cmd',
      '-p',
      evil,
      '--name',
      'a&b',
    ])
  })
})

describe('runClaude → spawn never uses shell:true with raw args', () => {
  it('for a .cmd bin, spawns cmd.exe with shell falsy and the prompt as literal argv', async () => {
    binState.bin = 'C:\\npm\\claude.cmd'
    spawnMock.mockImplementation(() => fakeChild())
    const evil = 'do it & whoami'
    await runClaude({ args: ['-p', evil], timeoutMs: 5000 })
    const [command, commandArgs, opts] = spawnMock.mock.calls[0]
    expect(command).toBe('cmd.exe')
    expect(commandArgs).toContain(evil) // literal, not interpreted
    expect(opts.shell).toBeFalsy() // the injection vector (shell:true + raw args) is gone
  })

  it('for a resolved .exe, spawns the bin directly with shell falsy (unchanged)', async () => {
    spawnMock.mockImplementation(() => fakeChild())
    await runClaude({ args: ['-p', 'hi'], timeoutMs: 5000 })
    const [command, , opts] = spawnMock.mock.calls[0]
    expect(command).toBe('/usr/bin/claude')
    expect(opts.shell).toBeFalsy()
  })
})
