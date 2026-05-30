const cache = new Map() // sessionId → { result, timestamp }
const inFlight = new Map() // sessionId → Promise
const TTL_MS = 60_000
const MAX_ENTRIES = 20

export function getCached(sessionId) {
  const entry = cache.get(sessionId)
  if (!entry) return null
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(sessionId)
    return null
  }
  return entry
}

export function setCached(sessionId, result) {
  if (cache.size >= MAX_ENTRIES) {
    // Evict oldest entry
    let oldestKey = null
    let oldestTime = Infinity
    for (const [key, entry] of cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp
        oldestKey = key
      }
    }
    if (oldestKey) cache.delete(oldestKey)
  }
  cache.set(sessionId, { result, timestamp: Date.now() })
}

export function getInFlight(sessionId) {
  return inFlight.get(sessionId) || null
}

export function setInFlight(sessionId, promise) {
  inFlight.set(sessionId, promise)
}

export function clearInFlight(sessionId) {
  inFlight.delete(sessionId)
}
