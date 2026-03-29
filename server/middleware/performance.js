import compression from 'compression'

const compress = compression({ threshold: 1024 })

function timeout(req, res, next) {
  if (req.path === '/api/stream') return next()
  req.setTimeout(30000)
  res.setTimeout(30000)
  next()
}

function cacheControl(req, res, next) {
  if (req.path.startsWith('/assets/')) {
    res.set('Cache-Control', 'public, max-age=31536000, immutable')
  } else if (req.path.startsWith('/api/')) {
    res.set('Cache-Control', 'no-store')
  }
  next()
}

export const performanceMiddleware = [compress, timeout, cacheControl]
