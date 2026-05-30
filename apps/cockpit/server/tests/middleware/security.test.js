import {
  securityMiddleware,
  apiKeyAuth,
  getCorsOrigin,
  hostCheck,
} from '../../middleware/security.js'

describe('security middleware', () => {
  let savedApiKey
  let savedCorsOrigin
  let savedAllowedHosts

  beforeEach(() => {
    savedApiKey = process.env.OVERSIGHT_API_KEY
    savedCorsOrigin = process.env.OVERSIGHT_CORS_ORIGIN
    savedAllowedHosts = process.env.OVERSIGHT_ALLOWED_HOSTS
    delete process.env.OVERSIGHT_API_KEY
    delete process.env.OVERSIGHT_CORS_ORIGIN
    delete process.env.OVERSIGHT_ALLOWED_HOSTS
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
    if (savedAllowedHosts !== undefined) {
      process.env.OVERSIGHT_ALLOWED_HOSTS = savedAllowedHosts
    } else {
      delete process.env.OVERSIGHT_ALLOWED_HOSTS
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
      expect(origin.test('http://127.0.0.1')).toBe(true)
      expect(origin.test('http://127.0.0.1:5173')).toBe(true)
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

  describe('hostCheck (DNS-rebinding guard)', () => {
    function makeReq(hostHeader, overrides = {}) {
      return { headers: hostHeader === undefined ? {} : { host: hostHeader }, path: '/api/sessions', ...overrides }
    }

    function makeRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() }
    }

    it('rejects a foreign Host (DNS-rebinding) with 403 forbidden_host', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq('evil.example.com'), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({ error: 'forbidden_host' })
    })

    it('rejects a foreign Host even when it carries a port', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq('evil.example.com:3001'), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('passes Host: localhost (the real client)', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq('localhost:3001'), res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('passes Host: 127.0.0.1', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq('127.0.0.1:3001'), res, next)
      expect(next).toHaveBeenCalled()
    })

    it('passes Host: localhost without a port', () => {
      const next = vi.fn()
      hostCheck(makeReq('localhost'), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('passes the IPv6 loopback literal [::1]', () => {
      const next = vi.fn()
      hostCheck(makeReq('[::1]:3001'), makeRes(), next)
      expect(next).toHaveBeenCalled()
    })

    it('rejects a request with a missing Host header', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq(undefined), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('does not exempt health from the host check', () => {
      const res = makeRes()
      const next = vi.fn()
      hostCheck(makeReq('evil.example.com', { path: '/api/health' }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('honors OVERSIGHT_ALLOWED_HOSTS override', () => {
      process.env.OVERSIGHT_ALLOWED_HOSTS = 'cockpit.local, dev.internal:3001'
      const next = vi.fn()
      hostCheck(makeReq('cockpit.local'), makeRes(), next)
      expect(next).toHaveBeenCalled()

      const next2 = vi.fn()
      hostCheck(makeReq('dev.internal:3001'), makeRes(), next2)
      expect(next2).toHaveBeenCalled()

      const res = makeRes()
      const next3 = vi.fn()
      hostCheck(makeReq('other.host'), res, next3)
      expect(next3).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })
})
