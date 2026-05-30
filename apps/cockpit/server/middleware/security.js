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
  return /^http:\/\/localhost(:\d+)?$/
}

export const securityMiddleware = [helmetMiddleware, limiter, apiKeyAuth]
