import { describe, it, expect, beforeEach, vi } from 'vitest'

// In-memory fake filesystem so the trust store never touches the real
// server/data/trusted-cwds.json during tests.
const { fsState } = vi.hoisted(() => ({ fsState: { file: null, throwOnRead: false } }))
vi.mock('fs', () => ({
  default: {
    readFileSync: () => {
      if (fsState.throwOnRead || fsState.file == null) throw new Error('ENOENT')
      return fsState.file
    },
    writeFileSync: (_p, contents) => {
      fsState.file = contents
    },
    mkdirSync: () => {},
  },
}))

import {
  isCwdTrusted,
  trustCwd,
  untrustCwd,
  listTrustedCwds,
  _resetTrustStore,
} from '../../lib/trust-store.js'

beforeEach(() => {
  fsState.file = null
  fsState.throwOnRead = false
  _resetTrustStore()
})

describe('trust-store (default-deny)', () => {
  it('treats a missing store as nothing-trusted', () => {
    expect(isCwdTrusted('/any/project')).toBe(false)
    expect(listTrustedCwds()).toEqual([])
  })

  it('treats a corrupt/unreadable store as nothing-trusted (never throws)', () => {
    fsState.file = '{ this is not json'
    _resetTrustStore()
    expect(() => isCwdTrusted('/any/project')).not.toThrow()
    expect(isCwdTrusted('/any/project')).toBe(false)
  })

  it('grants and then recognizes a trusted cwd across a cache reset (persisted)', () => {
    trustCwd('/work/app')
    _resetTrustStore() // force a reload from the (faked) persisted file
    expect(isCwdTrusted('/work/app')).toBe(true)
  })

  it('normalizes relative vs absolute so a relative cwd cannot dodge the check', () => {
    trustCwd('/work/app')
    // a non-normalized form of the same path resolves to the same trust entry
    expect(isCwdTrusted('/work/app/')).toBe(true)
  })

  it('untrust removes the grant', () => {
    trustCwd('/work/app')
    expect(isCwdTrusted('/work/app')).toBe(true)
    untrustCwd('/work/app')
    expect(isCwdTrusted('/work/app')).toBe(false)
  })

  it('rejects non-string / empty cwds (no accidental trust)', () => {
    expect(trustCwd('')).toBe(false)
    expect(trustCwd(null)).toBe(false)
    expect(isCwdTrusted(null)).toBe(false)
  })
})
