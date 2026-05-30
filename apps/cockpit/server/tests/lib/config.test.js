import { config } from '../../lib/config.js'

describe('config', () => {
  test('port defaults to 3001', () => {
    expect(config.port).toBe(3001)
  })

  test('host defaults to loopback (127.0.0.1), not 0.0.0.0', () => {
    // Loopback-only bind by default — no LAN exposure out of the box.
    // Operators opt into wider binding via OVERSIGHT_HOST.
    expect(config.host).toBe('127.0.0.1')
  })

  test('logLevel defaults to info', () => {
    expect(config.logLevel).toBe('info')
  })

  test('nodeEnv defaults to development or test', () => {
    expect(['development', 'test']).toContain(config.nodeEnv)
  })

  test('corsOrigin defaults to null', () => {
    expect(config.corsOrigin).toBeNull()
  })

  test('apiKey defaults to null', () => {
    expect(config.apiKey).toBeNull()
  })

  test('rateLimit defaults to 100', () => {
    expect(config.rateLimit).toBe(100)
  })
})
