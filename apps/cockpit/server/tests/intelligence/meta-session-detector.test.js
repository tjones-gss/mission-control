// Phase S1 — meta-session detection.
//
// A session is "meta" when its CWD is the Oversight repo root (or inside it):
// Oversight is then watching its own construction. Pure + deterministic — the
// repo root is injected so the test never depends on where it runs.
import { describe, it, expect } from 'vitest'
import {
  isMetaSession,
  OVERSIGHT_REPO_ROOT,
  STEER_BUILD_MESSAGE,
} from '../../intelligence/meta-session-detector.js'

const ROOT = 'C:/Users/dev/Projects/mission-control'

describe('isMetaSession', () => {
  it('is true when the cwd is exactly the repo root', () => {
    expect(isMetaSession(ROOT, ROOT)).toBe(true)
  })

  it('is true for a subdirectory of the repo root', () => {
    expect(isMetaSession(`${ROOT}/apps/cockpit/server`, ROOT)).toBe(true)
  })

  it('is case- and separator-insensitive (Windows paths)', () => {
    expect(isMetaSession('c:\\users\\dev\\projects\\mission-control', ROOT)).toBe(true)
  })

  it('is false for an unrelated cwd', () => {
    expect(isMetaSession('C:/Users/dev/Projects/other-app', ROOT)).toBe(false)
  })

  it('is false for a sibling whose path is a string prefix but not a path prefix', () => {
    expect(isMetaSession(`${ROOT}-fork`, ROOT)).toBe(false)
  })

  it('is false for a null/empty/undefined cwd', () => {
    expect(isMetaSession(null, ROOT)).toBe(false)
    expect(isMetaSession('', ROOT)).toBe(false)
    expect(isMetaSession(undefined, ROOT)).toBe(false)
  })

  it('defaults the repo root to the resolved Oversight repo root', () => {
    expect(typeof OVERSIGHT_REPO_ROOT).toBe('string')
    expect(OVERSIGHT_REPO_ROOT.replace(/\\/g, '/')).toMatch(/mission-control$/)
  })
})

describe('STEER_BUILD_MESSAGE', () => {
  it('is the pre-composed self-correction prompt', () => {
    expect(STEER_BUILD_MESSAGE).toMatch(/last 3 commits/i)
    expect(STEER_BUILD_MESSAGE).toMatch(/npm run test:cockpit/)
  })
})
