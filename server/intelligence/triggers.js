import { getSessionById } from '../parsers/sessions.js'
import { analyzeSession } from './analyzer.js'
import { getCached, setCached, getInFlight, setInFlight, clearInFlight } from './cache.js'
import { emit } from '../sse.js'

const snapshots = new Map()      // sessionId → { subagentCount, messageCount }
const debounceTimers = new Map()
const DEBOUNCE_MS = 10_000
const MAX_AGE_MS = 5 * 60_000

export function onSessionEvent(sessionId) {
  clearTimeout(debounceTimers.get(sessionId))
  debounceTimers.set(sessionId,
    setTimeout(() => runIfSignificant(sessionId), DEBOUNCE_MS))
}

async function runIfSignificant(sessionId) {
  const session = getSessionById(sessionId)
  if (!session) return

  const snapshot = snapshots.get(sessionId)
  const cached = getCached(sessionId)

  const subagentCount = session.agentTree?.subagents?.length || 0
  const messageCount = session.messageCount || 0

  const isStale = !cached || (Date.now() - cached.timestamp > MAX_AGE_MS)
  const hasChanged = !snapshot ||
    snapshot.subagentCount !== subagentCount ||
    snapshot.messageCount !== messageCount

  if (!isStale && !hasChanged) return

  snapshots.set(sessionId, { subagentCount, messageCount })
  await runAnalysis(sessionId, session).catch(() => {})
}

export async function runAnalysis(sessionId, session) {
  // Skip if already in flight
  if (getInFlight(sessionId)) return getCached(sessionId)?.result

  const promise = analyzeSession(session).then(result => {
    setCached(sessionId, result)
    emit('intelligence_update', { sessionId })
    clearInFlight(sessionId)
    return result
  }).catch(err => {
    console.error(`[intel] analysis failed for ${sessionId}:`, err.message)
    if (err.stderrOutput) console.error(`[intel] stderr:`, err.stderrOutput)
    if (err.code != null) console.error(`[intel] exit code:`, err.code)
    clearInFlight(sessionId)
    throw err
  })

  setInFlight(sessionId, promise)
  return promise
}
