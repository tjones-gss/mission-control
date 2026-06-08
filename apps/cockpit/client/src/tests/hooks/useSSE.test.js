import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../hooks/useSSE.js'

describe('useSSE', () => {
  beforeEach(() => {
    // Reset instance between tests
    global.EventSource.instance = null
    global.EventSource.instances = []
  })

  it('creates EventSource pointing at /api/stream on mount', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    expect(global.EventSource.instance).not.toBeNull()
    expect(global.EventSource.instance.url).toBe('/api/stream')
  })

  it('calls onMessage for session_update events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('session_update', { id: 'abc' })
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'session_update', data: { id: 'abc' } })
  })

  it('calls onMessage for new_session events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('new_session', { id: 'xyz' })
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'new_session', data: { id: 'xyz' } })
  })

  it('calls onMessage for task_update events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('task_update', { taskId: 't1' })
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'task_update', data: { taskId: 't1' } })
  })

  it('calls onMessage for team_update events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('team_update', { team: 'alpha' })
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'team_update', data: { team: 'alpha' } })
  })

  it('calls onMessage for history_update events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('history_update', { entries: [] })
    })
    expect(onMessage).toHaveBeenCalledWith({ type: 'history_update', data: { entries: [] } })
  })

  it('calls onMessage for intelligence_update events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('intelligence_update', { summary: 'done' })
    })
    expect(onMessage).toHaveBeenCalledWith({
      type: 'intelligence_update',
      data: { summary: 'done' },
    })
  })

  it('calls onMessage for parser_degraded events', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    act(() => {
      es.emit('parser_degraded', { parser: 'sessions', reason: 'format-change' })
    })
    expect(onMessage).toHaveBeenCalledWith({
      type: 'parser_degraded',
      data: { parser: 'sessions', reason: 'format-change' },
    })
  })

  it('closes EventSource on unmount', () => {
    const onMessage = vi.fn()
    const { unmount } = renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance
    unmount()
    expect(es.closed).toBe(true)
  })

  it('callback ref pattern: updating onMessage prop does not reconnect', () => {
    const onMessage1 = vi.fn()
    const onMessage2 = vi.fn()

    // Start with onMessage1
    const { rerender } = renderHook(({ cb }) => useSSE(cb), {
      initialProps: { cb: onMessage1 },
    })
    const esAfterMount = global.EventSource.instance

    // Re-render with a different callback
    rerender({ cb: onMessage2 })

    // EventSource should be the same instance (no reconnect)
    expect(global.EventSource.instance).toBe(esAfterMount)

    // The new callback should be called via the ref, not the old one
    act(() => {
      global.EventSource.instance.emit('session_update', { id: '1' })
    })
    expect(onMessage1).not.toHaveBeenCalled()
    expect(onMessage2).toHaveBeenCalledWith({ type: 'session_update', data: { id: '1' } })
  })

  it('reconnects with exponential backoff on error', () => {
    vi.useFakeTimers()
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))

    // 1st error → delay = 1000 * 2^0 = 1000 ms
    act(() => {
      global.EventSource.instance.onerror()
    })
    expect(global.EventSource.instances).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(global.EventSource.instances).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(global.EventSource.instances).toHaveLength(2)

    // 2nd error → delay = 1000 * 2^1 = 2000 ms
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(1999)
    })
    expect(global.EventSource.instances).toHaveLength(2)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(global.EventSource.instances).toHaveLength(3)

    // 3rd error → delay = 1000 * 2^2 = 4000 ms
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(global.EventSource.instances).toHaveLength(3)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(global.EventSource.instances).toHaveLength(4)

    vi.useRealTimers()
  })

  it('backoff delay is capped at 30 seconds', () => {
    vi.useFakeTimers()
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))

    // Drive retryCount to 5 (delay would be 32000 without cap)
    for (let i = 0; i < 5; i++) {
      act(() => {
        global.EventSource.instance.onerror()
      })
      const uncappedDelay = 1000 * 2 ** i
      act(() => {
        vi.advanceTimersByTime(Math.min(uncappedDelay, 30000))
      })
    }
    const instancesBeforeCap = global.EventSource.instances.length

    // At retryCount=5, delay = min(32000, 30000) = 30000
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(29999)
    })
    expect(global.EventSource.instances).toHaveLength(instancesBeforeCap)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(global.EventSource.instances).toHaveLength(instancesBeforeCap + 1)

    vi.useRealTimers()
  })

  it('resets backoff delay to 1s after a successful onopen', () => {
    vi.useFakeTimers()
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))

    // Trigger 3 errors to advance retryCount
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(1000)
    })
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    act(() => {
      global.EventSource.instance.onerror()
    })
    act(() => {
      vi.advanceTimersByTime(4000)
    })

    // Successful open resets retryCount to 0
    act(() => {
      global.EventSource.instance.onopen()
    })

    // Next error should use delay = 1000 ms again
    act(() => {
      global.EventSource.instance.onerror()
    })
    const countBeforeReset = global.EventSource.instances.length
    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(global.EventSource.instances).toHaveLength(countBeforeReset)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(global.EventSource.instances).toHaveLength(countBeforeReset + 1)

    vi.useRealTimers()
  })

  it('clears pending reconnect timer on unmount', () => {
    vi.useFakeTimers()
    const onMessage = vi.fn()
    const { unmount } = renderHook(() => useSSE(onMessage))

    // Trigger an error to schedule a reconnect
    act(() => {
      global.EventSource.instance.onerror()
    })
    const countAfterError = global.EventSource.instances.length

    // Unmount before the timer fires
    unmount()

    // Advance past the reconnect delay — no new EventSource should be created
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(global.EventSource.instances).toHaveLength(countAfterError)

    vi.useRealTimers()
  })

  it('wasOpen guard: onerror before onopen does not call setConnected(false)', () => {
    const onMessage = vi.fn()
    const { result } = renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance

    // Fire onerror BEFORE any onopen — connected should stay true (initial state)
    act(() => {
      es.onerror()
    })
    expect(result.current.connected).toBe(true)

    // Now fire onopen — connected goes true (already true, but state is set)
    act(() => {
      global.EventSource.instance.onopen()
    })
    expect(result.current.connected).toBe(true)

    // Fire onerror again AFTER onopen — now connected should go false
    act(() => {
      global.EventSource.instance.onerror()
    })
    expect(result.current.connected).toBe(false)
  })

  it('listens to exactly all expected event types', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance

    // Keep this list in sync with the `events` array in useSSE.js. New
    // SSE channels were added for live workflow/skill/memory/plan/config/hooks
    // refreshes — adding them here ensures the test catches future drift.
    const expectedEvents = [
      'session_update',
      'new_session',
      'task_update',
      'team_update',
      'history_update',
      'intelligence_update',
      'sdk_message',
      'sdk_result',
      'sdk_error',
      'tool_approval_request',
      'tool_approval_resolved',
      'workflows_update',
      'skills_update',
      'memory_update',
      'plan_update',
      'config_update',
      'hooks_update',
      'conductor_update',
      'harness_update',
      'fleet_update',
      'parser_degraded',
    ]

    expectedEvents.forEach((eventType) => {
      expect(es.listeners[eventType]).toBeDefined()
      expect(es.listeners[eventType].length).toBeGreaterThan(0)
    })

    // No extra event types registered beyond the expected
    const registeredTypes = Object.keys(es.listeners)
    expect(registeredTypes).toHaveLength(expectedEvents.length)
  })
})
