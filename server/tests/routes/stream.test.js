import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'

vi.mock('../../watcher.js', () => ({
  addClient: vi.fn(),
  removeClient: vi.fn(),
}))

const { addClient, removeClient } = await import('../../watcher.js')
const { router } = await import('../../routes/stream.js')

const app = express()
app.use('/', router)

beforeEach(() => {
  vi.resetAllMocks()
})

// Helper: invoke the route handler directly via a mock req/res to avoid
// supertest closing the SSE connection immediately.
function callHandler() {
  const handlers = {}
  const res = {
    setHeader: vi.fn(),
    flushHeaders: vi.fn(),
    write: vi.fn(),
    on: vi.fn((event, cb) => { handlers[event] = cb }),
  }
  const req = { method: 'GET', url: '/' }
  const next = vi.fn()

  // Walk the router stack to find and invoke the GET / handler
  const layer = router.stack.find(l => l.route && l.route.path === '/' && l.route.methods.get)
  layer.route.stack[0].handle(req, res, next)

  return { res, handlers }
}

describe('GET / (SSE stream)', () => {
  it('sets Content-Type to text/event-stream', () => {
    const { res } = callHandler()
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/event-stream')
  })

  it('sets Cache-Control to no-cache', () => {
    const { res } = callHandler()
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-cache')
  })

  it('sets Connection to keep-alive', () => {
    const { res } = callHandler()
    expect(res.setHeader).toHaveBeenCalledWith('Connection', 'keep-alive')
  })

  it('calls flushHeaders', () => {
    const { res } = callHandler()
    expect(res.flushHeaders).toHaveBeenCalledTimes(1)
  })

  it('calls addClient with the response object', () => {
    const { res } = callHandler()
    expect(addClient).toHaveBeenCalledTimes(1)
    expect(addClient).toHaveBeenCalledWith(res)
  })

  it('sends heartbeat event at 30s intervals', () => {
    vi.useFakeTimers()
    const { res } = callHandler()

    expect(res.write).not.toHaveBeenCalled()

    vi.advanceTimersByTime(30000)
    expect(res.write).toHaveBeenCalledTimes(1)
    expect(res.write).toHaveBeenCalledWith('event: heartbeat\ndata: {}\n\n')

    vi.advanceTimersByTime(30000)
    expect(res.write).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('clears heartbeat interval on connection close', () => {
    vi.useFakeTimers()
    const { res, handlers } = callHandler()

    vi.advanceTimersByTime(30000)
    expect(res.write).toHaveBeenCalledTimes(1)

    // Simulate connection close
    handlers.close()

    vi.advanceTimersByTime(30000)
    expect(res.write).toHaveBeenCalledTimes(1) // no new writes
    vi.useRealTimers()
  })

  it('calls removeClient on connection close', () => {
    const { res, handlers } = callHandler()
    handlers.close()
    expect(removeClient).toHaveBeenCalledWith(res)
  })

  it('calls removeClient when heartbeat write throws', () => {
    vi.useFakeTimers()
    const { res } = callHandler()
    res.write.mockImplementation(() => { throw new Error('write failed') })

    vi.advanceTimersByTime(30000)
    expect(removeClient).toHaveBeenCalledWith(res)
    vi.useRealTimers()
  })
})
