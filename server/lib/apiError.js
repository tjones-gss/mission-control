export class ApiError extends Error {
  constructor(status, message, code = 'INTERNAL_ERROR') {
    super(message)
    this.status = status
    this.code = code
    this.name = 'ApiError'
  }
}

export const badRequest = (msg, code = 'BAD_REQUEST') => new ApiError(400, msg, code)
export const notFound = (msg, code = 'NOT_FOUND') => new ApiError(404, msg, code)
export const conflict = (msg, code = 'CONFLICT') => new ApiError(409, msg, code)
export const unauthorized = (msg = 'Unauthorized', code = 'UNAUTHORIZED') =>
  new ApiError(401, msg, code)
