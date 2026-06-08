import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { resolveClaudeBin, isShellScript } from '../../lib/claude-bin.js'
import { withStreamJsonVerbose } from '../../claude-cli.js'

// Tier 3: the ONLY test that exercises the REAL claude binary. Every other test
// mocks the CLI, so the actual arg-grammar contract is invisible to them — which
// is exactly how the missing-`--verbose` bug shipped. This is the canary that
// fails loudly if the CLI's stream-json requirement changes (or if the central
// injection is bypassed). It is skip-if-absent so PR CI without the binary stays
// green and offline; run it on a CI job that has the CLI installed.
let BIN = null
try {
  BIN = resolveClaudeBin()
} catch {
  BIN = null
}
const real = BIN ? describe : describe.skip

real('claude CLI arg contract (real binary)', () => {
  const shell = BIN ? isShellScript(BIN) : false

  it('rejects --output-format stream-json WITHOUT --verbose in print mode (the bug signature)', () => {
    // Fails at arg validation — no model call, so this is fast and free.
    const r = spawnSync(BIN, ['-p', 'noop', '--output-format', 'stream-json'], {
      encoding: 'utf8',
      timeout: 30_000,
      input: '',
      shell,
    })
    expect(r.status).toBe(1)
    expect(`${r.stderr || ''}${r.stdout || ''}`).toMatch(/requires --verbose/i)
  })

  it('accepts the same flags once withStreamJsonVerbose injects --verbose', () => {
    // We assert the injected args clear the arg-validation gate (no "requires
    // --verbose" rejection) WITHOUT making a billed model call: --help short-
    // circuits before any model work but still parses the full flag set.
    const injected = withStreamJsonVerbose(['-p', 'noop', '--output-format', 'stream-json'])
    expect(injected).toContain('--verbose')
    const r = spawnSync(BIN, [...injected, '--help'], {
      encoding: 'utf8',
      timeout: 30_000,
      input: '',
      shell,
    })
    expect(`${r.stderr || ''}${r.stdout || ''}`).not.toMatch(/requires --verbose/i)
  })
})
