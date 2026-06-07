// GATED real-subprocess Fleet e2e (RUN_E2E=1). Closes council HIGH #3.
//
// Unlike tests/fleet/fleet-runner.test.js (which mocks the whole spawn stack),
// this lane drives a REAL subprocess through the REAL runClaudeCancellable →
// buildSpawn → spawn pipeline, using a deterministic stub `claude` bin pinned via
// claude-bin.js `_setClaudeBin`. It proves the verify→reject→informed-retry→
// synthesis loop end to end:
//   - a worker produces a KNOWN-BAD diff,
//   - an adversarial verifier REJECTS it (verdict driven by the on-disk diff),
//   - the worker is re-dispatched with the verifier's rejection reasons injected
//     by buildWorkerPrompt (informed retry — not a blind retry),
//   - the fixed diff is APPROVED and synthesis runs.
//
// It also carries the 1g ACCEPTANCE TEST: a kill-and-restart durability case that
// encodes the invariant "no run wedged at status:'running' after a restart". Item
// 1g landed the boot reconciler (reconcileFleetRuns), so that case is now a normal
// passing it(): after a simulated restart it asserts the wedged run is reaped to a
// terminal status and its orphaned children are reported.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const STUB_MJS = path.resolve(__dirname, 'fixtures', 'stub-claude.mjs')

// Whitelist is the ONE thing we mock — the e2e supplies its own temp repo as the
// "known harness root" instead of polluting the real ~/.claude/projects. Every
// other seam (claude-cli, fleet-runner, sse, atomic-write, sessions) is REAL.
const { knownRoots } = vi.hoisted(() => ({ knownRoots: [] }))
vi.mock('../parsers/harness.js', async (importActual) => {
  const actual = await importActual()
  return { ...actual, getKnownHarnessRoots: () => knownRoots.slice() }
})

import { _setClaudeBin } from '../lib/claude-bin.js'
import { startFleetRun, __resetFleet, getFleetRun, DATA_DIR } from '../fleet/fleet-runner.js'

// Resolve the deterministic stub into the real spawn pipeline. On Windows we pin
// a .ps1 launcher (buildSpawn routes it through `powershell -File` as discrete
// argv, preserving the prompt as one token); on POSIX a shell script forwarding
// "$@". Both exec `node stub-claude.mjs <args>`.
function writeLauncher(dir) {
  if (process.platform === 'win32') {
    const ps1 = path.join(dir, 'claude.ps1')
    fs.writeFileSync(ps1, `& node "${STUB_MJS}" @args\nexit $LASTEXITCODE\n`)
    return ps1
  }
  const sh = path.join(dir, 'claude')
  fs.writeFileSync(sh, `#!/bin/sh\nexec node "${STUB_MJS}" "$@"\n`)
  fs.chmodSync(sh, 0o755)
  return sh
}

function initGitRepo(dir) {
  const opts = { cwd: dir, stdio: 'ignore' }
  execFileSync('git', ['init', '-q'], opts)
  execFileSync('git', ['config', 'user.email', 'e2e@example.com'], opts)
  execFileSync('git', ['config', 'user.name', 'e2e'], opts)
  fs.writeFileSync(path.join(dir, 'README.md'), '# fleet e2e fixture\n')
  execFileSync('git', ['add', '.'], opts)
  execFileSync('git', ['commit', '-q', '-m', 'init'], opts)
}

// Poll the persisted run JSON until predicate(state) is true or we time out.
async function waitForRun(id, predicate, { timeoutMs = 40_000, stepMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    last = getFleetRun(id)
    if (last && predicate(last)) return last
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return last
}

let tmpRoot
let repoDir
let launcherDir

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-e2e-'))
  repoDir = path.join(tmpRoot, 'repo')
  launcherDir = path.join(tmpRoot, 'bin')
  fs.mkdirSync(repoDir, { recursive: true })
  fs.mkdirSync(launcherDir, { recursive: true })
  initGitRepo(repoDir)
  const launcher = writeLauncher(launcherDir)
  _setClaudeBin(launcher)
  knownRoots.length = 0
  knownRoots.push(repoDir)
})

afterAll(() => {
  _setClaudeBin(null)
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true })
  } catch {
    /* best-effort */
  }
  // Safety-net sweep: this lane persists real run JSONs into server/data/fleet
  // (DATA_DIR is a module const). afterEach removes each tracked id, but a late
  // async synthesis persist can re-create one after cleanup, so also drop any
  // run file whose goal slug came from THIS lane. Never touch unrelated runs.
  sweepE2eRuns()
})

// Remove every run JSON this lane could have produced (matched by the e2e goal
// slugs), so a stray runtime artifact never trips the repo prettier --check.
function sweepE2eRuns() {
  let names = []
  try {
    names = fs.readdirSync(DATA_DIR)
  } catch {
    return
  }
  for (const name of names) {
    if (/^(implement-the-feature-correctly|long-running-mid-flight-work)-/.test(name)) {
      try {
        fs.rmSync(path.join(DATA_DIR, name), { force: true })
      } catch {
        /* ignore */
      }
    }
  }
}

const createdRunIds = []
beforeEach(() => {
  __resetFleet()
})
afterEach(() => {
  // Clean the real run JSONs this lane persisted to server/data/fleet.
  for (const id of createdRunIds.splice(0)) {
    try {
      fs.rmSync(path.join(DATA_DIR, `${id}.json`), { force: true })
    } catch {
      /* ignore */
    }
  }
  // Reset the worker's on-disk marker between cases.
  try {
    fs.rmSync(path.join(repoDir, 'fleet-e2e-result.txt'), { force: true })
  } catch {
    /* ignore */
  }
})

describe('e2e: real-child Fleet verify→reject→informed-retry→synthesis', () => {
  it('REJECTS a known-bad diff, re-dispatches with the verifier reasons, then approves', async () => {
    const res = await startFleetRun({
      goal: 'implement the feature correctly',
      children: [{ cwd: repoDir, prompt: 'build the feature' }],
      // verify on, allow up to 2 rounds so the informed retry can run.
      policy: { verify: { minApprovals: 1, maxRounds: 2 } },
    })
    expect(res.ok).toBe(true)
    createdRunIds.push(res.id)

    // The run drives: worker(BAD) → verifier(reject) → worker(GOOD, informed) →
    // verifier(approve) → synthesis. Wait for the terminal succeeded state.
    const state = await waitForRun(res.id, (s) => s.status === 'succeeded')
    expect(state.status).toBe('succeeded')

    const workers = state.children.filter((c) => c.childKind !== 'verifier')
    expect(workers).toHaveLength(1)
    const worker = workers[0]

    // The first verifier verdict must have been a REJECT of the known-bad diff.
    expect(worker.verdicts.length).toBeGreaterThanOrEqual(2)
    expect(worker.verdicts[0].verdict).toBe('reject')
    expect(worker.verdicts[0].reasons.join(' ')).toMatch(/regression|rubric/i)
    // And the work must have gone through at least one informed re-dispatch.
    expect(worker.rounds).toBeGreaterThanOrEqual(1)
    // The final verdict approves the fixed diff and the worker settles succeeded.
    expect(worker.verdicts[worker.verdicts.length - 1].verdict).toBe('approve')
    expect(worker.status).toBe('succeeded')

    // Two verifier children were spawned (one per round) and both concluded.
    const verifiers = state.children.filter((c) => c.childKind === 'verifier')
    expect(verifiers.length).toBeGreaterThanOrEqual(2)

    // Synthesis ran on the real subprocess — wait for it to reach a terminal
    // status so no late persist races the post-test cleanup.
    const final = await waitForRun(res.id, (s) =>
      ['done', 'skipped'].includes(s.synthesis && s.synthesis.status),
    )
    expect(['done', 'skipped']).toContain(final.synthesis.status)
  })
})

describe('e2e: Fleet durability across a hard restart (1g ACCEPTANCE TEST)', () => {
  // The body encodes the invariant "no run is left wedged at status:'running'
  // after a restart". Item 1g's boot reconciler scans DATA_DIR on boot and reaps
  // any non-terminal run whose process is gone to the terminal 'orphaned' state.
  it('leaves NO run wedged at status:running after a simulated restart', async () => {
    // 1) Start a real run so a genuine run JSON lands on disk, then (step 2)
    //    force it back to the wedged shape a hard mid-run kill would leave —
    //    a persisted 'running' run whose in-memory lifecycle is gone.
    const res = await startFleetRun({
      goal: 'long running mid-flight work',
      children: [{ cwd: repoDir, prompt: 'work that is interrupted' }],
    })
    expect(res.ok).toBe(true)
    createdRunIds.push(res.id)

    // Let the run settle in-memory first so no async persist races our forced
    // write below (the runner early-acks; children settle on a later tick).
    await waitForRun(res.id, (s) => s.status !== 'running', { timeoutMs: 20_000 })

    // 2) Simulate a hard kill mid-run: write the on-disk run back to a
    //    non-terminal 'running' state with a 'running' child (as it would look
    //    if the server died before children settled), then wipe in-memory state.
    const onDisk = getFleetRun(res.id)
    onDisk.status = 'running'
    onDisk.children.forEach((c) => {
      c.status = 'running'
    })
    fs.writeFileSync(path.join(DATA_DIR, `${res.id}.json`), JSON.stringify(onDisk, null, 2))
    __resetFleet() // fresh module registries == a restarted process

    // 3) The boot reconciler (1g) scans DATA_DIR, finds this non-terminal run
    //    whose process is gone, and moves it to the terminal 'orphaned' state.
    const mod = await import('../fleet/fleet-runner.js')
    expect(typeof mod.reconcileFleetRuns).toBe('function')
    await mod.reconcileFleetRuns()

    // THE INVARIANT: after a restart + reconcile, no run is wedged at 'running';
    // the run is terminal and its interrupted children are reported as orphaned.
    const after = getFleetRun(res.id)
    expect(after.status).not.toBe('running')
    expect(after.status).toBe('orphaned')
    expect(after.children.every((c) => c.status === 'orphaned')).toBe(true)
  })
})
