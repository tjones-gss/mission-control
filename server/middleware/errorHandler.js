export function errorHandler(err, req, res, _next) {
  const status = err.status || 500
  const requestId = req.id || req.headers?.['x-request-id'] || 'unknown'

  const logFn = req.log?.error?.bind(req.log) || console.error
  logFn({ err, requestId, method: req.method, url: req.originalUrl }, err.message)

  if (!res.headersSent) {
    res.status(status).json({
      error: status < 500 ? err.message : 'Internal server error',
      code: err.code || 'INTERNAL_ERROR',
      requestId,
    })
  }
}
