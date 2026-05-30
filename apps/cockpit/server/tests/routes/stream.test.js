import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'

vi.mock('../../watcher.js', () => ({
  addClient: vi.fn(),
  removeClient: vi.fn(),
}))

vi.mock('../../sse.js', () => ({
  initClient: vi.fn(),
}))

const { addClient, removeClient } = await import('../../watcher.js')
const { initClient } = await import('../../sse.js')
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
    on: vi.fn((event, cb) => {
      handlers[event] = cb
    }),
  }
  const req = { method: 'GET', url: '/' }
  const next = vi.fn()

  // Walk the router stack to find and invoke the GET / handler
  const layer = router.stack.find((l) => l.route && l.route.path === '/' && l.route.methods.get)
  layer.route.stack[0].handle(req, res, next)

  return { res, handlers }
}

describe('GET / (SSE stream)', () => {
  it('delegates SSE setup to initClient', () => {
    const { res } = callHandler()
    expect(initClient).toHaveBeenCalledTimes(1)
    expect(initClient).toHaveBeenCalledWith(res)
  })

  it('calls addClient with the response object', () => {
    const { res } = callHandler()
    expect(addClient).toHaveBeenCalledTimes(1)
    expect(addClient).toHaveBeenCalledWith(res)
  })

  it('registers a close handler on the response', () => {
    const { res } = callHandler()
    expect(res.on).toHaveBeenCalledWith('close', expect.any(Function))
  })

  it('calls removeClient on connection close', () => {
    const { res, handlers } = callHandler()
    handlers.close()
    expect(removeClient).toHaveBeenCalledWith(res)
  })
})
