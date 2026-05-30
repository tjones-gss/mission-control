import { errorHandler } from '../../middleware/errorHandler.js'
import { ApiError } from '../../lib/apiError.js'

describe('errorHandler', () => {
  function makeReqRes(overrides = {}) {
    return {
      req: {
        method: 'GET',
        originalUrl: '/api/test',
        headers: { 'x-request-id': 'req-123' },
        log: { error: vi.fn() },
        ...overrides.req,
      },
      res: {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
        ...overrides.res,
      },
      next: vi.fn(),
    }
  }

  test('sends ApiError status and message', () => {
    const { req, res, next } = makeReqRes()
    const err = new ApiError(422, 'Bad input', 'VALIDATION')

    errorHandler(err, req, res, next)

    expect(res.status).toHaveBeenCalledWith(422)
    expect(res.json).toHaveBeenCalledWith({
      error: 'Bad input',
      code: 'VALIDATION',
      requestId: 'req-123',
    })
  })

  test('sends 500 for unknown errors without leaking message', () => {
    const { req, res, next } = makeReqRes()
    const err = new Error('secret database details')

    errorHandler(err, req, res, next)

    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
      }),
    )
  })

  test('includes requestId from x-request-id header', () => {
    const { req, res, next } = makeReqRes()

    errorHandler(new Error('fail'), req, res, next)

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-123' }))
  })

  test('uses req.id if available', () => {
    const { req, res, next } = makeReqRes({ req: { id: 'pino-id-456' } })

    errorHandler(new Error('fail'), req, res, next)

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'pino-id-456' }))
  })

  test('does not send response if headers already sent', () => {
    const { req, res, next } = makeReqRes({ res: { headersSent: true } })

    errorHandler(new Error('fail'), req, res, next)

    expect(res.status).not.toHaveBeenCalled()
    expect(res.json).not.toHaveBeenCalled()
  })

  test('logs error with structured context', () => {
    const { req, res, next } = makeReqRes()
    const err = new Error('test error')

    errorHandler(err, req, res, next)

    expect(req.log.error).toHaveBeenCalled()
  })

  test('falls back to console.error when req.log not available', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { req, res, next } = makeReqRes({ req: { log: undefined } })

    errorHandler(new Error('fail'), req, res, next)

    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})
