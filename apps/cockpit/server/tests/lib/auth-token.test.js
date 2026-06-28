import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  generateToken,
  loadOrCreateToken,
  getActiveToken,
  setActiveToken,
} from '../../lib/auth-token.js'

describe('auth-token lib', () => {
  let dir
  let tokenPath
  let savedEnv

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'mc-auth-'))
    tokenPath = path.join(dir, '.auth-token')
    savedEnv = process.env.OVERSIGHT_AUTH_TOKEN
    delete process.env.OVERSIGHT_AUTH_TOKEN
    setActiveToken(null)
  })

  afterEach(() => {
    if (savedEnv !== undefined) process.env.OVERSIGHT_AUTH_TOKEN = savedEnv
    else delete process.env.OVERSIGHT_AUTH_TOKEN
    setActiveToken(null)
    rmSync(dir, { recursive: true, force: true })
  })

  describe('generateToken', () => {
    it('returns a 64-char hex string (32 bytes)', () => {
      const t = generateToken()
      expect(t).toMatch(/^[0-9a-f]{64}$/)
    })

    it('returns a different value each call', () => {
      expect(generateToken()).not.toBe(generateToken())
    })
  })

  describe('loadOrCreateToken', () => {
    it('generates and persists a token on first run (file absent)', () => {
      expect(existsSync(tokenPath)).toBe(false)
      const token = loadOrCreateToken({ tokenPath })
      expect(token).toMatch(/^[0-9a-f]{64}$/)
      expect(existsSync(tokenPath)).toBe(true)
      expect(readFileSync(tokenPath, 'utf8').trim()).toBe(token)
    })

    it('reads the existing token without regenerating on subsequent runs', () => {
      const first = loadOrCreateToken({ tokenPath })
      const second = loadOrCreateToken({ tokenPath })
      expect(second).toBe(first)
    })

    it('trims surrounding whitespace/newlines from the persisted file', () => {
      writeFileSync(tokenPath, '  abc123\n')
      expect(loadOrCreateToken({ tokenPath })).toBe('abc123')
    })

    it('regenerates a fresh token when the file is empty', () => {
      writeFileSync(tokenPath, '   \n')
      const token = loadOrCreateToken({ tokenPath })
      expect(token).toMatch(/^[0-9a-f]{64}$/)
    })

    it('honors OVERSIGHT_AUTH_TOKEN override without writing a file', () => {
      process.env.OVERSIGHT_AUTH_TOKEN = 'env-override-token'
      const token = loadOrCreateToken({ tokenPath })
      expect(token).toBe('env-override-token')
      expect(existsSync(tokenPath)).toBe(false)
    })

    it('sets the active token so getActiveToken() returns it', () => {
      const token = loadOrCreateToken({ tokenPath })
      expect(getActiveToken()).toBe(token)
    })
  })

  describe('getActiveToken', () => {
    it('returns null when nothing is configured', () => {
      expect(getActiveToken()).toBeNull()
    })

    it('prefers OVERSIGHT_AUTH_TOKEN over the loaded token', () => {
      setActiveToken('file-token')
      process.env.OVERSIGHT_AUTH_TOKEN = 'env-token'
      expect(getActiveToken()).toBe('env-token')
    })

    it('reflects a value set via setActiveToken', () => {
      setActiveToken('explicit')
      expect(getActiveToken()).toBe('explicit')
    })
  })
})
