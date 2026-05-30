import pinoHttp from 'pino-http'
import crypto from 'crypto'
import { logger } from '../lib/logger.js'

export const requestLogger = pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
  customLogLevel: (req, res, err) => {
    if (req.url === '/api/health' || req.url?.startsWith('/api/health/')) return 'silent'
    if (res.statusCode >= 500 || err) return 'error'
    if (res.statusCode >= 400) return 'warn'
    return 'info'
  },
})
