import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

// Helmet: security headers (CSP, X-Frame-Options, HSTS, X-Content-Type-Options, etc.)
const helmetMiddleware = helmet({
  contentSecurityPolicy: process.env.OVERSIGHT_CSP !== 'false',
})

// Rate limit: applies per-IP. The default cap is intentionally generous for the
// localhost dev experience (the dashboard polls many endpoints and SSE
// reconnects can briefly burst). Set OVERSIGHT_RATE_LIMIT=0 to disable
// entirely, or pass a number to override. /api/stream and /api/health are
// always exempt because SSE reconnects must never be blocked — losing the
// stream is what causes the persistent "disconnected" header.
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.OVERSIGHT_RATE_LIMIT || '2000', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (process.env.OVERSIGHT_RATE_LIMIT === '0') return true
    if (req.path === '/api/stream') return true
    if (req.path === '/api/health' || req.path.startsWith('/api/health/')) return true
    return false
  },
})

// DNS-rebinding guard.
//
// A request's Host header is chosen by the *client*, not by DNS. DNS-rebinding
// attacks work by pointing an attacker-controlled domain (e.g. evil.example.com)
// at 127.0.0.1, then having the victim's browser send requests to our server —
// those requests carry `Host: evil.example.com`. A legitimate local client
// (the Vite dev client talking to the API, or curl to localhost) always sends
// `Host: localhost:<port>` or `Host: 127.0.0.1:<port>`. So rejecting any Host
// that is not a loopback name defeats DNS-rebinding without affecting the real
// client.
//
// Nothing is exempt — not even /api/health. A request arriving with a foreign
// Host should never be served any response that could leak data or be probed.
//
// OVERSIGHT_ALLOWED_HOSTS (comma-separated, host or host:port) lets an operator
// add extra allowed Host values for advanced/LAN setups.
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function parseAllowedHostsEnv() {
  const env = process.env.OVERSIGHT_ALLOWED_HOSTS
  if (!env) return []
  return env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

// Extract just the hostname portion of a Host header value, stripping any port.
// Handles IPv6 bracket form ([::1]:3001) as well as host:port.
function hostnameOf(hostHeader) {
  const h = hostHeader.trim().toLowerCase()
  if (h.startsWith('[')) {
    // IPv6 literal: [::1] or [::1]:3001 — keep the bracketed part.
    const end = h.indexOf(']')
    if (end !== -1) return h.slice(0, end + 1)
    return h
  }
  // host or host:port — split on the (single) colon.
  const colon = h.indexOf(':')
  return colon === -1 ? h : h.slice(0, colon)
}

export function hostCheck(req, res, next) {
  const hostHeader = req.headers.host
  // A missing Host header (HTTP/1.0, malformed client) is not a loopback host.
  if (!hostHeader) {
    return res.status(403).json({ error: 'forbidden_host' })
  }

  const allowed = parseAllowedHostsEnv()
  const lowerFull = hostHeader.trim().toLowerCase()
  // Allow exact env matches against either the full host[:port] or bare hostname.
  if (allowed.includes(lowerFull)) return next()

  const hostname = hostnameOf(hostHeader)
  if (allowed.includes(hostname)) return next()
  if (LOOPBACK_HOSTNAMES.has(hostname)) return next()

  return res.status(403).json({ error: 'forbidden_host' })
}

// SECURITY (token auth is OPT-IN today — deliberately):
//   apiKeyAuth below only enforces a token when OVERSIGHT_API_KEY is set, so by
//   default the API trusts any loopback caller. That is acceptable ONLY because
//   today the cockpit is a read/observe surface bound to localhost behind the
//   hostCheck guard above.
//
//   BEFORE shipping any browser-driven "approve a destructive operation" feature
//   (that work is deliberately deferred and NOT part of this change), token auth
//   MUST become on-by-default AND be paired with CSRF protection / strict Origin
//   pinning. Loopback binding + hostCheck stop a foreign *host*, but they do not
//   stop a malicious web page in the user's own browser from issuing same-origin
//   "localhost" requests (CSRF). Destructive, state-changing endpoints therefore
//   need a defense the browser cannot forge (a secret token / CSRF token / pinned
//   Origin check) before they can be safely exposed.
//
// Optional API key auth (only active when OVERSIGHT_API_KEY env var is set)
export function apiKeyAuth(req, res, next) {
  const key = process.env.OVERSIGHT_API_KEY
  if (!key) return next()
  const provided = req.headers['x-api-key'] || req.query.apiKey
  if (provided === key) return next()
  if (
    req.path === '/api/health' ||
    req.path.startsWith('/api/health/') ||
    req.path === '/api/stream'
  )
    return next()
  res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
}

// CORS origin from env (falls back to localhost regex)
export function getCorsOrigin() {
  const env = process.env.OVERSIGHT_CORS_ORIGIN
  if (env) return env.split(',').map((s) => s.trim())
  // Accept both localhost and 127.0.0.1 (any port) so CORS stays consistent
  // with the hostCheck DNS-rebinding guard, which treats both as loopback.
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
}

export const securityMiddleware = [helmetMiddleware, limiter, apiKeyAuth]
