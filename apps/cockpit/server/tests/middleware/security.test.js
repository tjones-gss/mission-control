import { securityMiddleware, apiKeyAuth, getCorsOrigin } from '../../middleware/security.js'

describe('security middleware', () => {
  let savedApiKey
  let savedCorsOrigin

  beforeEach(() => {
    savedApiKey = process.env.OVERSIGHT_API_KEY
    savedCorsOrigin = process.env.OVERSIGHT_CORS_ORIGIN
    delete process.env.OVERSIGHT_API_KEY
    delete process.env.OVERSIGHT_CORS_ORIGIN
  })

  afterEach(() => {
    if (savedApiKey !== undefined) {
      process.env.OVERSIGHT_API_KEY = savedApiKey
    } else {
      delete process.env.OVERSIGHT_API_KEY
    }
    if (savedCorsOrigin !== undefined) {
      process.env.OVERSIGHT_CORS_ORIGIN = savedCorsOrigin
    } else {
      delete process.env.OVERSIGHT_CORS_ORIGIN
    }
  })

  describe('securityMiddleware', () => {
    it('is an array of 3 middleware functions', () => {
      expect(Array.isArray(securityMiddleware)).toBe(true)
      expect(securityMiddleware).toHaveLength(3)
      securityMiddleware.forEach((mw) => {
        expect(typeof mw).toBe('function')
      })
    })
  })

  describe('getCorsOrigin', () => {
    it('returns localhost regex when no env var set', () => {
      const origin = getCorsOrigin()
      expect(origin).toBeInstanceOf(RegExp)
      expect(origin.test('http://localhost')).toBe(true)
      expect(origin.test('http://localhost:3000')).toBe(true)
      expect(origin.test('http://localhost:5173')).toBe(true)
      expect(origin.test('http://example.com')).toBe(false)
    })

    it('returns array of origins when OVERSIGHT_CORS_ORIGIN is set', () => {
      process.env.OVERSIGHT_CORS_ORIGIN = 'https://example.com, https://other.com'
      const origin = getCorsOrigin()
      expect(Array.isArray(origin)).toBe(true)
      expect(origin).toEqual(['https://example.com', 'https://other.com'])
    })
  })

  describe('apiKeyAuth', () => {
    function makeReq(overrides = {}) {
      return { headers: {}, query: {}, path: '/api/sessions', ...overrides }
    }

    function makeRes() {
      const res = { status: vi.fn().mockReturnThis(), json: vi.fn() }
      return res
    }

    it('calls next() when no OVERSIGHT_API_KEY configured', () => {
      const next = vi.fn()
      apiKeyAuth(makeReq(), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('returns 401 when key configured but not provided', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const res = makeRes()
      const next = vi.fn()
      apiKeyAuth(makeReq(), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
    })

    it('passes when correct x-api-key header provided', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const next = vi.fn()
      apiKeyAuth(makeReq({ headers: { 'x-api-key': 'secret-key-123' } }), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('passes when correct apiKey query param provided', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const next = vi.fn()
      apiKeyAuth(makeReq({ query: { apiKey: 'secret-key-123' } }), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('allows /api/health without key', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const next = vi.fn()
      apiKeyAuth(makeReq({ path: '/api/health' }), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('allows /api/health/ready without key', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const next = vi.fn()
      apiKeyAuth(makeReq({ path: '/api/health/ready' }), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('allows /api/stream without key', () => {
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const next = vi.fn()
      apiKeyAuth(makeReq({ path: '/api/stream' }), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })
  })
})
