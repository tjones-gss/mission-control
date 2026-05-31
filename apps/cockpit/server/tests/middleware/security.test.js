import {
  securityMiddleware,
  apiKeyAuth,
  getCorsOrigin,
  getAllowedOrigins,
  hostCheck,
  originGuard,
} from '../../middleware/security.js'

describe('security middleware', () => {
  let savedApiKey
  let savedCorsOrigin
  let savedAllowedHosts
  let savedAllowedOrigins

  beforeEach(() => {
    savedApiKey = process.env.OVERSIGHT_API_KEY
    savedCorsOrigin = process.env.OVERSIGHT_CORS_ORIGIN
    savedAllowedHosts = process.env.OVERSIGHT_ALLOWED_HOSTS
    savedAllowedOrigins = process.env.OVERSIGHT_ALLOWED_ORIGINS
    delete process.env.OVERSIGHT_API_KEY
    delete process.env.OVERSIGHT_CORS_ORIGIN
    delete process.env.OVERSIGHT_ALLOWED_HOSTS
    delete process.env.OVERSIGHT_ALLOWED_ORIGINS
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
    if (savedAllowedOrigins !== undefined) {
      process.env.OVERSIGHT_ALLOWED_ORIGINS = savedAllowedOrigins
    } else {
      delete process.env.OVERSIGHT_ALLOWED_ORIGINS
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
    // NOTE: the default is now the STRICT client-origin allowlist, NOT the old
    // any-localhost regex. The any-localhost default was a CSRF hole (council
    // #8): it trusted a malicious page served from any other localhost port.
    // This test was updated to the new stricter default — do not relax it back.
    it('returns the strict client-origin allowlist when no env var set', () => {
      const origin = getCorsOrigin()
      expect(Array.isArray(origin)).toBe(true)
      // The Vite client (both loopback spellings) is allowed...
      expect(origin).toContain('http://localhost:5173')
      expect(origin).toContain('http://127.0.0.1:5173')
      // ...the server's own origin (default port 3001) is allowed...
      expect(origin).toContain('http://localhost:3001')
      expect(origin).toContain('http://127.0.0.1:3001')
      // ...but an arbitrary localhost port is NOT (this is the closed hole)...
      expect(origin).not.toContain('http://localhost:3000')
      // ...and a foreign origin is never present.
      expect(origin).not.toContain('http://example.com')
    })

    it('honors PORT for the server-own origin in the default allowlist', () => {
      const savedPort = process.env.PORT
      process.env.PORT = '4000'
      try {
        const origin = getCorsOrigin()
        expect(origin).toContain('http://localhost:4000')
        expect(origin).toContain('http://127.0.0.1:4000')
      } finally {
        if (savedPort !== undefined) process.env.PORT = savedPort
        else delete process.env.PORT
      }
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

  describe('originGuard (CSRF / Origin pin)', () => {
    const ALLOWED = 'http://localhost:5173'

    function makeReq({
      method = 'POST',
      path = '/api/sessions/abc/tool-approval',
      origin,
      referer,
      contentType = 'application/json',
    } = {}) {
      const headers = {}
      if (origin !== undefined) headers.origin = origin
      if (referer !== undefined) headers.referer = referer
      if (contentType !== undefined) headers['content-type'] = contentType
      return { method, path, headers }
    }

    function makeRes() {
      return { status: vi.fn().mockReturnThis(), json: vi.fn() }
    }

    it('rejects a POST with a foreign Origin with 403 forbidden_origin', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(makeReq({ origin: 'https://evil.example.com' }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({ error: 'forbidden_origin' })
    })

    it('rejects a POST from a different localhost port (the closed any-localhost hole)', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(makeReq({ origin: 'http://localhost:9999' }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({ error: 'forbidden_origin' })
    })

    it('passes a POST with an allowed Origin + application/json', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(makeReq({ origin: ALLOWED, contentType: 'application/json' }), res, next)
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('passes a POST with an allowed Origin + application/json; charset=utf-8', () => {
      const next = vi.fn()
      originGuard(
        makeReq({ origin: ALLOWED, contentType: 'application/json; charset=utf-8' }),
        makeRes(),
        next,
      )
      expect(next).toHaveBeenCalled()
    })

    it('rejects an allowed Origin but text/plain Content-Type with 415', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(makeReq({ origin: ALLOWED, contentType: 'text/plain' }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(415)
      expect(res.json).toHaveBeenCalledWith({ error: 'unsupported_media_type' })
    })

    it('rejects an allowed Origin but x-www-form-urlencoded Content-Type with 415', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        makeReq({ origin: ALLOWED, contentType: 'application/x-www-form-urlencoded' }),
        res,
        next,
      )
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(415)
    })

    it('allows multipart/form-data from an allowed Origin (image upload)', () => {
      const next = vi.fn()
      originGuard(
        makeReq({
          path: '/api/sessions/abc/message',
          origin: ALLOWED,
          contentType: 'multipart/form-data; boundary=----x',
        }),
        makeRes(),
        next,
      )
      expect(next).toHaveBeenCalled()
    })

    it('allows a bodyless POST (no Content-Type) from an allowed Origin (the /cancel call)', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        makeReq({ path: '/api/sessions/abc/cancel', origin: ALLOWED, contentType: undefined }),
        res,
        next,
      )
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('rejects a state-changing request with NO Origin and NO Referer with 403', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(makeReq({ origin: undefined, referer: undefined }), res, next)
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
      expect(res.json).toHaveBeenCalledWith({ error: 'forbidden_origin' })
    })

    it('bypasses the Origin pin when a valid API key is present (curl/CI, no Origin)', () => {
      // A valid x-api-key is not a CSRF vector (a browser can't be forced to send
      // a custom header cross-origin), so key-authenticated clients with no
      // browser Origin must pass — otherwise apiKeyAuth's contract is broken.
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        { method: 'POST', path: '/api/sessions/abc/tool-approval', headers: { 'x-api-key': 'secret-key-123' } },
        res,
        next,
      )
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('still rejects a foreign-Origin POST that lacks a valid API key when a key is configured', () => {
      // The API-key bypass must not weaken the guard for unauthenticated callers.
      process.env.OVERSIGHT_API_KEY = 'secret-key-123'
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        { method: 'POST', path: '/api/sessions/abc/tool-approval', headers: { origin: 'https://evil.example.com', 'content-type': 'application/json' } },
        res,
        next,
      )
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('falls back to Referer origin when Origin is absent', () => {
      const next = vi.fn()
      originGuard(
        makeReq({ origin: undefined, referer: 'http://localhost:5173/some/path?q=1' }),
        makeRes(),
        next,
      )
      expect(next).toHaveBeenCalled()
    })

    it('rejects when Referer origin is foreign', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        makeReq({ origin: undefined, referer: 'https://evil.example.com/x' }),
        res,
        next,
      )
      expect(next).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('does NOT block a GET with a foreign Origin (CORS handles reads, not this guard)', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        makeReq({ method: 'GET', path: '/api/sessions', origin: 'https://evil.example.com', contentType: undefined }),
        res,
        next,
      )
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('exempts /api/stream (SSE) even on a state-changing method with foreign Origin', () => {
      const res = makeRes()
      const next = vi.fn()
      originGuard(
        makeReq({ path: '/api/stream', origin: 'https://evil.example.com', contentType: undefined }),
        res,
        next,
      )
      expect(next).toHaveBeenCalled()
      expect(res.status).not.toHaveBeenCalled()
    })

    it('exempts /api/health from the guard', () => {
      const next = vi.fn()
      originGuard(
        makeReq({ path: '/api/health', origin: 'https://evil.example.com', contentType: undefined }),
        makeRes(),
        next,
      )
      expect(next).toHaveBeenCalled()
    })

    it('honors OVERSIGHT_ALLOWED_ORIGINS override', () => {
      process.env.OVERSIGHT_ALLOWED_ORIGINS = 'https://cockpit.internal'
      const okNext = vi.fn()
      originGuard(makeReq({ origin: 'https://cockpit.internal' }), makeRes(), okNext)
      expect(okNext).toHaveBeenCalled()

      // the previous default origin is no longer trusted once overridden
      const res = makeRes()
      const denyNext = vi.fn()
      originGuard(makeReq({ origin: ALLOWED }), res, denyNext)
      expect(denyNext).not.toHaveBeenCalled()
      expect(res.status).toHaveBeenCalledWith(403)
    })
  })

  describe('getAllowedOrigins', () => {
    it('defaults to the strict client-origin allowlist', () => {
      const origins = getAllowedOrigins()
      expect(origins).toContain('http://localhost:5173')
      expect(origins).toContain('http://127.0.0.1:5173')
      expect(origins).not.toContain('http://localhost:3000')
    })

    it('prefers OVERSIGHT_ALLOWED_ORIGINS over OVERSIGHT_CORS_ORIGIN', () => {
      process.env.OVERSIGHT_ALLOWED_ORIGINS = 'http://a.test'
      process.env.OVERSIGHT_CORS_ORIGIN = 'http://b.test'
      expect(getAllowedOrigins()).toEqual(['http://a.test'])
    })
  })
})
