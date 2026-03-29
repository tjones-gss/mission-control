import { performanceMiddleware } from '../../middleware/performance.js'

describe('performance middleware', () => {
  test('exports array of 3 middleware functions', () => {
    expect(Array.isArray(performanceMiddleware)).toBe(true)
    expect(performanceMiddleware).toHaveLength(3)
    performanceMiddleware.forEach((fn) => expect(typeof fn).toBe('function'))
  })

  describe('timeout', () => {
    const timeout = performanceMiddleware[1]

    test('sets timeout on regular requests', () => {
      const req = { path: '/api/sessions', setTimeout: vi.fn() }
      const res = { setTimeout: vi.fn() }
      const next = vi.fn()

      timeout(req, res, next)

      expect(req.setTimeout).toHaveBeenCalledWith(30000)
      expect(res.setTimeout).toHaveBeenCalledWith(30000)
      expect(next).toHaveBeenCalled()
    })

    test('skips timeout for SSE stream endpoint', () => {
      const req = { path: '/api/stream', setTimeout: vi.fn() }
      const res = { setTimeout: vi.fn() }
      const next = vi.fn()

      timeout(req, res, next)

      expect(req.setTimeout).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })
  })

  describe('cacheControl', () => {
    const cacheControl = performanceMiddleware[2]

    test('sets no-store for API routes', () => {
      const req = { path: '/api/sessions' }
      const res = { set: vi.fn() }
      const next = vi.fn()

      cacheControl(req, res, next)

      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store')
      expect(next).toHaveBeenCalled()
    })

    test('sets immutable cache for asset routes', () => {
      const req = { path: '/assets/main.js' }
      const res = { set: vi.fn() }
      const next = vi.fn()

      cacheControl(req, res, next)

      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'public, max-age=31536000, immutable')
    })

    test('does not set cache headers for other routes', () => {
      const req = { path: '/other' }
      const res = { set: vi.fn() }
      const next = vi.fn()

      cacheControl(req, res, next)

      expect(res.set).not.toHaveBeenCalled()
      expect(next).toHaveBeenCalled()
    })
  })
})
