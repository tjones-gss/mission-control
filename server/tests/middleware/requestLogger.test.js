import { requestLogger } from '../../middleware/requestLogger.js'

describe('requestLogger', () => {
  test('is a function (Express middleware)', () => {
    expect(typeof requestLogger).toBe('function')
  })

  test('adds log property to req when called', () => {
    const req = { headers: {}, method: 'GET', url: '/test' }
    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const next = vi.fn()

    requestLogger(req, res, next)

    expect(req.log).toBeDefined()
    expect(typeof req.log.info).toBe('function')
    expect(next).toHaveBeenCalled()
  })

  test('assigns request ID from x-request-id header', () => {
    const req = { headers: { 'x-request-id': 'test-req-123' }, method: 'GET', url: '/test' }
    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const next = vi.fn()

    requestLogger(req, res, next)

    expect(req.id).toBe('test-req-123')
  })

  test('generates request ID when x-request-id not provided', () => {
    const req = { headers: {}, method: 'GET', url: '/test' }
    const res = {
      setHeader: vi.fn(),
      getHeader: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const next = vi.fn()

    requestLogger(req, res, next)

    expect(req.id).toBeDefined()
    expect(typeof req.id).toBe('string')
    expect(req.id.length).toBeGreaterThan(0)
  })
})
