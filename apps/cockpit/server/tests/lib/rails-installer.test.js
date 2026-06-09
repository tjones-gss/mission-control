import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { adoptRails } from '../../lib/rails-installer.js'

// Real filesystem against a tmp dir — this exercises the actual recursive copy
// from the real adapter source, so it proves the pure-Node adopter end to end.
let tmp
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rails-installer-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('adoptRails', () => {
  it('copies the adapter and wires settings.json to the Node hooks', () => {
    const res = adoptRails(tmp)
    expect(res.ok).toBe(true)
    expect(res.alreadyPresent).toBe(false)
    expect(res.hooks).toBe('node')

    // The Node hooks landed.
    for (const h of [
      'block-danger.mjs',
      'require-mission.mjs',
      'session-start-load-state.mjs',
      'stop-session-note-reminder.mjs',
      '_lib.mjs',
    ]) {
      expect(fs.existsSync(path.join(tmp, '.claude', 'hooks', h))).toBe(true)
    }
    expect(fs.existsSync(path.join(tmp, 'CLAUDE.md'))).toBe(true)

    // settings.json is the Node variant (commands invoke `node ... .mjs`).
    const settings = fs.readFileSync(path.join(tmp, '.claude', 'settings.json'), 'utf8')
    expect(settings).toContain('block-danger.mjs')
    expect(settings).toContain('node ')
    expect(settings).not.toContain('block-danger.sh')

    // The hooks' own test file is NOT shipped into the user's project.
    expect(fs.existsSync(path.join(tmp, '.claude', 'hooks', 'hooks.test.mjs'))).toBe(false)
  })

  it('is idempotent — a wired adapter is reported alreadyPresent, not clobbered', () => {
    expect(adoptRails(tmp).ok).toBe(true)
    // Mark the operator settings so we can prove it is not overwritten.
    const settingsPath = path.join(tmp, '.claude', 'settings.json')
    fs.writeFileSync(settingsPath, '{"operator":"custom"}')

    const second = adoptRails(tmp)
    expect(second).toEqual({ ok: true, alreadyPresent: true })
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe('{"operator":"custom"}')
  })

  it('rejects a non-existent target', () => {
    const res = adoptRails(path.join(tmp, 'does-not-exist'))
    expect(res.ok).toBe(false)
    expect(res.error).toBe('target_missing')
  })

  it('rejects an invalid target', () => {
    expect(adoptRails('').ok).toBe(false)
    expect(adoptRails(null).ok).toBe(false)
  })
})
