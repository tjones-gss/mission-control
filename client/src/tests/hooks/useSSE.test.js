import { renderHook, act } from '@testing-library/react'
import { useSSE } from '../../hooks/useSSE.js'

describe('useSSE', () => {
  beforeEach(() => {
    // Reset instance between tests
    global.EventSource.instance = null
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

  it('listens to exactly all expected event types', () => {
    const onMessage = vi.fn()
    renderHook(() => useSSE(onMessage))
    const es = global.EventSource.instance

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
