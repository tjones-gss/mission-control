// ─── SSE client registry tests ───────────────────────────────────────────────

import { addClient, removeClient, emit, onEvent, initClient } from '../sse.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function createFakeRes() {
  return { write: vi.fn(), on: vi.fn() }
}

/** Extract the 'close' callback registered via res.on('close', cb) */
function captureCloseCallback(res) {
  const call = res.on.mock.calls.find(([event]) => event === 'close')
  return call ? call[1] : undefined
}

// ─── Tracked clients for cleanup ─────────────────────────────────────────────

let trackedClients

beforeEach(() => {
  trackedClients = []
})

afterEach(() => {
  // Clean up module-level state so tests don't leak
  for (const client of trackedClients) {
    removeClient(client)
  }
})

/** Create a fake res and track it for automatic cleanup */
function createTrackedRes() {
  const res = createFakeRes()
  trackedClients.push(res)
  return res
}

// ─── addClient / removeClient ────────────────────────────────────────────────

describe('addClient / removeClient', () => {
  it('adds a client that receives emitted events', () => {
    const res = createTrackedRes()
    addClient(res)

    emit('test', { msg: 'hello' })

    expect(res.write).toHaveBeenCalledWith(
      `event: test\ndata: ${JSON.stringify({ msg: 'hello' })}\n\n`,
    )
  })

  it('removes a client so it no longer receives events', () => {
    const res = createTrackedRes()
    addClient(res)
    removeClient(res)

    emit('test', { msg: 'gone' })

    expect(res.write).not.toHaveBeenCalled()
  })

  it('auto-removes client when close event fires', () => {
    const res = createTrackedRes()
    addClient(res)

    const closeCb = captureCloseCallback(res)
    expect(closeCb).toBeDefined()

    // Simulate the connection closing
    closeCb()

    emit('test', { msg: 'after close' })

    expect(res.write).not.toHaveBeenCalled()
  })

  it('handles idempotent remove (removing a client not in the set)', () => {
    const res = createTrackedRes()
    // Never added — removing should not throw
    expect(() => removeClient(res)).not.toThrow()
  })
})

// ─── emit ────────────────────────────────────────────────────────────────────

describe('emit', () => {
  it('writes correct SSE payload format to all clients', () => {
    const res1 = createTrackedRes()
    const res2 = createTrackedRes()
    addClient(res1)
    addClient(res2)

    const data = { count: 42 }
    emit('update', data)

    const expectedPayload = `event: update\ndata: ${JSON.stringify(data)}\n\n`
    expect(res1.write).toHaveBeenCalledWith(expectedPayload)
    expect(res2.write).toHaveBeenCalledWith(expectedPayload)
  })

  it('removes a client when write throws an error', () => {
    const res = createTrackedRes()
    res.write.mockImplementation(() => {
      throw new Error('connection reset')
    })
    addClient(res)

    // Should not throw despite the client erroring
    expect(() => emit('test', {})).not.toThrow()

    // Client should have been removed — reset mock and emit again
    res.write.mockClear()
    res.write.mockImplementation(() => {})
    emit('test', {})
    expect(res.write).not.toHaveBeenCalled()
  })

  it('handles empty client set without errors', () => {
    expect(() => emit('test', { empty: true })).not.toThrow()
  })
})

// ─── onEvent ─────────────────────────────────────────────────────────────────

describe('onEvent', () => {
  it('registers a callback that fires on emit', () => {
    const cb = vi.fn()
    const unsub = onEvent(cb)

    emit('myEvent', { key: 'value' })

    expect(cb).toHaveBeenCalledWith('myEvent', { key: 'value' })

    // Cleanup
    unsub()
  })

  it('unsubscribe function removes the callback', () => {
    const cb = vi.fn()
    const unsub = onEvent(cb)

    unsub()

    emit('myEvent', { key: 'value' })

    expect(cb).not.toHaveBeenCalled()
  })

  it('calling unsubscribe twice does not throw', () => {
    const cb = vi.fn()
    const unsub = onEvent(cb)

    unsub()
    expect(() => unsub()).not.toThrow()

    emit('test', {})
    expect(cb).not.toHaveBeenCalled()
  })

  it('swallows errors thrown by listener callbacks', () => {
    const badCb = vi.fn(() => {
      throw new Error('listener exploded')
    })
    const unsub = onEvent(badCb)

    expect(() => emit('test', {})).not.toThrow()

    // Cleanup
    unsub()
  })
})

// ─── initClient: flushHeaders + heartbeat ────────────────────────────────────

describe('initClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function createInitRes() {
    const callbacks = {}
    const res = {
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      write: vi.fn(),
      on: vi.fn((event, cb) => {
        callbacks[event] = cb
      }),
      _trigger: (event) => callbacks[event]?.(),
    }
    return res
  }

  it('calls res.flushHeaders after setting headers', () => {
    const res = createInitRes()
    initClient(res)
    expect(res.flushHeaders).toHaveBeenCalledTimes(1)
    res._trigger('close')
  })

  it('writes a heartbeat comment every 15 seconds', () => {
    const res = createInitRes()
    initClient(res)
    expect(res.write).not.toHaveBeenCalled()
    vi.advanceTimersByTime(15000)
    expect(res.write).toHaveBeenCalledWith(': heartbeat\n\n')
    vi.advanceTimersByTime(15000)
    expect(res.write).toHaveBeenCalledTimes(2)
    res._trigger('close')
  })

  it('clears the heartbeat interval on req close', () => {
    const res = createInitRes()
    initClient(res)
    res._trigger('close')
    vi.advanceTimersByTime(30000)
    expect(res.write).not.toHaveBeenCalled()
  })

  it('removes client from registry on close', () => {
    const res = createInitRes()
    initClient(res)
    emit('ping', {})
    expect(res.write).toHaveBeenCalledWith('event: ping\ndata: {}\n\n')
    res._trigger('close')
    res.write.mockClear()
    emit('ping', {})
    expect(res.write).not.toHaveBeenCalled()
  })
})

// ─── Integration: emit reaches both SSE clients and listeners ────────────────

describe('integration: emit reaches both SSE clients and listeners', () => {
  it('delivers to both connected clients and registered listeners', () => {
    const res = createTrackedRes()
    addClient(res)

    const listener = vi.fn()
    const unsub = onEvent(listener)

    const data = { action: 'deploy' }
    emit('ci', data)

    // SSE client received the write
    expect(res.write).toHaveBeenCalledWith(`event: ci\ndata: ${JSON.stringify(data)}\n\n`)

    // Listener received the event and data
    expect(listener).toHaveBeenCalledWith('ci', data)

    // Cleanup
    unsub()
  })
})
