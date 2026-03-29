import { ApiError, badRequest, notFound, conflict, unauthorized } from '../../lib/apiError.js'

describe('ApiError', () => {
  test('creates error with status, message, code', () => {
    const err = new ApiError(422, 'Invalid input', 'VALIDATION_ERROR')
    expect(err.status).toBe(422)
    expect(err.message).toBe('Invalid input')
    expect(err.code).toBe('VALIDATION_ERROR')
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })

  test('defaults code to INTERNAL_ERROR', () => {
    const err = new ApiError(500, 'Something broke')
    expect(err.code).toBe('INTERNAL_ERROR')
  })

  test('badRequest creates 400 error', () => {
    const err = badRequest('Missing field')
    expect(err.status).toBe(400)
    expect(err.message).toBe('Missing field')
    expect(err.code).toBe('BAD_REQUEST')
  })

  test('notFound creates 404 error', () => {
    const err = notFound('Session not found')
    expect(err.status).toBe(404)
    expect(err.code).toBe('NOT_FOUND')
  })

  test('conflict creates 409 error', () => {
    const err = conflict('Already exists')
    expect(err.status).toBe(409)
    expect(err.code).toBe('CONFLICT')
  })

  test('unauthorized creates 401 error', () => {
    const err = unauthorized()
    expect(err.status).toBe(401)
    expect(err.code).toBe('UNAUTHORIZED')
  })

  test('factory helpers accept custom code', () => {
    const err = badRequest('Oops', 'CUSTOM_CODE')
    expect(err.code).toBe('CUSTOM_CODE')
  })
})
