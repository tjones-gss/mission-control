import {
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  authHeaders,
  withAuthToken,
} from '../../lib/authToken.js'

describe('authToken lib', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('get/set/clear', () => {
    it('returns null when no token is stored', () => {
      expect(getAuthToken()).toBeNull()
    })

    it('round-trips a token through localStorage under mc_auth_token', () => {
      setAuthToken('tok-abc')
      expect(localStorage.getItem('mc_auth_token')).toBe('tok-abc')
      expect(getAuthToken()).toBe('tok-abc')
    })

    it('clearAuthToken removes the stored token', () => {
      setAuthToken('tok-abc')
      clearAuthToken()
      expect(getAuthToken()).toBeNull()
    })
  })

  describe('authHeaders', () => {
    it('returns an empty object when no token is set', () => {
      expect(authHeaders()).toEqual({})
    })

    it('adds an Authorization: Bearer header when a token is set', () => {
      setAuthToken('tok-abc')
      expect(authHeaders()).toEqual({ Authorization: 'Bearer tok-abc' })
    })

    it('merges with provided headers, keeping them', () => {
      setAuthToken('tok-abc')
      expect(authHeaders({ 'Content-Type': 'application/json' })).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer tok-abc',
      })
    })
  })

  describe('withAuthToken', () => {
    it('returns the url unchanged when no token is set', () => {
      expect(withAuthToken('/api/stream')).toBe('/api/stream')
    })

    it('appends ?token= when the url has no query string', () => {
      setAuthToken('tok-abc')
      expect(withAuthToken('/api/stream')).toBe('/api/stream?token=tok-abc')
    })

    it('appends &token= when the url already has a query string', () => {
      setAuthToken('tok-abc')
      expect(withAuthToken('/api/stream?x=1')).toBe('/api/stream?x=1&token=tok-abc')
    })

    it('url-encodes the token', () => {
      setAuthToken('a b/c')
      expect(withAuthToken('/api/stream')).toBe('/api/stream?token=a%20b%2Fc')
    })
  })
})
