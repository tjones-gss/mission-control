export function errorHandler(err, req, res, _next) {
  const status = err.status || 500
  const requestId = req.id || req.headers?.['x-request-id'] || 'unknown'

  const logFn = req.log?.error?.bind(req.log) || console.error
  logFn({ err, requestId, method: req.method, url: req.originalUrl }, err.message)

  // Sanitize body-parser errors with stable user-friendly codes.
  // The raw messages leak parser internals to the client and use the
  // generic 'INTERNAL_ERROR' code for 4xx conditions that should
  // really be PAYLOAD_TOO_LARGE / INVALID_JSON / etc.
  const isParseError = err.type === 'entity.parse.failed'
  const isPayloadTooLarge = err.type === 'entity.too.large' || status === 413
  let message
  let code = err.code
  if (isParseError) {
    message = 'Invalid JSON in request body'
    code = 'INVALID_JSON'
  } else if (isPayloadTooLarge) {
    message = 'Request body too large (max 1MB)'
    code = 'PAYLOAD_TOO_LARGE'
  } else if (status < 500) {
    message = err.message
  } else {
    message = 'Internal server error'
  }

  if (!res.headersSent) {
    res.status(status).json({
      error: message,
      code: code || 'INTERNAL_ERROR',
      requestId,
    })
  }
}
