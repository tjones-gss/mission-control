import fs from 'fs'
import path from 'path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { getSessionCwds } from './conductor.js'

// Absolute path to the python harness CLI. Resolved relative to this module so
// it stays correct regardless of the process working directory:
// apps/cockpit/server/parsers/ → packages/harness/tools/harness
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HARNESS_CLI_PATH = path.resolve(__dirname, '../../../../packages/harness/tools/harness')

// Spawning the python CLI is expensive (process startup + YAML parse). The
// watcher can fire many change events in quick succession, so we cache the
// per-project result for a short TTL to avoid spawn storms. Keyed by
// projectPath → { value, ts }.
//
// The TTL must be >= the spawn timeout + a buffer so that a warm cache reliably
// outlives an in-flight spawn — otherwise a slow/hung process could expire from
// the cache before it resolves and a second concurrent spawn would fire.
const STATUS_TIMEOUT_MS = 6_000
const STATUS_CACHE_TTL_MS = STATUS_TIMEOUT_MS + 4_000
const statusCache = new Map()

function existsAsFile(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// Known harness roots are session cwds that contain a .harness/project-state.yml
// file. Tolerant: any scan failure yields [] rather than throwing. This doubles
// as the path-whitelist for the detail route — we never shell out to a path that
// isn't a member of this set.
export function getKnownHarnessRoots() {
  let cwds = []
  try {
    cwds = getSessionCwds()
  } catch {
    return []
  }
  return cwds.filter((cwd) => existsAsFile(path.join(cwd, '.harness', 'project-state.yml')))
}

// Run the harness CLI under one interpreter and resolve with its parsed JSON
// status, or a reason on any failure. Never throws and never hangs: the async
// spawn is bounded by a timer that hard-kills the child, and every failure mode
// (missing interpreter, missing script, non-zero exit, timeout, bad JSON)
// resolves to { ok:false, reason }. Mirrors probeInterpreter in routes/health.js:
// spawn, collect stdout, a timer that kills the child, resolve on close.
function runHarnessStatus(python, projectPath) {
  return new Promise((resolve) => {
    let settled = false
    let timedOut = false
    const done = (res) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(res)
    }

    let child
    try {
      child = spawn(python, [HARNESS_CLI_PATH, 'status', '--json'], {
        cwd: projectPath,
        windowsHide: true,
      })
    } catch {
      // spawn can throw synchronously (e.g. EACCES) on some platforms.
      resolve({ ok: false, reason: 'spawn failed' })
      return
    }

    // Hard timeout: kill the child and resolve as a timeout so we NEVER hang.
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore — close/error will still fire
      }
    }, STATUS_TIMEOUT_MS)

    let stdout = ''
    if (child.stdout) {
      child.stdout.setEncoding('utf-8')
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
    }
    // Drain stderr so the pipe buffer never fills and blocks the child.
    if (child.stderr) {
      child.stderr.on('data', () => {})
    }

    // 'error' fires when the interpreter itself is missing (ENOENT) or the spawn
    // otherwise fails.
    child.on('error', (err) => {
      if (timedOut) {
        done({ ok: false, reason: 'harness CLI timed out' })
        return
      }
      if (err && err.code === 'ENOENT') {
        done({ ok: false, reason: 'interpreter not found' })
        return
      }
      done({ ok: false, reason: `spawn error: ${(err && err.code) || 'unknown'}` })
    })

    child.on('close', (code) => {
      // A timeout-killed process reports a null exit code (killed by signal).
      // Guard explicitly so it is treated as a timeout, not a generic nonzero
      // exit.
      if (timedOut || code === null) {
        done({ ok: false, reason: 'harness CLI timed out' })
        return
      }
      if (code !== 0) {
        done({ ok: false, reason: `harness CLI exited ${code}` })
        return
      }
      let parsed
      try {
        parsed = JSON.parse(stdout)
      } catch {
        done({ ok: false, reason: 'could not parse harness JSON output' })
        return
      }
      if (!parsed || typeof parsed !== 'object') {
        done({ ok: false, reason: 'harness JSON output was not an object' })
        return
      }
      done({ ok: true, status: parsed })
    })
  })
}

// Read 'harness status --json' for a single project. Tries interpreter 'python'
// then 'python3' (mirrors routes/health.js). NEVER throws/hangs — on any failure
// resolves to { available:false, error:<human reason> }. On success resolves to
// { available:true, status:<parsed json> }. Cached per projectPath (TTL >= the
// spawn timeout so a warm cache reliably prevents a second concurrent spawn).
export async function readHarnessStatus(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) {
    return { available: false, error: 'invalid project path' }
  }

  const now = Date.now()
  const cached = statusCache.get(projectPath)
  if (cached && now - cached.ts < STATUS_CACHE_TTL_MS) {
    return cached.value
  }

  let value = {
    available: false,
    error:
      'harness unavailable: could not run the python CLI (python/python3 not found or harness script missing)',
  }
  let lastReason = null
  for (const python of ['python', 'python3']) {
    // eslint-disable-next-line no-await-in-loop
    const res = await runHarnessStatus(python, projectPath)
    if (res.ok) {
      value = { available: true, status: res.status }
      break
    }
    lastReason = res.reason
    // If the interpreter itself is missing, try the next candidate. For any
    // other failure (CLI error, timeout, bad JSON) the interpreter worked, so
    // surface that reason directly rather than masking it behind "interpreter
    // missing".
    if (res.reason !== 'interpreter not found') {
      value = { available: false, error: res.reason }
      break
    }
  }
  if (!value.available && lastReason === 'interpreter not found') {
    value = {
      available: false,
      error: 'harness unavailable: python/python3 not found or harness script missing',
    }
  }

  statusCache.set(projectPath, { value, ts: now })
  return value
}

// Pull a nested value safely. obj?.a?.b without optional-chaining noise at the
// call sites below.
function get(obj, ...keys) {
  let cur = obj
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = cur[k]
  }
  return cur
}

function asStringOrNull(v) {
  return typeof v === 'string' ? v : null
}

function asNumberOrNull(v) {
  return typeof v === 'number' ? v : null
}

function asBoolOrNull(v) {
  return typeof v === 'boolean' ? v : null
}

// Shape a parsed harness status (or a failure) into the ProjectSummary contract.
function shapeSummary(projectPath, result) {
  const projectKey = encodeURIComponent(projectPath)
  const projectLabel = path.basename(projectPath)

  if (!result.available) {
    return {
      projectPath,
      projectKey,
      projectLabel,
      available: false,
      mode: null,
      pipeline: null,
      currentMission: null,
      blocked: false,
      blocker: null,
      next: null,
      readiness: null,
      error: result.error || 'harness unavailable',
    }
  }

  const status = result.status
  const pipelineActive = get(status, 'pipeline', 'active')
  const pipelinePhase = get(status, 'pipeline', 'phase')
  const pipelineGate = get(status, 'pipeline', 'gate')
  const hasPipeline =
    pipelineActive !== undefined || pipelinePhase !== undefined || pipelineGate !== undefined

  const nextAgent = get(status, 'next', 'recommended_agent')
  const nextAction = get(status, 'next', 'recommended_action')
  const hasNext = nextAgent !== undefined || nextAction !== undefined

  // The harness CLI emits the readiness block under the top-level key
  // `readiness_overall` (see packages/harness/tools/harness cmd_status and
  // packages/contracts/schemas/harness-status.schema.json). Read that exact key.
  const score = get(status, 'readiness_overall', 'score')
  const mvpReady = get(status, 'readiness_overall', 'mvp_ready')
  const hasReadiness = score !== undefined || mvpReady !== undefined

  return {
    projectPath,
    projectKey,
    projectLabel,
    available: true,
    mode: asStringOrNull(get(status, 'project', 'mode')),
    pipeline: hasPipeline
      ? {
          active: asStringOrNull(pipelineActive),
          phase: asStringOrNull(pipelinePhase),
          gate: asStringOrNull(pipelineGate),
        }
      : null,
    currentMission: asStringOrNull(get(status, 'current', 'mission')),
    blocked: asBoolOrNull(get(status, 'next', 'blocked')) ?? false,
    blocker: asStringOrNull(get(status, 'next', 'blocker')),
    next: hasNext
      ? {
          recommended_agent: asStringOrNull(nextAgent),
          recommended_action: asStringOrNull(nextAction),
        }
      : null,
    readiness: hasReadiness
      ? {
          score: asNumberOrNull(score),
          mvp_ready: asBoolOrNull(mvpReady),
        }
      : null,
    error: null,
  }
}

// Map every known harness root through readHarnessStatus and shape into the
// ProjectSummary contract. Roots are resolved concurrently. Null-safe and never
// throws.
export async function getHarnessProjects() {
  const roots = getKnownHarnessRoots()
  return Promise.all(
    roots.map(async (projectPath) =>
      shapeSummary(projectPath, await readHarnessStatus(projectPath)),
    ),
  )
}

// Detail shape for one project: the full parsed status plus projectPath/label.
// MUST verify projectPath is a member of getKnownHarnessRoots() before spawning;
// returns null if not (the route turns that into a 404). When the CLI is
// reachable but errors, returns an object carrying { available:false, error }.
export async function getHarnessProjectByPath(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath) return null
  // Whitelist membership check BEFORE any spawn — unchanged security behavior.
  const knownRoots = new Set(getKnownHarnessRoots())
  if (!knownRoots.has(projectPath)) return null

  const result = await readHarnessStatus(projectPath)
  const projectLabel = path.basename(projectPath)

  if (!result.available) {
    return {
      projectPath,
      projectLabel,
      available: false,
      error: result.error || 'harness unavailable',
    }
  }

  // Spread the full 'harness status --json' object, plus projectPath/label.
  return {
    ...result.status,
    projectPath,
    projectLabel,
  }
}
