import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onSessionEvent, runAnalysis } from '../../intelligence/triggers.js'
import { getSessionById } from '../../parsers/sessions.js'
import { analyzeSession } from '../../intelligence/analyzer.js'
import {
  getCached,
  setCached,
  getInFlight,
  setInFlight,
  clearInFlight,
} from '../../intelligence/cache.js'
import { emit } from '../../sse.js'

vi.mock('../../parsers/sessions.js', () => ({ getSessionById: vi.fn() }))
vi.mock('../../intelligence/analyzer.js', () => ({ analyzeSession: vi.fn() }))
vi.mock('../../intelligence/cache.js', () => ({
  getCached: vi.fn(),
  setCached: vi.fn(),
  getInFlight: vi.fn(),
  setInFlight: vi.fn(),
  clearInFlight: vi.fn(),
}))
vi.mock('../../sse.js', () => ({ emit: vi.fn() }))

let testCounter = 0
function uniqueId() {
  return `test-session-${++testCounter}-${Date.now()}`
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('onSessionEvent', () => {
  it('debounces: does not fire immediately', () => {
    const id = uniqueId()
    getSessionById.mockReturnValue({ agentTree: { subagents: [] }, messageCount: 1 })
    getCached.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'ok' })

    onSessionEvent(id)
    vi.advanceTimersByTime(5000) // less than 10s

    expect(getSessionById).not.toHaveBeenCalled()
    expect(analyzeSession).not.toHaveBeenCalled()
  })

  it('fires runIfSignificant after 10s debounce', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 3 }
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue(null)
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'done' })

    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(getSessionById).toHaveBeenCalledWith(id)
    expect(analyzeSession).toHaveBeenCalledWith(session)
  })

  it('resets debounce timer on repeated calls within window', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 1 }
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue(null)
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'done' })

    onSessionEvent(id)
    vi.advanceTimersByTime(7000) // 7s in
    onSessionEvent(id) // reset timer
    vi.advanceTimersByTime(7000) // 14s total, but only 7s since last call

    expect(analyzeSession).not.toHaveBeenCalled()

    vi.advanceTimersByTime(3000) // 10s since last call
    await vi.runAllTimersAsync()

    expect(analyzeSession).toHaveBeenCalledTimes(1)
  })
})

describe('runIfSignificant (via onSessionEvent + timer advance)', () => {
  it('skips when getSessionById returns null', async () => {
    const id = uniqueId()
    getSessionById.mockReturnValue(null)

    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(getSessionById).toHaveBeenCalledWith(id)
    expect(analyzeSession).not.toHaveBeenCalled()
  })

  it('runs analysis when no cached result (stale)', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 5 }
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue(null)
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'fresh' })

    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(analyzeSession).toHaveBeenCalledWith(session)
  })

  it('runs analysis when cache is older than 5 minutes', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [{}] }, messageCount: 2 }
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue({ result: { summary: 'old' }, timestamp: Date.now() - 6 * 60_000 })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'refreshed' })

    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(analyzeSession).toHaveBeenCalledWith(session)
  })

  it('runs analysis when subagent count changed', async () => {
    const id = uniqueId()
    const session1 = { agentTree: { subagents: [] }, messageCount: 1 }
    const session2 = { agentTree: { subagents: [{}, {}] }, messageCount: 1 }
    getSessionById.mockReturnValueOnce(session1).mockReturnValueOnce(session2)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'updated' })

    // First call to establish snapshot
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    vi.resetAllMocks()
    getSessionById.mockReturnValue(session2)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'updated2' })

    // Second call with changed subagent count
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(analyzeSession).toHaveBeenCalledWith(session2)
  })

  it('runs analysis when message count changed', async () => {
    const id = uniqueId()
    const session1 = { agentTree: { subagents: [] }, messageCount: 3 }
    const session2 = { agentTree: { subagents: [] }, messageCount: 7 }
    getSessionById.mockReturnValueOnce(session1).mockReturnValueOnce(session2)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'result' })

    // First call to establish snapshot
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    vi.resetAllMocks()
    getSessionById.mockReturnValue(session2)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'result2' })

    // Second call with changed message count
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(analyzeSession).toHaveBeenCalledWith(session2)
  })

  it('skips analysis when cache is fresh AND nothing changed', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [{}] }, messageCount: 4 }
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue({ summary: 'result' })

    // First call to establish snapshot
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    vi.resetAllMocks()
    getSessionById.mockReturnValue(session)
    getCached.mockReturnValue({ result: { summary: 'cached' }, timestamp: Date.now() })
    getInFlight.mockReturnValue(null)

    // Second call with same data and fresh cache
    onSessionEvent(id)
    vi.advanceTimersByTime(10000)
    await vi.runAllTimersAsync()

    expect(analyzeSession).not.toHaveBeenCalled()
  })
})

describe('runAnalysis', () => {
  it('returns cached result when getInFlight returns truthy', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 1 }
    const existingPromise = Promise.resolve({ summary: 'in-flight' })
    getInFlight.mockReturnValue(existingPromise)
    getCached.mockReturnValue({ result: { summary: 'cached-result' } })

    const result = await runAnalysis(id, session)

    expect(result).toEqual({ summary: 'cached-result' })
    expect(analyzeSession).not.toHaveBeenCalled()
    expect(setInFlight).not.toHaveBeenCalled()
  })

  it('calls analyzeSession, setCached, emit on success, and clearInFlight', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 2 }
    const analysisResult = { summary: 'new analysis' }
    getInFlight.mockReturnValue(null)
    analyzeSession.mockResolvedValue(analysisResult)

    const result = await runAnalysis(id, session)

    expect(result).toEqual(analysisResult)
    expect(analyzeSession).toHaveBeenCalledWith(session)
    expect(setInFlight).toHaveBeenCalledWith(id, expect.any(Promise))
    expect(setCached).toHaveBeenCalledWith(id, analysisResult)
    expect(emit).toHaveBeenCalledWith('intelligence_update', { sessionId: id })
    expect(clearInFlight).toHaveBeenCalledWith(id)
  })

  it('clears in-flight and re-throws on error', async () => {
    const id = uniqueId()
    const session = { agentTree: { subagents: [] }, messageCount: 1 }
    const error = new Error('analysis failed')
    getInFlight.mockReturnValue(null)
    analyzeSession.mockRejectedValue(error)

    await expect(runAnalysis(id, session)).rejects.toThrow('analysis failed')

    expect(clearInFlight).toHaveBeenCalledWith(id)
    expect(setCached).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
  })
})
