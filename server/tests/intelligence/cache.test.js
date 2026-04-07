import {
  getCached,
  setCached,
  getInFlight,
  setInFlight,
  clearInFlight,
} from '../../intelligence/cache.js'

// The cache module uses module-level Maps, so we need to manage state carefully.
// We'll use unique session IDs per test to avoid cross-test interference.

let testCounter = 0
function uniqueId() {
  return `test-session-${++testCounter}-${Date.now()}`
}

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

  it('returns null for expired entries', () => {
    vi.useFakeTimers()
    const id = uniqueId()
    setCached(id, { summary: 'will expire' })
    vi.advanceTimersByTime(61_000) // TTL is 60s
    expect(getCached(id)).toBeNull()
    vi.useRealTimers()
  })

  it('evicts oldest entry when cache exceeds max size', () => {
    vi.useFakeTimers({ now: Date.now() })

    // Insert 21 entries with distinct timestamps — max cache size is 20
    const ids = []
    for (let i = 0; i < 21; i++) {
      const id = `eviction-${Date.now()}-${i}`
      ids.push(id)
      setCached(id, { index: i })
      vi.advanceTimersByTime(100) // ensure clearly different timestamps
    }

    // The newest entry should always be present
    expect(getCached(ids[20])).not.toBeNull()

    // At least one of the earlier entries must have been evicted
    const earlyEntries = ids.slice(0, 5)
    const someEvicted = earlyEntries.some((id) => getCached(id) === null)
    expect(someEvicted).toBe(true)

    vi.useRealTimers()
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
