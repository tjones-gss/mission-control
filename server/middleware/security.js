import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

// Helmet: security headers (CSP, X-Frame-Options, HSTS, X-Content-Type-Options, etc.)
const helmetMiddleware = helmet({
  contentSecurityPolicy: process.env.OVERSIGHT_CSP !== 'false',
})

// Rate limit: 100 req/15min per IP (configurable via env)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: parseInt(process.env.OVERSIGHT_RATE_LIMIT || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.OVERSIGHT_RATE_LIMIT === '0',
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
