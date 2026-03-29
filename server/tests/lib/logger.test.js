import { logger } from '../../lib/logger.js'

describe('logger', () => {
  test('exports a pino logger instance', () => {
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.debug).toBe('function')
  })

  test('default level is info', () => {
    expect(logger.level).toBe('info')
  })
})
