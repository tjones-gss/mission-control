import { config, isLanHost } from '../../lib/config.js'

describe('config', () => {
  test('port defaults to 3001', () => {
    expect(config.port).toBe(3001)
  })

  test('host defaults to loopback (127.0.0.1), not 0.0.0.0', () => {
    // Loopback-only bind by default — no LAN exposure out of the box.
    // Operators opt into wider binding via OVERSIGHT_HOST.
    expect(config.host).toBe('127.0.0.1')
  })

  test('lanMode defaults to false (loopback bind)', () => {
    expect(config.lanMode).toBe(false)
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

describe('isLanHost', () => {
  test('loopback binds are NOT LAN', () => {
    for (const h of ['127.0.0.1', '::1', 'localhost', '', '  ', undefined, null]) {
      expect(isLanHost(h)).toBe(false)
    }
  })

  test('0.0.0.0 (all interfaces) IS LAN', () => {
    expect(isLanHost('0.0.0.0')).toBe(true)
  })

  test('a specific non-loopback address IS LAN', () => {
    expect(isLanHost('192.168.1.50')).toBe(true)
  })

  test('is case- and whitespace-insensitive', () => {
    expect(isLanHost(' LOCALHOST ')).toBe(false)
  })
})
