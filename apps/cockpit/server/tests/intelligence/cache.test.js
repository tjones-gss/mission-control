// Phase 6 — intelligence/cache.js is now a thin facade over
// lib/db/intelligence-store.js (the intelligence table in cockpit.db). The
// exported API is unchanged — analyzer.js/triggers.js/routes need zero edits —
// but entries persist across restarts instead of evaporating on a 60s TTL.
// inFlight stays an in-memory Promise registry (promises don't serialize).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { openDb, closeDb } from '../../lib/db/connection.js'
import { _resetMemFallbackForTests } from '../../lib/db/intelligence-store.js'
import {
  getCached,
  setCached,
  getInFlight,
  setInFlight,
  clearInFlight,
} from '../../intelligence/cache.js'

let tmpDir
let dbPath
let testCounter = 0

function uniqueId() {
  return `test-session-${++testCounter}-${Date.now()}`
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-cache-test-'))
  dbPath = path.join(tmpDir, 'cockpit.db')
  openDb(dbPath)
  _resetMemFallbackForTests()
})

afterEach(() => {
  closeDb()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('getCached / setCached', () => {
  it('returns null for uncached session', () => {
    expect(getCached(uniqueId())).toBeNull()
  })

  it('returns cached entry after setCached', () => {
    const id = uniqueId()
    const result = { summary: 'test analysis' }
    setCached(id, result)
    const cached = getCached(id)
    expect(cached).not.toBeNull()
    expect(cached.result).toEqual(result)
    expect(cached.timestamp).toBeGreaterThan(0)
  })

  it('does NOT expire entries — staleness is the caller’s decision (triggers.js)', () => {
    vi.useFakeTimers()
    const id = uniqueId()
    setCached(id, { summary: 'durable now' })
    vi.advanceTimersByTime(61_000) // the old in-memory TTL was 60s
    const cached = getCached(id)
    expect(cached).not.toBeNull()
    expect(cached.result).toEqual({ summary: 'durable now' })
    vi.useRealTimers()
  })

  it('persists across a restart (closeDb + reopen)', () => {
    const id = uniqueId()
    setCached(id, { summary: 'survives restarts' })
    closeDb()
    openDb(dbPath)
    expect(getCached(id)?.result).toEqual({ summary: 'survives restarts' })
  })

  it('overwrites the previous entry for the same session', () => {
    const id = uniqueId()
    setCached(id, { summary: 'old' })
    setCached(id, { summary: 'new' })
    expect(getCached(id).result).toEqual({ summary: 'new' })
  })
})

describe('getInFlight / setInFlight / clearInFlight', () => {
  it('returns null for unknown session', () => {
    expect(getInFlight(uniqueId())).toBeNull()
  })

  it('stores and retrieves in-flight promise', () => {
    const id = uniqueId()
    const promise = Promise.resolve({ summary: 'pending' })
    setInFlight(id, promise)
    expect(getInFlight(id)).toBe(promise)
  })

  it('clears in-flight promise', () => {
    const id = uniqueId()
    setInFlight(id, Promise.resolve())
    clearInFlight(id)
    expect(getInFlight(id)).toBeNull()
  })

  it('clearInFlight is idempotent for unknown sessions', () => {
    expect(() => clearInFlight(uniqueId())).not.toThrow()
  })
})
