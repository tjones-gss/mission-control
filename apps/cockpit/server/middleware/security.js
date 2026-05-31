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
//   CSRF / browser-page threat (NOW MITIGATED for state-changing routes):
//   hostCheck stops a foreign *Host* (DNS-rebinding), but it does NOT stop a
//   malicious web page already open in the user's own browser — or any local
//   process serving on some localhost port — from issuing a forged
//   "localhost" POST (classic CSRF). The cockpit DOES ship state-changing,
//   safety-critical endpoints today, notably:
//     POST /api/sessions/:id/tool-approval  (resolves a paused tool approval —
//                                            can make a halted agent proceed
//                                            with a destructive tool call)
//     POST /api/sessions/:id/cancel
//   Those are now defended by originGuard() below, which is wired in index.js
//   for every state-changing method (POST/PUT/PATCH/DELETE). It:
//     1. Pins the request Origin (or Referer, if Origin is absent) to a STRICT
//        allowlist of the cockpit's OWN client origins — NOT the any-localhost
//        regex. A cross-origin page cannot forge the Origin header, so a forged
//        POST from evil.example.com (or from a different localhost port that is
//        not the cockpit's client) is rejected with 403 forbidden_origin.
//     2. Rejects any non-`application/json` Content-Type with 415. A simple
//        cross-origin HTML form can only send text/plain,
//        application/x-www-form-urlencoded, or multipart/form-data, so demanding
//        JSON forces a CORS preflight that the strict CORS policy then blocks —
//        closing the simple-form CSRF vector as defense-in-depth. (A request
//        with no body and no Content-Type — e.g. the client's /cancel POST — is
//        still allowed; the Origin pin alone protects it.)
//   RESIDUAL GAP: a hostile page served from an *allowed* origin/port (e.g.
//   another app the user runs on :5173, or an XSS in the cockpit client itself)
//   can still drive these endpoints — Origin pinning cannot distinguish two
//   pages that share an allowed origin. Full per-session token auth (a secret
//   the browser cannot obtain cross-context) remains the path to exposing
//   destructive browser-approval more broadly / to non-loopback deployments;
//   token auth MUST also become on-by-default before any such exposure.
//
// True when OVERSIGHT_API_KEY is set AND the request presents the matching key.
// A valid API key is NOT a CSRF vector: a malicious cross-origin page cannot be
// made to attach the custom `x-api-key` header (it would force a CORS preflight
// that the strict CORS policy blocks), so key-authenticated callers (curl, CI,
// programmatic clients with no browser Origin) are trusted by both guards below.
export function hasValidApiKey(req) {
  const key = process.env.OVERSIGHT_API_KEY
  if (!key) return false
  const provided = req.headers['x-api-key'] || req.query?.apiKey
  return provided === key
}

// Optional API key auth (only active when OVERSIGHT_API_KEY env var is set)
export function apiKeyAuth(req, res, next) {
  const key = process.env.OVERSIGHT_API_KEY
  if (!key) return next()
  if (hasValidApiKey(req)) return next()
  if (
    req.path === '/api/health' ||
    req.path.startsWith('/api/health/') ||
    req.path === '/api/stream'
  )
    return next()
  res.status(401).json({ error: 'Unauthorized', code: 'AUTH_REQUIRED' })
}

// Strict client-origin allowlist.
//
// These are the cockpit's OWN browser client origins — the Vite dev client
// (default port 5173) on both loopback spellings, plus the server's own origin
// (so a page served directly from the API host can call it). This is
// deliberately NARROWER than the any-localhost regex hostCheck uses: a foreign
// page on some *other* localhost port is exactly the CSRF threat we are closing,
// so it must NOT be a trusted origin even though it is a loopback Host.
//
// OVERSIGHT_ALLOWED_ORIGINS (comma-separated) overrides the default allowlist
// used by originGuard. OVERSIGHT_CORS_ORIGIN (existing) overrides what CORS
// echoes; the two default to the same strict list so CORS and the CSRF guard
// agree.
function defaultClientOrigins() {
  const port = process.env.PORT || '3001'
  const origins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]
  // De-dupe (PORT could be 5173) while preserving order.
  return [...new Set(origins)]
}

function parseOriginsEnv(value) {
  if (!value) return null
  const list = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length ? list : null
}

// The allowlist the originGuard pins against.
export function getAllowedOrigins() {
  return (
    parseOriginsEnv(process.env.OVERSIGHT_ALLOWED_ORIGINS) ||
    parseOriginsEnv(process.env.OVERSIGHT_CORS_ORIGIN) ||
    defaultClientOrigins()
  )
}

// CORS origin from env, defaulting to the STRICT client-origin allowlist.
//
// Previously this fell back to /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
// which trusted ANY localhost port (council #8). That contradicted the CSRF
// guard, so the default is now the same strict allowlist getAllowedOrigins()
// uses. OVERSIGHT_CORS_ORIGIN still overrides for custom deployments.
export function getCorsOrigin() {
  return (
    parseOriginsEnv(process.env.OVERSIGHT_CORS_ORIGIN) ||
    parseOriginsEnv(process.env.OVERSIGHT_ALLOWED_ORIGINS) ||
    defaultClientOrigins()
  )
}

// State-changing HTTP methods that the originGuard protects. Simple/safe
// methods (GET/HEAD/OPTIONS) are exempt — CORS handles cross-origin reads, and
// a CSRF GET cannot change state on a correctly-built API.
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Paths exempt from the originGuard:
//   /api/stream  — Server-Sent Events. The browser EventSource API cannot set
//                  custom headers and SSE is a long-lived GET anyway; it must
//                  never be blocked or the dashboard shows "disconnected".
//   /api/health  — liveness/readiness probes (and curl/monitoring) that have no
//                  Origin and change no state.
function isOriginGuardExempt(req) {
  const p = req.path
  if (p === '/api/stream') return true
  if (p === '/api/health' || p.startsWith('/api/health/')) return true
  return false
}

// Extract the scheme://host[:port] origin of a URL string (Origin is already in
// this form; Referer is a full URL we must reduce to its origin).
function originOfUrl(value) {
  try {
    const u = new URL(value)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}

// CSRF / Origin-guard for state-changing requests.
//
// Wire AFTER hostCheck + CORS but BEFORE the routers (see index.js). It pins the
// request's Origin (or Referer fallback) to the strict client-origin allowlist
// and requires a JSON content type. See the SECURITY block above for the full
// threat model and residual gap.
export function originGuard(req, res, next) {
  if (!STATE_CHANGING_METHODS.has(req.method)) return next()
  if (isOriginGuardExempt(req)) return next()

  // A valid API key bypasses the Origin pin: it is an explicit, non-browser
  // credential and not forgeable cross-origin, so key-authenticated clients
  // (curl/CI/programmatic, which send no Origin) must not be rejected here.
  if (hasValidApiKey(req)) return next()

  const allowed = getAllowedOrigins()

  // 1. Origin pin. Prefer Origin (always sent by browsers on cross-origin and
  //    on all POST/PUT/PATCH/DELETE fetch requests); fall back to Referer's
  //    origin if Origin is absent. A state-changing request with neither header
  //    is rejected — a same-origin browser request always carries at least one.
  const originHeader = req.headers.origin
  const requestOrigin = originHeader || originOfUrl(req.headers.referer || '')
  if (!requestOrigin || !allowed.includes(requestOrigin)) {
    return res.status(403).json({ error: 'forbidden_origin' })
  }

  // 2. Content-type requirement (defense-in-depth against simple-form CSRF).
  //    A request with no body / no Content-Type (e.g. the client's /cancel POST)
  //    is allowed — the Origin pin already protects it. When a Content-Type IS
  //    present it must be application/json or multipart/form-data: the JSON path
  //    forces a CORS preflight (text/plain & x-www-form-urlencoded are rejected
  //    here, closing the classic simple-form CSRF vector), while multipart is
  //    the cockpit's only legitimate non-JSON state-changing body (the image
  //    upload on POST /api/sessions/:id/message) and remains Origin-pinned.
  const contentType = req.headers['content-type']
  if (contentType) {
    const base = contentType.split(';')[0].trim().toLowerCase()
    if (base !== 'application/json' && base !== 'multipart/form-data') {
      return res.status(415).json({ error: 'unsupported_media_type' })
    }
  }

  return next()
}

export const securityMiddleware = [helmetMiddleware, limiter, apiKeyAuth]
