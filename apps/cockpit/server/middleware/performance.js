import compression from 'compression'

// SSE (/api/stream) must NEVER be compressed. The compression middleware
// buffers responses until it has enough data to flush a gzip block, which
// for a long-lived event stream means the browser sees nothing until the
// buffer fills — EventSource never fires `open`, the header shows
// "disconnected" forever, and SSE-driven refresh stops working.
// Bypass compression for SSE explicitly, and let everything else stream
// through the normal compression pipeline.
const compress = compression({ threshold: 1024 })
function maybeCompress(req, res, next) {
  if (req.path === '/api/stream') return next()
  return compress(req, res, next)
}

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

export const performanceMiddleware = [maybeCompress, timeout, cacheControl]
