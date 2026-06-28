import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// lib/ → server/data/.auth-token (gitignored runtime secret).
const DEFAULT_TOKEN_PATH = path.resolve(__dirname, '../data/.auth-token')

// The token authMiddleware enforces. Stays null until start() loads it, so a
// test that builds the app without booting leaves auth a no-op — the same
// opt-in contract as apiKeyAuth (see middleware/security.js).
let activeToken = null

// 32 random bytes as hex (64 chars).
export function generateToken() {
  return randomBytes(32).toString('hex')
}

// Load the local auth token, generating + persisting one on first run. Reading
// an existing file never regenerates (the token is stable across restarts).
// OVERSIGHT_AUTH_TOKEN overrides the file entirely (scripted setups) and writes
// nothing to disk. Sets the module-level active token as a side effect.
export function loadOrCreateToken({ tokenPath = DEFAULT_TOKEN_PATH } = {}) {
  const override = process.env.OVERSIGHT_AUTH_TOKEN
  if (override) {
    activeToken = override
    return override
  }

  let token
  if (existsSync(tokenPath)) {
    token = readFileSync(tokenPath, 'utf8').trim()
  }
  if (!token) {
    token = generateToken()
    mkdirSync(path.dirname(tokenPath), { recursive: true })
    writeFileSync(tokenPath, token, { mode: 0o600 })
  }
  activeToken = token
  return token
}

// The token the auth middleware compares against. OVERSIGHT_AUTH_TOKEN wins so
// the override works even if loadOrCreateToken was never called. Returns null
// when nothing is configured → auth is a no-op.
export function getActiveToken() {
  return process.env.OVERSIGHT_AUTH_TOKEN || activeToken
}

// Test seam: set or clear the active token directly.
export function setActiveToken(token) {
  activeToken = token
}
