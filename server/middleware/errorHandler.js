export function errorHandler(err, req, res, _next) {
  const status = err.status || 500
  const requestId = req.id || req.headers?.['x-request-id'] || 'unknown'

  const logFn = req.log?.error?.bind(req.log) || console.error
  logFn({ err, requestId, method: req.method, url: req.originalUrl }, err.message)

  // Sanitize body-parser JSON errors. The raw message leaks parser
  // internals to the client (e.g. "Expected property name or '}' in
  // JSON at position 1 (line 1 column 2)"). Replace with a clean
  // generic message and a stable error code.
  const isParseError = err.type === 'entity.parse.failed'
  let message
  if (isParseError) {
    message = 'Invalid JSON in request body'
  } else if (status < 500) {
    message = err.message
  } else {
    message = 'Internal server error'
  }

  if (!res.headersSent) {
    res.status(status).json({
      error: message,
      code: err.code || (isParseError ? 'INVALID_JSON' : 'INTERNAL_ERROR'),
      requestId,
    })
  }
}
