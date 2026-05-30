import { Router } from 'express'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const router = Router()
const startTime = Date.now()
let ready = false

export function setHealthReady() {
  ready = true
}

// Absolute path to the python harness CLI. Resolved relative to this module so
// it stays correct regardless of the process working directory:
// apps/cockpit/server/routes/ → packages/harness/tools/harness
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HARNESS_CLI_PATH = path.resolve(
  __dirname,
  '../../../../packages/harness/tools/harness'
)

// Module-level cache so /api/health stays cheap — probing python on every hit
// would add hundreds of ms of process-spawn latency to a route the UI polls.
const PROBE_CACHE_TTL_MS = 30_000
const PROBE_TIMEOUT_MS = 4_000
let harnessCache = null // { value, ts }

// Run a single python interpreter against the harness CLI and resolve with a
// boolean for whether it was reachable. Never throws and never hangs: the spawn
// is given a timeout, and every failure mode (missing interpreter, missing
// script, non-zero exit, timeout) resolves to false rather than rejecting.
function probeInterpreter(python) {
  return new Promise((resolve) => {
    let settled = false
    const done = (ok) => {
      if (settled) return
      settled = true
      resolve(ok)
    }

    let child
    try {
      child = spawn(python, [HARNESS_CLI_PATH, '--help'], {
        timeout: PROBE_TIMEOUT_MS,
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      // spawn can throw synchronously (e.g. EACCES) on some platforms
      done(false)
      return
    }

    // 'error' fires when the interpreter itself is missing (ENOENT) or the
    // spawn was killed by the timeout.
    child.on('error', () => done(false))
    child.on('close', (code) => done(code === 0))
  })
}

// Detect whether the python harness CLI is reachable. Tries "python" then
// "python3"; the first interpreter that exits 0 wins. Result is cached for
// ~30s. Always resolves to a plain object — never rejects.
async function detectHarness() {
  const now = Date.now()
  if (harnessCache && now - harnessCache.ts < PROBE_CACHE_TTL_MS) {
    return harnessCache.value
  }

  let value
  const candidates = ['python', 'python3']
  let worked = null
  for (const python of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await probeInterpreter(python)) {
      worked = python
      break
    }
  }

  if (worked) {
    value = {
      available: true,
      python: worked,
      cliPath: HARNESS_CLI_PATH,
      detail: `harness CLI reachable via ${worked}`,
    }
  } else {
    value = {
      available: false,
      python: null,
      cliPath: HARNESS_CLI_PATH,
      detail:
        'harness unavailable: could not run the python CLI (python/python3 not found or harness script missing)',
    }
  }

  harnessCache = { value, ts: now }
  return value
}

router.get('/', async (req, res) => {
  const harness = await detectHarness()
  res.json({ ok: true, ts: Date.now(), harness })
})

router.get('/live', (req, res) => {
  res.json({ ok: true, uptime: Date.now() - startTime })
})

router.get('/ready', (req, res) => {
  const mem = process.memoryUsage()
  const status = ready ? 200 : 503
  res.status(status).json({
    ok: ready,
    uptime: Date.now() - startTime,
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
    },
  })
})

export { router }
