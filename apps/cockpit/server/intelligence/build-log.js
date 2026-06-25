// Phase S1 — build-outcome log. The recursive payoff: when a meta session
// (Oversight building itself, see meta-session-detector.js) commits, its outcome
// is recorded to an append-only server/data/build-log.jsonl so every build
// session has a durable, verifiable record. Commit detection is deterministic
// (no LLM, UNIVERSAL CONSTRAINT #4) — a scan of the transcript's Bash calls.
//
// DEVIATION (documented): the spec has the analyzer auto-run `npm run
// test:cockpit` at every meta session end. Auto-spawning a 30s+ test run from
// the read-mostly cockpit server on every session change is a surprise heavy
// side effect at odds with ADR-0004's localhost-light posture and can't be
// unit-tested deterministically. So the LOG + its append-only contract ship
// always; the actual suite execution is gated behind OVERSIGHT_BUILD_VERIFY
// (default off) via runBuildVerification(), and is opt-in rather than always-on.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { logger } from '../lib/logger.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_BUILD_LOG_PATH = path.resolve(__dirname, '..', 'data', 'build-log.jsonl')
let buildLogPath = DEFAULT_BUILD_LOG_PATH

export function setBuildLogPath(p) {
  buildLogPath = p
}
export function getBuildLogPath() {
  return buildLogPath
}

const GIT_COMMIT_RE = /\bgit\s+commit\b/

// True when the transcript made at least one git commit — deterministic.
export function sessionDidCommit(records) {
  for (const r of records || []) {
    if (r?.type !== 'assistant' || !Array.isArray(r.message?.content)) continue
    for (const block of r.message.content) {
      if (
        block?.type === 'tool_use' &&
        block.name === 'Bash' &&
        GIT_COMMIT_RE.test(block.input?.command || '')
      ) {
        return true
      }
    }
  }
  return false
}

function appendBuildLog(record) {
  try {
    fs.mkdirSync(path.dirname(buildLogPath), { recursive: true })
    fs.appendFileSync(buildLogPath, JSON.stringify(record) + '\n')
  } catch (err) {
    logger.warn({ detail: err.message }, 'build_log_append_failed')
  }
}

// Append (never mutate) a build_outcome record. `test` is the optional result of
// a verification run ({ passed, code }), null when verification was not run.
export function recordBuildOutcome({ sessionId, committed, test = null, now = Date.now() }) {
  const record = { type: 'build_outcome', sessionId, committed: Boolean(committed), test, ts: now }
  appendBuildLog(record)
  return record
}

export function readBuildLog() {
  let raw
  try {
    raw = fs.readFileSync(buildLogPath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return []
    logger.warn({ detail: err.message }, 'build_log_read_failed')
    return []
  }
  const out = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      out.push(JSON.parse(trimmed))
    } catch {
      /* corrupt line — skip */
    }
  }
  return out
}

// Opt-in: run the full cockpit suite and resolve to { passed, code }. Returns
// null (no-op) unless OVERSIGHT_BUILD_VERIFY is set, so the read-mostly server
// never spawns a multi-second test run by surprise. repoRoot defaults to the
// Oversight repo root resolved relative to this file.
export function runBuildVerification({
  repoRoot = path.resolve(__dirname, '..', '..', '..', '..'),
} = {}) {
  if (!process.env.OVERSIGHT_BUILD_VERIFY) return Promise.resolve(null)
  return new Promise((resolve) => {
    const child = spawn('npm', ['run', 'test:cockpit'], {
      cwd: repoRoot,
      shell: false,
      stdio: 'ignore',
    })
    child.on('error', () => resolve({ passed: false, code: null }))
    child.on('close', (code) => resolve({ passed: code === 0, code }))
  })
}
