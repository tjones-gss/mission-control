import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// Persisted set of absolute cwds the operator has EXPLICITLY trusted for
// unattended spawns (i.e. allowed to run with --dangerously-skip-permissions).
// Default-DENY: an unknown cwd, a missing/corrupt store, or any read failure all
// resolve to "not trusted", so the most-permissive spawn mode is never the
// accidental default. Single-operator-localhost per ADR-0004; one small JSON file.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TRUST_FILE = path.resolve(__dirname, '..', 'data', 'trusted-cwds.json')

// Normalize to an absolute, case-folded-on-Windows path so C:\Foo and c:\foo\
// are the same trust entry and a relative cwd can't dodge the check.
function normalize(cwd) {
  if (!cwd || typeof cwd !== 'string') return null
  let p = path.resolve(cwd)
  if (process.platform === 'win32') p = p.toLowerCase()
  return p
}

let cache = null

function load() {
  if (cache) return cache
  cache = new Set()
  try {
    const arr = JSON.parse(fs.readFileSync(TRUST_FILE, 'utf8'))
    if (Array.isArray(arr)) {
      for (const c of arr) {
        const n = normalize(c)
        if (n) cache.add(n)
      }
    }
  } catch {
    // No file yet / unreadable / malformed → nothing is trusted (default-deny).
  }
  return cache
}

function persist(set) {
  fs.mkdirSync(path.dirname(TRUST_FILE), { recursive: true })
  fs.writeFileSync(TRUST_FILE, JSON.stringify([...set], null, 2))
}

export function isCwdTrusted(cwd) {
  const n = normalize(cwd)
  return n ? load().has(n) : false
}

// Grant: a deliberate, persisted, per-cwd act (the "trust this folder" decision).
export function trustCwd(cwd) {
  const n = normalize(cwd)
  if (!n) return false
  const set = load()
  if (!set.has(n)) {
    set.add(n)
    persist(set)
  }
  return true
}

export function untrustCwd(cwd) {
  const n = normalize(cwd)
  if (!n) return false
  const set = load()
  if (set.delete(n)) persist(set)
  return true
}

export function listTrustedCwds() {
  return [...load()]
}

// Test-only: drop the in-memory cache so a test can re-read the store.
export function _resetTrustStore() {
  cache = null
}
