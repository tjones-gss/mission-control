// Phase 6 — the intelligence cache is now durable. Storage lives in
// lib/db/intelligence-store.js (the intelligence table in cockpit.db) so
// analyses survive restarts; this module keeps the exact API that
// analyzer.js, triggers.js and routes/sessions.js already consume.
//
// Entries no longer expire here (the old 60s TTL was an artifact of the
// in-memory Map) — staleness is the caller's decision: triggers.js compares
// entry.timestamp against its own MAX_AGE_MS.
//
// inFlight stays an in-memory Promise registry — promises are live objects,
// not serializable state.
import { getIntelligence, saveIntelligence } from '../lib/db/intelligence-store.js'

const inFlight = new Map() // sessionId → Promise

export function getCached(sessionId) {
  return getIntelligence(sessionId)
}

export function setCached(sessionId, result, snapshot) {
  return saveIntelligence(sessionId, result, snapshot)
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
