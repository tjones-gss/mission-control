import { getAuthToken } from './authToken.js'

// Install a one-time fetch wrapper that attaches the auth token to same-origin
// /api requests. The client makes ~50 raw fetch() calls (POST message, approve,
// fleet launch, search, …); rather than thread the token through every call
// site, this single chokepoint adds `Authorization: Bearer <token>` to any
// relative /api request that doesn't already carry it. useApi adds the header
// itself too (so it's self-sufficient in isolation) — the overlap is harmless.
export function installAuthFetch() {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return
  if (window.fetch.__mcAuthWrapped) return

  const original = window.fetch.bind(window)
  const wrapped = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || ''
    const token = getAuthToken()
    if (token && url.startsWith('/api')) {
      const headers = new Headers(init.headers || {})
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
      return original(input, { ...init, headers })
    }
    return original(input, init)
  }
  wrapped.__mcAuthWrapped = true
  window.fetch = wrapped
}
