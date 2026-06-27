// Local auth token storage + helpers. The server (server/data/.auth-token)
// requires this token on every /api request; the user pastes it once on the
// /setup page, which persists it here under `mc_auth_token`.
const STORAGE_KEY = 'mc_auth_token'

export function getAuthToken() {
  try {
    return localStorage.getItem(STORAGE_KEY) || null
  } catch {
    return null
  }
}

export function setAuthToken(token) {
  try {
    localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // ignore (private mode / storage disabled)
  }
}

export function clearAuthToken() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Merge the Authorization header into a headers object when a token is set.
export function authHeaders(extra = {}) {
  const token = getAuthToken()
  return token ? { ...extra, Authorization: `Bearer ${token}` } : { ...extra }
}

// Append ?token=<token> to a URL — for EventSource, which can't set headers.
export function withAuthToken(url) {
  const token = getAuthToken()
  if (!token) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}token=${encodeURIComponent(token)}`
}
