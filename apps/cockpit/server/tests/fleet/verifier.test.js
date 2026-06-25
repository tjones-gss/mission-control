import { describe, it, expect } from 'vitest'
import { verifyDiff } from '../../fleet/verifier.js'

// L1-F — verification isn't theater. A deterministic, LLM-free gate that scans a
// candidate diff for known-bad patterns and REJECTS, so a bad diff halts the run
// at the verify phase instead of proceeding to synthesis. This tests the module
// directly with a bad diff (the sanctioned minimal path — no real-child e2e).

describe('verifyDiff (deterministic known-bad gate)', () => {
  it('REJECTS a diff that ADDS shell: true to spawn code', () => {
    const diff = [
      'diff --git a/server/run.js b/server/run.js',
      '@@ -10,3 +10,3 @@',
      '-  const child = spawn(cmd, args, { stdio: "pipe" })',
      '+  const child = spawn(cmd, args, { shell: true, stdio: "pipe" })',
    ].join('\n')

    const result = verifyDiff(diff)

    expect(result.status).toBe('rejected')
    expect(result.reasons.join(' ')).toMatch(/shell: ?true/i)
  })

  it('also matches the no-space form shell:true', () => {
    const diff = '+ spawn(cmd, args, {shell:true})'
    expect(verifyDiff(diff).status).toBe('rejected')
  })

  it('APPROVES a clean diff with no known-bad pattern', () => {
    const diff = [
      'diff --git a/server/run.js b/server/run.js',
      '@@ -10,2 +10,2 @@',
      '+  const child = spawn(cmd, args, { stdio: "pipe" })',
    ].join('\n')

    const result = verifyDiff(diff)

    expect(result.status).toBe('approved')
    expect(result.reasons).toEqual([])
  })

  it('APPROVES a diff that REMOVES shell: true (a fix is not a violation)', () => {
    const diff = [
      '@@ -10,3 +10,2 @@',
      '-  const child = spawn(cmd, args, { shell: true })',
      '+  const child = spawn(cmd, args, {})',
    ].join('\n')

    expect(verifyDiff(diff).status).toBe('approved')
  })

  it('ignores an UNCHANGED context line that contains shell: true (only added lines count)', () => {
    const diff = [
      '@@ -10,3 +10,3 @@',
      '   const child = spawn(cmd, args, { shell: true })',
      '-  const x = 1',
      '+  const x = 2',
    ].join('\n')

    expect(verifyDiff(diff).status).toBe('approved')
  })

  it('returns approved for an empty / non-string diff (nothing to reject)', () => {
    expect(verifyDiff('').status).toBe('approved')
    expect(verifyDiff(null).status).toBe('approved')
    expect(verifyDiff(undefined).status).toBe('approved')
  })
})
