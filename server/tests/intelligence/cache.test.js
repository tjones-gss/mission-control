import { getCached, setCached, getInFlight, setInFlight, clearInFlight } from '../../intelligence/cache.js'

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
    const id = uniqueId()
    setCached(id, { summary: 'old' })

    // Manually expire the entry by manipulating the timestamp
    // We access the cache indirectly: set, then advance time
    vi.useFakeTimers()
    const id2 = uniqueId()
    setCached(id2, { summary: 'will expire' })
    vi.advanceTimersByTime(61_000) // TTL is 60s
    expect(getCached(id2)).toBeNull()
    vi.useRealTimers()
  })

  it('evicts oldest entry when cache exceeds max size', () => {
    vi.useFakeTimers({ now: Date.now() })
    const ids = []

    // Fill cache to max (20 entries)
    for (let i = 0; i < 20; i++) {
      const id = `eviction-test-${i}`
      ids.push(id)
      setCached(id, { index: i })
      vi.advanceTimersByTime(10) // ensure different timestamps
    }

    // All 20 should be cached
    expect(getCached(ids[0])).not.toBeNull()
    expect(getCached(ids[19])).not.toBeNull()

    // Add one more — should evict the oldest (ids[0])
    const newId = 'eviction-test-new'
    setCached(newId, { index: 'new' })

    expect(getCached(newId)).not.toBeNull()
    expect(getCached(ids[0])).toBeNull() // evicted
    expect(getCached(ids[19])).not.toBeNull() // still present

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
