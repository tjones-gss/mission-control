// Fleet meta-orchestrator — lifecycle owner (no Express here).
//
// Fleet is a THIN cockpit layer over the canonical mission-execute pattern in
// routes/harness.js. It does NOT introduce a new spawn / approval / persistence
// stack. For each child it copies the execute handler's spawn-via-
// runClaudeCancellable + race-against-awaitNewSession early-ack pattern, once
// per child. Children ALWAYS spawn with --worktree so each runs in its own git
// worktree/branch and can never clobber another child's (or the user's) tree.
//
// Escalation is read-only: Fleet surfaces live SDK tool-approval requests and
// the harness rails' .harness/approvals/pending files; the human decision is
// routed through the EXISTING write paths (POST /api/sessions/:id/tool-approval
// for source 'tool'; the harness CLI decided-file path for source 'harness').
// Fleet contains NO auto-approve branch.
//
// State is persisted one JSON per run via atomicWriteJson to server/data/fleet/
// <id>.json (mirrors tasks/workflows persistence) and a summary is emitted on
// the SSE `fleet_update` event after each write.

import fs from 'fs'
import { promises as fsp } from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { runClaudeCancellable } from '../claude-cli.js'
import { atomicWriteJson } from '../lib/atomic-write.js'
import { awaitNewSession } from '../lib/pending-session.js'
import { getKnownHarnessRoots, runHarnessApprove } from '../parsers/harness.js'
import { getQueryStatus, resolveApproval } from '../pty-session.js'
import { getSessionById } from '../parsers/sessions.js'
import { emit } from '../sse.js'
import { logger } from '../lib/logger.js'

// Persisted runs live alongside the server (server/data/fleet), resolved
// relative to this module so it stays correct regardless of cwd.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = path.resolve(__dirname, '..', 'data', 'fleet')
// Saved repeatable fleet configs (goal + child set + policy). Same persistence
// primitive as runs (atomicWriteJson), one JSON per template.
export const TEMPLATES_DIR = path.resolve(__dirname, '..', 'data', 'fleet-templates')

// Hard safety ceiling. This spawns N autonomous agents, so an absurd N must be
// refused server-side BEFORE any spawn. policy.maxConcurrency may only LOWER the
// effective cap, never raise it above MAX_FLEET_CHILDREN.
export const MAX_FLEET_CHILDREN = 4
// A second, absolute refusal line: even if the default cap is ever bumped, more
// than this many children is always rejected outright.
export const HARD_REFUSE_CHILDREN = 8

const CHILD_TIMEOUT_MS = 30 * 60 * 1000 // 30 min per child — long autonomous run.
const SYNTH_TIMEOUT_MS = 10 * 60 * 1000
const VERIFIER_TIMEOUT_MS = 10 * 60 * 1000
// The session-ack wait. A child settles on CLI exit independently of this ack
// (the ack only captures sessionId/cost), so a missed ack never wedges a run.
// The gated e2e lane drives a stub bin with no watcher running, so the ack would
// always burn the full timeout as a dangling timer; OVERSIGHT_FLEET_ACK_TIMEOUT_MS
// lets that lane collapse it to a few ms. Unset in production = 15s, unchanged.
const ACK_TIMEOUT_MS = (() => {
  const raw = Number(process.env.OVERSIGHT_FLEET_ACK_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000
})()

// Conservative pre-spawn cost estimate (USD) used when policy.perChildUsd is not
// set but a budget IS. child.cost lags (Claude writes usage after the fact), so
// the projection must use an estimate, never the laggy actual — see risks #3. We
// refuse pessimistically and reconcile spentUsd from actuals on settle.
const DEFAULT_CHILD_ESTIMATE_USD = 0.5

// ──────────────────────────────────────────────────────────────────────────────
// In-memory registries (the server is the single spawner/writer for Fleet)
// ──────────────────────────────────────────────────────────────────────────────

// Per-run acquire key set: a double-submit for the same derived id gets a clean
// 409 and is NOT allowed to spawn a second fleet. Released only when ALL children
// have settled (the run's lifecycle boundary), finally-style so it can't leak.
const inFlight = new Set()
// fleetId -> [cancel, ...] so cancelFleet can kill in-flight children.
const cancels = new Map()
// fleetId -> count of children not yet settled, so we release the key + run
// synthesis exactly once when the last child settles.
const pendingCounts = new Map()
// Child objects whose CLI spawn has actually been committed (passed the budget
// gate and called runClaudeCancellable). Used by projectionWouldExceed to
// RESERVE an estimate for in-flight-but-not-yet-costed children. A WeakSet so it
// never leaks into the persisted state and is GC'd with the run. NOT persisted.
const spawnedChildren = new WeakSet()

function acquire(key) {
  if (inFlight.has(key)) return false
  inFlight.add(key)
  return true
}

function release(key) {
  inFlight.delete(key)
}

// Test-only: clear the in-memory registries between cases (mirrors harness.js
// __resetInFlight). The registries are module-level (the server is a singleton).
export function __resetFleet() {
  inFlight.clear()
  cancels.clear()
  pendingCounts.clear()
}

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// Derive a filesystem-safe slug (copied from harness.js slugify).
function slugify(title) {
  if (typeof title === 'string') {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60)
      .replace(/-+$/g, '')
    if (slug) return slug
  }
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function isKnownHarnessRoot(cwd) {
  let roots
  try {
    roots = getKnownHarnessRoots()
  } catch {
    return false
  }
  return Array.isArray(roots) && roots.includes(cwd)
}

// --worktree against a non-git tree behaves unsafely, so verify a .git entry is
// present (file OR dir — worktrees use a .git file) before we ever spawn.
function isGitRepo(cwd) {
  try {
    fs.statSync(path.join(cwd, '.git'))
    return true
  } catch {
    return false
  }
}

// Derive the effective concurrency cap. policy.maxConcurrency may only lower the
// hard cap, never raise it.
function effectiveCap(policy) {
  const requested =
    policy && typeof policy.maxConcurrency === 'number' ? policy.maxConcurrency : MAX_FLEET_CHILDREN
  if (!(requested > 0)) return MAX_FLEET_CHILDREN
  return Math.min(requested, MAX_FLEET_CHILDREN)
}

// Read the dollar budget off a policy. Enforcement is GATED behind this being a
// positive number — no budget = today's behaviour (count cap only), unchanged.
function budgetOf(policy) {
  return policy && typeof policy.budgetUsd === 'number' && policy.budgetUsd > 0
    ? policy.budgetUsd
    : null
}

// Read the per-child estimate (for the pre-spawn projection). Null when unset.
function perChildOf(policy) {
  return policy && typeof policy.perChildUsd === 'number' && policy.perChildUsd > 0
    ? policy.perChildUsd
    : null
}

// Normalize policy.verify into { minApprovals, maxRounds } or null (off).
// `true` is sugar for { minApprovals:1, maxRounds:1 }. Numbers are floored to
// sane minimums so a misconfigured 0 can't disable the bound.
function normalizeVerify(policy) {
  const v = policy && policy.verify
  if (!v) return null
  if (v === true) return { minApprovals: 1, maxRounds: 1 }
  if (typeof v === 'object') {
    const minApprovals =
      typeof v.minApprovals === 'number' && v.minApprovals >= 1 ? Math.floor(v.minApprovals) : 1
    const maxRounds =
      typeof v.maxRounds === 'number' && v.maxRounds >= 1 ? Math.floor(v.maxRounds) : 1
    return { minApprovals, maxRounds }
  }
  return null
}

// Validate the start request. Returns { ok:true, plan } or { ok:false, status, error }.
// Ordering mirrors harness.js: validate body -> cap -> whitelist -> git-repo
// check. Nothing is spawned until this passes (fail closed, all-or-nothing).
export function validateFleetRequest({ goal, children, policy } = {}) {
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return { ok: false, status: 400, error: 'goal is required' }
  }
  if (!Array.isArray(children) || children.length === 0) {
    return { ok: false, status: 400, error: 'children must be a non-empty array' }
  }
  // Absurd N is refused outright before any per-child work.
  if (children.length > HARD_REFUSE_CHILDREN) {
    return { ok: false, status: 422, error: `too many children (max ${HARD_REFUSE_CHILDREN})` }
  }
  const cap = effectiveCap(policy)
  if (children.length > cap) {
    return { ok: false, status: 422, error: `children exceed concurrency cap (${cap})` }
  }
  // START-TIME BUDGET GUARD (fail closed before any spawn). When BOTH a budget
  // and a perChild estimate are set, the minimum possible cost is one perChild
  // per worker; if that already blows the budget, refuse the whole run with 422.
  const startBudget = budgetOf(policy)
  const startPerChild = perChildOf(policy)
  if (startBudget != null && startPerChild != null) {
    const minPossible = children.length * startPerChild
    if (minPossible > startBudget) {
      return {
        ok: false,
        status: 422,
        error: `minimum projected cost ${minPossible} exceeds budget ${startBudget}`,
      }
    }
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (!child || typeof child !== 'object') {
      return { ok: false, status: 400, error: `child ${i} is not an object` }
    }
    if (!child.cwd || typeof child.cwd !== 'string') {
      return { ok: false, status: 400, error: `child ${i} is missing cwd` }
    }
    const hasPrompt = typeof child.prompt === 'string' && child.prompt.trim()
    const hasWorkflow = typeof child.workflow === 'string' && child.workflow.trim()
    if (!hasPrompt && !hasWorkflow) {
      return { ok: false, status: 400, error: `child ${i} needs a prompt or a workflow` }
    }
  }
  // Whitelist + git-repo precondition on EVERY cwd. Reject the whole run if any
  // child fails (fail closed). Whitelist miss -> 404; non-git -> 404.
  for (let i = 0; i < children.length; i += 1) {
    const cwd = children[i].cwd
    if (!isKnownHarnessRoot(cwd)) {
      return { ok: false, status: 404, error: `child ${i} cwd is not a known root` }
    }
    if (!isGitRepo(cwd)) {
      return { ok: false, status: 404, error: `child ${i} cwd is not a git repo` }
    }
  }
  return { ok: true, cap }
}

// Build the initial persisted state from a validated request.
function buildInitialState({ goal, children, policy }, id, cap) {
  const now = new Date().toISOString()
  const budgetUsd = budgetOf(policy)
  const perChildUsd = perChildOf(policy)
  const verify = normalizeVerify(policy)
  // Persist the resolved policy so the UI and a later restart see exactly what
  // was enforced (cap is always normalized; budget/verify only when set).
  const persistedPolicy = { maxConcurrency: cap }
  if (budgetUsd != null) persistedPolicy.budgetUsd = budgetUsd
  if (perChildUsd != null) persistedPolicy.perChildUsd = perChildUsd
  if (verify) persistedPolicy.verify = verify
  return {
    id,
    goal: goal.trim(),
    createdAt: now,
    updatedAt: now,
    status: 'running',
    policy: persistedPolicy,
    spentUsd: 0,
    budgetRemaining: budgetUsd != null ? budgetUsd : null,
    children: children.map((child, idx) => ({
      idx,
      cwd: child.cwd,
      prompt: typeof child.prompt === 'string' && child.prompt.trim() ? child.prompt : null,
      workflow: typeof child.workflow === 'string' && child.workflow.trim() ? child.workflow : null,
      // childKind defaults 'worker'; verifier children are appended at runtime.
      childKind: 'worker',
      // Quarantine is a best-effort read-only stance (NOT a sandbox) — see
      // spawnChild and the ADR. Advisory prompt directive + harness rails only.
      quarantine: child.quarantine === true,
      sessionId: null,
      worktree: true,
      branch: `fleet/${id}/c${idx}`,
      status: 'starting',
      cost: null,
      escalation: null,
      error: null,
      // Verification bookkeeping (only used when policy.verify is on).
      rounds: 0,
      verdicts: [],
      verifiedBy: null,
    })),
    synthesis: { status: 'pending', sessionId: null, summary: null, completedAt: null },
  }
}

// Populate child.cost from the cockpit's EXISTING session cost representation.
// We reuse parsers/sessions.js getSessionById(...).estimatedCost — the SAME
// { totalCost, breakdown, family } shape every other cockpit surface uses — so
// Fleet never invents a parallel cost model. No-op (leaves cost as-is) when the
// session is unknown or has no derivable cost yet. Returns true if it changed.
function populateChildCost(child) {
  if (!child || !child.sessionId) return false
  let session
  try {
    session = getSessionById(child.sessionId)
  } catch {
    session = null
  }
  const cost = session && session.estimatedCost ? session.estimatedCost : null
  if (!cost) return false
  // Only overwrite when the numbers actually moved, so we don't churn persists.
  const prev = child.cost && typeof child.cost.totalCost === 'number' ? child.cost.totalCost : null
  if (prev === cost.totalCost) return false
  child.cost = cost
  return true
}

// Pure: sum child.cost.totalCost across ALL children that report one (workers +
// verifiers + synthesis-as-child if it were tracked here), defaulting missing /
// null to 0. This is the single running-total definition — Fleet invents no
// parallel cost model; it reads the canonical per-child cost populateChildCost
// already wrote.
export function spentUsd(state) {
  if (!state || !Array.isArray(state.children)) return 0
  let total = 0
  for (const child of state.children) {
    const c =
      child && child.cost && typeof child.cost.totalCost === 'number' ? child.cost.totalCost : 0
    total += c
  }
  // The synthesis child's cost, when captured, also counts toward the budget.
  if (
    state.synthesis &&
    state.synthesis.cost &&
    typeof state.synthesis.cost.totalCost === 'number'
  ) {
    total += state.synthesis.cost.totalCost
  }
  return total
}

// Recompute run.spentUsd and run.budgetRemaining from the canonical per-child
// costs. Called inside persistFleet so every cost movement updates them.
function recomputeBudget(state) {
  state.spentUsd = spentUsd(state)
  const budget = budgetOf(state.policy)
  state.budgetRemaining = budget != null ? Math.max(0, budget - state.spentUsd) : null
}

// Has the run crossed its dollar budget? Gated behind budgetUsd being set; a run
// with no budget never crosses (today's behaviour). Read immediately before EACH
// spawn (the budget latch) — see the budget-race note in the ADR/risks.
function budgetExceeded(state) {
  const budget = budgetOf(state.policy)
  if (budget == null) return false
  return spentUsd(state) >= budget
}

// Would spawning a NEW child (worker / verifier / synthesis) push the projected
// total over budget? Uses the per-child ESTIMATE (perChildUsd or the conservative
// default), never the laggy actual, so we refuse pessimistically — see risks #3.
//
// Because child.cost LAGS (it is null until the session writes usage), counting
// only the settled spentUsd would let an unbounded synchronous fan-out all pass
// the gate before any cost lands. So the projection also RESERVES one estimate
// for each child that HAS ALREADY BEEN COMMITTED (spawned) but has not yet
// reported a cost, plus one estimate for the new child we are about to spawn.
// This makes the initial fan-out honour the budget the way later spawns already
// do. A child is "committed" once spawnChild has set child._spawned (an internal,
// non-persisted marker) — children still queued in the fan-out loop are not.
function projectionWouldExceed(state) {
  const budget = budgetOf(state.policy)
  if (budget == null) return false
  const estimate = perChildOf(state.policy) || DEFAULT_CHILD_ESTIMATE_USD
  let reserved = 0
  for (const c of state.children) {
    const hasCost = c.cost && typeof c.cost.totalCost === 'number'
    if (
      spawnedChildren.has(c) &&
      !hasCost &&
      !['succeeded', 'failed', 'cancelled', 'rejected'].includes(c.status)
    ) {
      reserved += estimate
    }
  }
  return spentUsd(state) + reserved + estimate > budget
}

// Terminal-for-derivation worker statuses. 'rejected' (verifier rejected and
// re-dispatch exhausted) and 'budget_skipped' (never spawned for budget) count
// as settled like 'failed'. A 'verifying' worker (a verifier is still checking
// it) is NOT settled — see risks #6c.
const SETTLED_WORKER_STATUSES = ['succeeded', 'failed', 'cancelled', 'rejected', 'budget_skipped']
// Statuses that count as a failure for partial/failed derivation.
const FAILED_LIKE_STATUSES = ['failed', 'rejected', 'budget_skipped']

// Derive the run-level status from child statuses (pure). Only WORKER children
// participate — verifier children are tracked for pendingCounts/cost but a run's
// outcome is about what the workers produced.
function deriveStatus(state) {
  const kids = state.children.filter((c) => c.childKind !== 'verifier')
  if (kids.some((c) => c.status === 'cancelled') && kids.every((c) => c.status === 'cancelled')) {
    return 'cancelled'
  }
  // A verifier still in flight means the run is not settled.
  const verifierInFlight = state.children.some(
    (c) => c.childKind === 'verifier' && !['succeeded', 'failed', 'cancelled'].includes(c.status),
  )
  const settled = !verifierInFlight && kids.every((c) => SETTLED_WORKER_STATUSES.includes(c.status))
  if (!settled) return 'running'
  const anyFailed = kids.some((c) => FAILED_LIKE_STATUSES.includes(c.status))
  const anyOk = kids.some((c) => c.status === 'succeeded')
  if (anyFailed && anyOk) return 'partial'
  if (anyFailed) return 'failed'
  return 'succeeded'
}

// A small summary for the SSE event (the full state lives on disk / behind GET).
function summarize(state) {
  const workers = state.children.filter((c) => c.childKind !== 'verifier')
  const settled = workers.filter((c) => SETTLED_WORKER_STATUSES.includes(c.status)).length
  const verifying = state.children.filter((c) => c.status === 'verifying').length
  const rejected = state.children.filter((c) => c.status === 'rejected').length
  return {
    id: state.id,
    goal: state.goal,
    status: state.status,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    // childCount stays WORKER count so the left-rail "N children" matches what
    // the user launched; verifiers are an internal review detail.
    childCount: workers.length,
    settledCount: settled,
    verifyingCount: verifying,
    rejectedCount: rejected,
    spentUsd: typeof state.spentUsd === 'number' ? state.spentUsd : 0,
    budgetUsd: budgetOf(state.policy),
    budgetRemaining: state.budgetRemaining != null ? state.budgetRemaining : null,
    synthesis: state.synthesis ? state.synthesis.status : null,
  }
}

// Persist + emit. Mirrors harness.js: write THEN emit a summary on fleet_update.
// Recomputes the running budget (spentUsd / budgetRemaining) right before the
// write so every cost movement is reflected on disk and in the SSE event.
async function persistFleet(state) {
  state.updatedAt = new Date().toISOString()
  recomputeBudget(state)
  await fsp.mkdir(DATA_DIR, { recursive: true })
  await atomicWriteJson(path.join(DATA_DIR, `${state.id}.json`), state)
  emit('fleet_update', summarize(state))
}

// ──────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────────────────────────

// Start a fleet run. Validates (caller normally pre-validates in the route, but
// we re-validate here so the runner is safe to call directly), acquires the
// per-run key, persists the initial state, then spawns each child and returns
// immediately (early-ack the whole run as 'running').
export async function startFleetRun({ goal, children, policy } = {}) {
  const valid = validateFleetRequest({ goal, children, policy })
  if (!valid.ok) return { ok: false, status: valid.status, error: valid.error }

  const id = `${slugify(goal)}-${new Date().toISOString().replace(/[:.]/g, '-')}`
  const lockKey = `fleet:${id}`
  if (!acquire(lockKey)) {
    return { ok: false, status: 409, error: 'in_progress' }
  }

  const state = buildInitialState({ goal, children, policy }, id, valid.cap)
  cancels.set(id, [])
  pendingCounts.set(id, state.children.length)

  try {
    await persistFleet(state)
  } catch (err) {
    // Could not even write the initial state — release the key and fail closed.
    release(lockKey)
    cancels.delete(id)
    pendingCounts.delete(id)
    logger.warn({ detail: err.message, id }, 'fleet_persist_initial_failed')
    return { ok: false, status: 502, error: err.message }
  }

  // Spawn each child. spawnChild never throws synchronously to the caller — a
  // synchronous spawn failure (or a budget refusal) is recorded on the child and
  // counts as settled. The PRE-SPAWN BUDGET PROJECTION is applied per child here:
  // if launching it would push the projected total over budget, we do NOT spawn
  // it — mark it 'budget_skipped' and settle it without launching anything.
  for (const child of state.children) {
    if (projectionWouldExceed(state)) {
      child.status = 'budget_skipped'
      child.error = 'budget'
      persistFleet(state).catch(() => {})
      settleChild(state, lockKey)
      continue
    }
    spawnChild(state, child.idx, lockKey)
  }

  return {
    ok: true,
    status: 202,
    id,
    runStatus: 'running',
    children: state.children.map((c) => ({ idx: c.idx, cwd: c.cwd, status: 'starting' })),
  }
}

// The advisory quarantine directive. QUARANTINE IS NOT A SANDBOX — this is a
// best-effort, accident-prevention prompt directive (Layer 1). A determined or
// confused model can ignore it, which is exactly why we do not call it a
// boundary. Where the child's cwd is a harness root, the existing PreToolUse
// danger-zone hooks (Layer 2) provide the real, enforced control; for projects
// without rails only this advisory directive applies. The genuine control for an
// untrusted child is OS-level sandboxing, which is the user's responsibility —
// the same framing the README uses for the rails generally.
const QUARANTINE_DIRECTIVE =
  'QUARANTINE MODE: You are read-only. Do not modify files, run git ' +
  'write/commit/push, install packages, or execute any privileged/destructive ' +
  'command. Investigate and report only. If a task requires a write, STOP and ' +
  'report it instead.\n\n'

// Build the prompt for a worker child, prepending the quarantine directive when
// the child is quarantined, and appending prior-round rejection reasons on a
// re-dispatch so the worker addresses them (loop-until-done, bounded).
function buildWorkerPrompt(child) {
  let prompt = child.workflow ? `/workflow ${child.workflow}` : child.prompt
  if (child.quarantine) prompt = QUARANTINE_DIRECTIVE + prompt
  // On a re-dispatch, surface the last reviewer's reasons so the worker fixes
  // them rather than redoing the same work.
  if (child.rounds > 0 && Array.isArray(child.verdicts) && child.verdicts.length) {
    const last = child.verdicts[child.verdicts.length - 1]
    const reasons =
      Array.isArray(last.reasons) && last.reasons.length
        ? last.reasons.join('; ')
        : 'no specific reasons given'
    prompt = `A prior reviewer rejected this work for: ${reasons}. Address them.\n\n${prompt}`
  }
  return prompt
}

// Spawn one WORKER child via runClaudeCancellable WITH --worktree, racing the
// watcher ack against CLI completion EXACTLY like the execute handler. Records
// the cancel fn so cancelFleet can kill it. On settle (success/error/cancel)
// either kicks off verification (verify on + budget clear) or decrements the
// pending count; the last child to settle releases the run key and runs
// synthesis.
function spawnChild(state, idx, lockKey) {
  const child = state.children[idx]
  const childPrompt = buildWorkerPrompt(child)
  const args = [
    '-p',
    childPrompt,
    '--output-format',
    'stream-json',
    '--name',
    `${state.id}-c${idx}`,
    '--worktree',
  ]

  let cliPromise
  let cancel
  try {
    ;({ promise: cliPromise, cancel } = runClaudeCancellable({
      args,
      cwd: child.cwd,
      timeoutMs: CHILD_TIMEOUT_MS,
    }))
  } catch (err) {
    // Synchronous spawn failure — record on the child and settle it.
    child.status = 'failed'
    child.error = err.message
    logger.warn({ detail: err.message, id: state.id, idx }, 'fleet_child_spawn_failed')
    persistFleet(state).catch(() => {})
    settleChild(state, lockKey)
    return
  }

  spawnedChildren.add(child)
  const list = cancels.get(state.id)
  if (list) list.push(cancel)

  // Convert the CLI promise to an always-resolving tagged promise so Node never
  // sees an unhandledRejection if a child fails after the run was early-acked.
  const taggedCli = cliPromise.then(
    (v) => ({ _tag: 'cli', value: v }),
    (err) => ({ _tag: 'cli_err', error: err }),
  )
  const taggedAck = awaitNewSession(child.cwd, { timeoutMs: ACK_TIMEOUT_MS })
    .then((sessionId) => ({ _tag: 'ack', sessionId }))
    .catch((err) => ({ _tag: 'timeout', error: err }))

  // On ack: record sessionId + running, persist + emit. The watcher may resolve
  // before OR after the CLI; we attach to the ack independently so the sessionId
  // is captured even on a fast-exiting child.
  taggedAck.then((a) => {
    if (a._tag !== 'ack') return
    if (!child.sessionId) child.sessionId = a.sessionId
    // Only a child still 'starting' transitions to running — never reopen a
    // child the CLI already settled.
    if (child.status === 'starting') child.status = 'running'
    populateChildCost(child)
    persistFleet(state).catch(() => {})
  })

  // On CLI settle: terminal status for the child, then either verify or settle.
  taggedCli.then((t) => {
    let succeeded = false
    if (child.status === 'cancelled') {
      // cancelFleet already marked it; honour that terminal state.
    } else if (t._tag === 'cli_err') {
      child.status = 'failed'
      child.error = t.error.message
      logger.warn({ detail: t.error.message, id: state.id, idx }, 'fleet_child_failed')
    } else {
      succeeded = true
      // Hold off marking final 'succeeded' if verification is going to run, so
      // the run is not derived as settled while a verifier is still in flight.
      child.status = 'succeeded'
    }
    populateChildCost(child)

    // VERIFICATION HOOK: a WORKER that just succeeded, when verify is on and the
    // budget latch is clear, does NOT count as a final settle yet — it flips to
    // 'verifying' and a verifier child is spawned through the same seam. The
    // worker's pending slot stays held (we do NOT settle it here); it settles
    // only once verification concludes (approve → succeeded, or rounds exhausted
    // → rejected). maybeStartVerification returns true when it took ownership.
    if (
      succeeded &&
      child.childKind !== 'verifier' &&
      maybeStartVerification(state, child, lockKey)
    ) {
      // verification owns the lifecycle of this worker's pending slot now.
      persistFleet(state).catch(() => {})
      return
    }

    persistFleet(state)
      .catch(() => {})
      .finally(() => settleChild(state, lockKey))
  })
}

// Decide whether a just-succeeded worker should enter verification, and if so
// flip it to 'verifying' and spawn the verifier. Returns true when verification
// was started (the caller must NOT settle the worker — verification will), false
// when the worker should settle normally (verify off, or budget latched).
function maybeStartVerification(state, worker, lockKey) {
  const verify = normalizeVerify(state.policy)
  if (!verify) return false
  // BUDGET LATCH: if the running total already crossed budget, stop the line —
  // do NOT spawn a verifier (or anything else). The worker keeps its 'succeeded'
  // status (un-verified) and settles normally; onAllChildrenSettled will set the
  // run to 'budget_exceeded'.
  if (budgetExceeded(state)) return false
  // PRE-SPAWN PROJECTION for the verifier child itself.
  if (projectionWouldExceed(state)) return false

  worker.status = 'verifying'
  spawnVerifier(state, worker, lockKey)
  return true
}

// Spawn an adversarial VERIFIER child for a worker. The verifier runs in a fresh
// session in the SAME cwd as the worker (so it can `git diff` the worker's
// branch) and is BLIND to authorship — its prompt never says who produced the
// work. It is tracked in pendingCounts as additional pending work so synthesis
// still waits for everything. On settle it parses the verdict and routes to
// approve / reject handling.
function spawnVerifier(state, worker, lockKey) {
  // The verifier is a new child appended to state.children, tracked in
  // pendingCounts so the run is not derived as settled until it concludes.
  const verifierIdx = state.children.length
  const verifier = {
    idx: verifierIdx,
    childKind: 'verifier',
    cwd: worker.cwd,
    // The worker this verifier reviews (internal link; not shown to the verifier).
    verifierFor: worker.idx,
    prompt: null,
    workflow: null,
    quarantine: true, // a reviewer must not modify code — read-only stance.
    sessionId: null,
    worktree: true,
    branch: `fleet/${state.id}/c${worker.idx}-v${worker.rounds}`,
    status: 'starting',
    cost: null,
    escalation: null,
    error: null,
  }
  state.children.push(verifier)
  bumpPending(state, 1)

  const rubric =
    'Does the work fully satisfy the goal? Is it correct, complete, and free of ' +
    'obvious bugs or regressions? Does it avoid out-of-scope or destructive changes?'
  // BLIND, adversarial prompt — no childKind, no authorship, no "the worker".
  const prompt =
    QUARANTINE_DIRECTIVE +
    'You are an adversarial reviewer. Independently verify whether the work on ' +
    `branch ${worker.branch} satisfies this goal: "${state.goal}". Check the git ` +
    `diff and output against this rubric: ${rubric} You do NOT know who produced ` +
    'this work and must not assume it is correct. Return ONLY a JSON object: ' +
    '{"verdict":"approve"|"reject","reasons":[...],"rubricScores":{...}}. Do not modify code.'

  const args = [
    '-p',
    prompt,
    '--output-format',
    'stream-json',
    '--name',
    `${state.id}-c${worker.idx}-v${worker.rounds}`,
    '--worktree',
  ]

  let cliPromise
  let cancel
  try {
    ;({ promise: cliPromise, cancel } = runClaudeCancellable({
      args,
      cwd: verifier.cwd,
      timeoutMs: VERIFIER_TIMEOUT_MS,
    }))
  } catch (err) {
    // Verifier failed to spawn — fail closed: treat as a reject of this round so
    // a broken verifier can't silently pass work, then route the rejection.
    verifier.status = 'failed'
    verifier.error = err.message
    logger.warn(
      { detail: err.message, id: state.id, idx: verifierIdx },
      'fleet_verifier_spawn_failed',
    )
    persistFleet(state).catch(() => {})
    settleChild(state, lockKey) // settle the verifier's slot
    recordVerdict(
      worker,
      { verdict: 'reject', reasons: ['verifier failed to spawn'], rubricScores: {} },
      null,
    )
    routeVerdict(state, worker, false, lockKey)
    return
  }

  spawnedChildren.add(verifier)
  const list = cancels.get(state.id)
  if (list) list.push(cancel)

  const taggedCli = cliPromise.then(
    (v) => ({ _tag: 'cli', value: v }),
    (err) => ({ _tag: 'cli_err', error: err }),
  )
  awaitNewSession(verifier.cwd, { timeoutMs: ACK_TIMEOUT_MS })
    .then((sessionId) => {
      if (!verifier.sessionId) verifier.sessionId = sessionId
      if (verifier.status === 'starting') verifier.status = 'running'
      populateChildCost(verifier)
      persistFleet(state).catch(() => {})
    })
    .catch(() => {})

  taggedCli.then((t) => {
    let approved = false
    let parsed
    if (verifier.status === 'cancelled') {
      // Cancelled mid-review — settle the verifier slot and leave the worker as
      // it stands (cancelFleet will have marked workers too).
      populateChildCost(verifier)
      persistFleet(state)
        .catch(() => {})
        .finally(() => settleChild(state, lockKey))
      return
    }
    if (t._tag === 'cli_err') {
      // A failed verifier fails closed to reject (still consumes the round).
      verifier.status = 'failed'
      verifier.error = t.error.message
      parsed = {
        verdict: 'reject',
        reasons: [`verifier error: ${t.error.message}`],
        rubricScores: {},
      }
    } else {
      verifier.status = 'succeeded'
      const resultText = extractResult(t.value && t.value.stdout)
      parsed = parseVerdict(resultText)
      approved = parsed.verdict === 'approve'
    }
    populateChildCost(verifier)
    recordVerdict(worker, parsed, verifier.sessionId)

    // Settle the VERIFIER's own pending slot first (it is terminal), then route
    // the verdict for the worker (which may re-dispatch the worker — re-adding a
    // pending slot — or settle the worker).
    persistFleet(state)
      .catch(() => {})
      .finally(() => {
        settleChild(state, lockKey)
        routeVerdict(state, worker, approved, lockKey)
      })
  })
}

// Append one verdict to a worker's history. Each round records exactly one.
function recordVerdict(worker, parsed, verifierSessionId) {
  if (!Array.isArray(worker.verdicts)) worker.verdicts = []
  worker.verdicts.push({
    round: worker.rounds,
    verifierSessionId: verifierSessionId || null,
    verdict: parsed.verdict,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
    rubricScores:
      parsed.rubricScores && typeof parsed.rubricScores === 'object' ? parsed.rubricScores : {},
    at: new Date().toISOString(),
  })
}

// Route a verifier verdict for a worker. APPROVE (and enough approvals) → worker
// final 'succeeded', settle its slot. APPROVE but minApprovals>1 not yet met →
// spawn another independent verifier. REJECT → re-dispatch the worker if rounds
// remain and budget is clear (loop-until-done, BOUNDED by maxRounds); else the
// worker is terminal 'rejected' and its slot settles.
function routeVerdict(state, worker, approved, lockKey) {
  const verify = normalizeVerify(state.policy) || { minApprovals: 1, maxRounds: 1 }

  if (approved) {
    const approvals = (worker.verdicts || []).filter((v) => v.verdict === 'approve').length
    worker.verifiedBy = lastVerifierSession(worker)
    if (approvals >= verify.minApprovals) {
      worker.status = 'succeeded'
      persistFleet(state)
        .catch(() => {})
        .finally(() => settleChild(state, lockKey))
      return
    }
    // Need more independent approvals — spawn another verifier if budget allows.
    if (!budgetExceeded(state) && !projectionWouldExceed(state)) {
      spawnVerifier(state, worker, lockKey)
      persistFleet(state).catch(() => {})
      return
    }
    // Budget latched before enough approvals — accept what we have (un-fully
    // verified) and settle the worker as succeeded; the run goes budget_exceeded.
    worker.status = 'succeeded'
    persistFleet(state)
      .catch(() => {})
      .finally(() => settleChild(state, lockKey))
    return
  }

  // REJECT. Re-dispatch the worker if a round remains AND the budget is clear.
  worker.rounds += 1
  if (worker.rounds < verify.maxRounds && !budgetExceeded(state) && !projectionWouldExceed(state)) {
    worker.status = 'running'
    persistFleet(state).catch(() => {})
    spawnChild(state, worker.idx, lockKey)
    return
  }
  // Re-dispatch exhausted (or budget latched) — the worker is terminal 'rejected'.
  worker.status = 'rejected'
  persistFleet(state)
    .catch(() => {})
    .finally(() => settleChild(state, lockKey))
}

// The sessionId of the most recent verifier that approved this worker (UI link).
function lastVerifierSession(worker) {
  if (!Array.isArray(worker.verdicts)) return null
  for (let i = worker.verdicts.length - 1; i >= 0; i -= 1) {
    if (worker.verdicts[i].verdict === 'approve')
      return worker.verdicts[i].verifierSessionId || null
  }
  return null
}

// Parse a verifier's structured verdict. FAIL CLOSED to 'reject' on anything
// unparseable — a malformed verifier must never silently pass work (risks #1).
// Accepts a bare JSON object anywhere in the text (scans for the first {...}).
export function parseVerdict(text) {
  const fallback = { verdict: 'reject', reasons: ['unparseable verifier output'], rubricScores: {} }
  if (typeof text !== 'string' || !text.trim()) return fallback
  let obj = tryParseJson(text.trim())
  if (!obj) {
    // Scan for the first {...} span and try that (verifier may add prose).
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) obj = tryParseJson(text.slice(start, end + 1))
  }
  if (!obj || typeof obj !== 'object') return fallback
  const verdict = obj.verdict === 'approve' ? 'approve' : 'reject'
  return {
    verdict,
    reasons: Array.isArray(obj.reasons) ? obj.reasons.map((r) => String(r)) : [],
    rubricScores: obj.rubricScores && typeof obj.rubricScores === 'object' ? obj.rubricScores : {},
  }
}

function tryParseJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

// Add (or subtract) from the run's pending-children counter — the single-writer
// serialization point. Verifiers and re-dispatched workers add pending work here
// so synthesis waits for everything.
function bumpPending(state, delta) {
  const cur = pendingCounts.get(state.id) || 0
  pendingCounts.set(state.id, cur + delta)
}

// Called once per child (worker OR verifier) when it reaches a terminal state.
// When the last pending child settles, release the run key (lifecycle boundary,
// finally-style so it can't leak) and kick off synthesis.
function settleChild(state, lockKey) {
  const remaining = (pendingCounts.get(state.id) || 0) - 1
  pendingCounts.set(state.id, remaining)
  if (remaining > 0) return
  pendingCounts.delete(state.id)
  release(lockKey)
  onAllChildrenSettled(state).catch((err) =>
    logger.warn({ detail: err.message, id: state.id }, 'fleet_synthesis_failed'),
  )
}

// After all children settle: set the derived run status, then spawn ONE synthesis
// child (a normal runClaudeCancellable) fed each child's branch + result, and
// store state.synthesis. The synthesis child's cwd is the first NON-QUARANTINED
// worker (a quarantined/read-only child must never be the acting/merging child).
async function onAllChildrenSettled(state) {
  state.status = deriveStatus(state)

  // BUDGET LATCH at the run level: if the running total crossed the dollar cap,
  // mark the run 'budget_exceeded' and STOP spawning anything further — no
  // synthesis. In-flight children were allowed to finish (their cost is sunk);
  // we never kill them to claw back budget (cancelling mid-write can corrupt a
  // worktree). budget_exceeded supersedes the derived status.
  if (budgetExceeded(state) && state.status !== 'cancelled') {
    state.status = 'budget_exceeded'
    state.synthesis = {
      status: 'skipped',
      sessionId: null,
      summary: 'budget exceeded — synthesis skipped',
      completedAt: new Date().toISOString(),
    }
    await persistFleet(state)
    return
  }

  // If the whole run was cancelled, skip synthesis.
  if (state.status === 'cancelled') {
    state.synthesis = { status: 'skipped', sessionId: null, summary: null, completedAt: null }
    await persistFleet(state)
    return
  }

  // Pick the synthesis cwd from the first NON-QUARANTINED worker. A quarantined
  // child is read-only by intent, so it must not become the child that
  // merges/acts. If ALL workers are quarantined, synthesis runs read-only in the
  // first worker's cwd and is flagged so the UI can say so.
  const workers = state.children.filter((c) => c.childKind !== 'verifier')
  const actingChild = workers.find((c) => !c.quarantine)
  const allQuarantined = !actingChild
  const primaryCwd = actingChild ? actingChild.cwd : workers[0] && workers[0].cwd
  if (!primaryCwd) {
    state.synthesis = { status: 'skipped', sessionId: null, summary: null, completedAt: null }
    await persistFleet(state)
    return
  }

  const childLines = workers
    .map(
      (c) =>
        `- child ${c.idx} (${c.status}) on branch ${c.branch}: ` +
        `${c.error ? `error: ${c.error}` : c.workflow ? `workflow ${c.workflow}` : (c.prompt || '').slice(0, 200)}`,
    )
    .join('\n')
  const synthPrompt =
    `Synthesize the results of a fleet run for the goal: "${state.goal}". ` +
    `${workers.length} child agents each worked in their own git worktree/branch:\n` +
    `${childLines}\n` +
    (allQuarantined
      ? 'NOTE: all children were quarantined (read-only). Produce a read-only report only; do not merge or act. '
      : '') +
    `Produce a concise merged report: what each child accomplished on its branch, ` +
    `conflicts or follow-ups across branches, and the overall outcome. Do not modify code.`

  state.synthesis = {
    status: 'running',
    sessionId: null,
    summary: null,
    completedAt: null,
    readOnly: allQuarantined || undefined,
    cwd: primaryCwd,
  }
  await persistFleet(state)

  let cliPromise
  try {
    ;({ promise: cliPromise } = runClaudeCancellable({
      args: ['-p', synthPrompt, '--output-format', 'stream-json', '--name', `${state.id}-synth`],
      cwd: primaryCwd,
      timeoutMs: SYNTH_TIMEOUT_MS,
    }))
  } catch (err) {
    state.synthesis.status = 'skipped'
    state.synthesis.summary = `synthesis spawn failed: ${err.message}`
    state.synthesis.completedAt = new Date().toISOString()
    await persistFleet(state)
    return
  }

  try {
    const { stdout } = await cliPromise
    state.synthesis.status = 'done'
    state.synthesis.summary = extractResult(stdout)
  } catch (err) {
    state.synthesis.status = 'skipped'
    state.synthesis.summary = `synthesis failed: ${err.message}`
  }
  state.synthesis.completedAt = new Date().toISOString()
  await persistFleet(state)
}

// Pull the result text out of stream-json stdout. Best-effort: scan lines for the
// last {type:"result"} object, else fall back to the raw stdout.
function extractResult(stdout) {
  if (typeof stdout !== 'string' || !stdout) return ''
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim()
    if (!line) continue
    try {
      const obj = JSON.parse(line)
      if (obj && obj.type === 'result' && typeof obj.result === 'string') return obj.result
    } catch {
      /* not JSON — keep scanning */
    }
  }
  return stdout
}

// ──────────────────────────────────────────────────────────────────────────────
// Readers
// ──────────────────────────────────────────────────────────────────────────────

function readRunFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed
  } catch {
    /* corrupt / unreadable — skip */
  }
  return null
}

// List all persisted runs as summaries (guarded — skips corrupt files).
export function listFleetRuns() {
  let entries
  try {
    entries = fs.readdirSync(DATA_DIR)
  } catch {
    return []
  }
  const runs = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const state = readRunFile(path.join(DATA_DIR, name))
    if (state) runs.push(summarize(state))
  }
  return runs
}

// Read one persisted run by id. Returns null when unknown / corrupt.
export function getFleetRun(id) {
  if (typeof id !== 'string' || !id) return null
  // id is a derived slug; reject anything that could traverse out of DATA_DIR.
  if (id.includes('/') || id.includes('\\') || id.includes('..')) return null
  return readRunFile(path.join(DATA_DIR, `${id}.json`))
}

// ──────────────────────────────────────────────────────────────────────────────
// Templates — saved, repeatable fleet configs (dynamic-workflows "SAVE WORKING
// WORKFLOWS"). One JSON per template under TEMPLATES_DIR via atomicWriteJson, the
// SAME persistence primitive as runs. The name is traversal-guarded exactly like
// getFleetRun before building any path. A template is a request-construction
// convenience: it does NOT start a lifecycle of its own.
// ──────────────────────────────────────────────────────────────────────────────

// A filesystem-safe template name: letters, digits, underscores, hyphens only,
// 1-100 chars, not pure punctuation, not leading-dash. Mirrors the route-level
// validateWorkflowName regex so the runner is safe to call directly. The path is
// additionally traversal-guarded. Returns true/false (the route maps to HTTP).
const TEMPLATE_NAME_RE = /^[a-zA-Z0-9_-]+$/
export function isValidTemplateName(name) {
  if (typeof name !== 'string' || !name) return false
  if (name.length > 100) return false
  if (name.startsWith('-')) return false
  if (!/[a-zA-Z0-9]/.test(name)) return false
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false
  return TEMPLATE_NAME_RE.test(name)
}

// Save a fleet template. Validates the body with the SAME validateFleetRequest
// body checks (so a template can never save an invalid fleet) PLUS the name
// rule. Returns { ok, status, ... }.
export async function saveFleetTemplate({ name, goal, children, policy } = {}) {
  if (!isValidTemplateName(name)) {
    return { ok: false, status: 400, error: 'invalid template name' }
  }
  // Reuse the start-request validator for goal/children/policy shape. We do NOT
  // require the cwds to be whitelisted at SAVE time (a template may target a
  // project not yet registered) — only the structural body checks. So we run a
  // light structural pass mirroring validateFleetRequest's body section.
  const bodyCheck = validateTemplateBody({ goal, children })
  if (!bodyCheck.ok) return bodyCheck

  const now = new Date().toISOString()
  const existing = getFleetTemplate(name)
  const template = {
    name,
    goal: goal.trim(),
    children: children.map((c) => ({
      cwd: c.cwd,
      prompt: typeof c.prompt === 'string' && c.prompt.trim() ? c.prompt : null,
      workflow: typeof c.workflow === 'string' && c.workflow.trim() ? c.workflow : null,
      quarantine: c.quarantine === true,
    })),
    policy: policy && typeof policy === 'object' ? policy : {},
    createdAt: existing && existing.createdAt ? existing.createdAt : now,
    updatedAt: now,
  }

  try {
    await fsp.mkdir(TEMPLATES_DIR, { recursive: true })
    await atomicWriteJson(path.join(TEMPLATES_DIR, `${name}.json`), template)
  } catch (err) {
    logger.warn({ detail: err.message, name }, 'fleet_template_save_failed')
    return { ok: false, status: 502, error: err.message }
  }
  return { ok: true, status: 200, template }
}

// Structural body validation for a template (goal + children shape), WITHOUT the
// whitelist/git-repo preconditions (those are enforced at launch time, against
// the live machine, not at save time).
function validateTemplateBody({ goal, children }) {
  if (!goal || typeof goal !== 'string' || !goal.trim()) {
    return { ok: false, status: 400, error: 'goal is required' }
  }
  if (!Array.isArray(children) || children.length === 0) {
    return { ok: false, status: 400, error: 'children must be a non-empty array' }
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (!child || typeof child !== 'object') {
      return { ok: false, status: 400, error: `child ${i} is not an object` }
    }
    if (!child.cwd || typeof child.cwd !== 'string') {
      return { ok: false, status: 400, error: `child ${i} is missing cwd` }
    }
    const hasPrompt = typeof child.prompt === 'string' && child.prompt.trim()
    const hasWorkflow = typeof child.workflow === 'string' && child.workflow.trim()
    if (!hasPrompt && !hasWorkflow) {
      return { ok: false, status: 400, error: `child ${i} needs a prompt or a workflow` }
    }
  }
  return { ok: true }
}

// List all saved templates (guarded — skips corrupt files). Mirrors listFleetRuns.
export function listFleetTemplates() {
  let entries
  try {
    entries = fs.readdirSync(TEMPLATES_DIR)
  } catch {
    return []
  }
  const templates = []
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    const t = readRunFile(path.join(TEMPLATES_DIR, name))
    if (t) templates.push(t)
  }
  return templates
}

// Read one template by name. Returns null when unknown / corrupt / bad name.
export function getFleetTemplate(name) {
  if (!isValidTemplateName(name)) return null
  return readRunFile(path.join(TEMPLATES_DIR, `${name}.json`))
}

// Read-only merged escalation list: live SDK tool-approval requests for each
// running child's session AND each child cwd's .harness/approvals/pending/*.json.
// Tagged by source ('tool' | 'harness'). Returns [] for an unknown run. Fleet
// NEVER writes here — allow/deny goes through the existing write paths.
export function listEscalations(id) {
  const state = getFleetRun(id)
  if (!state || !Array.isArray(state.children)) return []
  const escalations = []

  for (const child of state.children) {
    // 1) Live SDK tool-approval requests for this child's session.
    if (child.sessionId) {
      let status
      try {
        status = getQueryStatus(child.sessionId)
      } catch {
        status = null
      }
      const pending =
        status && Array.isArray(status.pendingApprovals) ? status.pendingApprovals : []
      for (const a of pending) {
        escalations.push({
          childIdx: child.idx,
          source: 'tool',
          sessionId: child.sessionId,
          approvalId: a.approvalId,
          tool: a.toolName || null,
          command: a.input ? JSON.stringify(a.input).slice(0, 500) : null,
          riskLevel: null,
          requestedAt: null,
        })
      }
    }

    // 2) Filesystem danger-zone pendings written by the harness rails.
    const pendingDir = path.join(child.cwd, '.harness', 'approvals', 'pending')
    let files = []
    try {
      files = fs.readdirSync(pendingDir)
    } catch {
      files = []
    }
    for (const name of files) {
      if (!name.endsWith('.json')) continue
      const req = readRunFile(path.join(pendingDir, name))
      if (!req) continue
      escalations.push({
        childIdx: child.idx,
        source: 'harness',
        sessionId: req.sessionId || child.sessionId || null,
        requestId: req.id || name.replace(/\.json$/, ''),
        tool: req.tool || null,
        command: req.command || null,
        riskLevel: req.riskLevel || null,
        requestedAt: req.requestedAt || null,
      })
    }
  }

  return escalations
}

// Cancel an in-flight run: invoke each stored cancel() and mark not-yet-settled
// children 'cancelled'. The taggedCli handlers honour that terminal state.
export async function cancelFleet(id) {
  const state = getFleetRun(id)
  if (!state) return { ok: false, status: 404, error: 'not_found' }

  const list = cancels.get(id) || []
  for (const cancel of list) {
    try {
      cancel()
    } catch {
      /* already exited */
    }
  }
  for (const child of state.children) {
    if (!['succeeded', 'failed', 'cancelled'].includes(child.status)) {
      child.status = 'cancelled'
    }
  }
  state.status = deriveStatus(state)
  try {
    await persistFleet(state)
  } catch (err) {
    logger.warn({ detail: err.message, id }, 'fleet_cancel_persist_failed')
  }
  return { ok: true, status: 202 }
}

// Persist the 'escalated' child status. A child whose session/cwd currently has
// a live escalation (tool OR harness) flips running → escalated; when its
// escalation clears it reverts escalated → running. Terminal children
// (succeeded/failed/cancelled) and not-yet-acked 'starting' children are left
// alone — only the running↔escalated pair transitions. Returns the (possibly
// unchanged) escalation list so the route can return both in one pass. Persists
// only when a status actually changed, so a quiet refresh writes nothing.
export async function reconcileEscalationStatus(id) {
  const escalations = listEscalations(id)
  const state = getFleetRun(id)
  if (!state || !Array.isArray(state.children)) return escalations

  const escalatedIdx = new Set(escalations.map((e) => e.childIdx))
  let changed = false
  for (const child of state.children) {
    if (escalatedIdx.has(child.idx)) {
      if (child.status === 'running') {
        child.status = 'escalated'
        changed = true
      }
    } else if (child.status === 'escalated') {
      // Escalation cleared (decided/withdrawn) — back to running.
      child.status = 'running'
      changed = true
    }
  }

  if (changed) {
    try {
      await persistFleet(state)
    } catch (err) {
      logger.warn({ detail: err.message, id }, 'fleet_escalation_status_persist_failed')
    }
  }
  return escalations
}

// Route a human Allow/Deny for ONE Fleet escalation through the EXISTING write
// path — Fleet adds NO new approval logic, it only dispatches the decision:
//
//   source 'tool'    → the in-memory SDK resolver (resolveApproval), the SAME
//                      function POST /api/sessions/:id/tool-approval uses.
//   source 'harness' → shell `harness approve <requestId> --allow|--deny` in the
//                      CHILD's cwd DIRECTLY (runHarnessApprove — a child_process
//                      subprocess, NO Claude/LLM session in the trust path). The
//                      harness CLI is the SINGLE WRITER of the decided file; the
//                      cockpit NEVER writes it directly.
//
// Returns { ok, status, ... } so the route maps it to HTTP. 4xx on bad input /
// unknown child; the child cwd is whitelisted before any harness shell-out.
export async function decideFleetEscalation(id, body = {}) {
  const state = getFleetRun(id)
  if (!state || !Array.isArray(state.children)) {
    return { ok: false, status: 404, error: 'not_found' }
  }

  const { childIdx, source, decision, approvalId, requestId, message } = body
  if (decision !== 'allow' && decision !== 'deny') {
    return { ok: false, status: 400, error: 'decision must be "allow" or "deny"' }
  }
  if (source !== 'tool' && source !== 'harness') {
    return { ok: false, status: 400, error: 'source must be "tool" or "harness"' }
  }
  if (typeof childIdx !== 'number' || !Number.isInteger(childIdx)) {
    return { ok: false, status: 400, error: 'childIdx must be an integer' }
  }
  const child = state.children.find((c) => c.idx === childIdx)
  if (!child) {
    return { ok: false, status: 404, error: 'unknown child' }
  }

  if (source === 'tool') {
    // Reuse the canonical in-memory SDK resolver via the child's session.
    if (!child.sessionId) {
      return { ok: false, status: 400, error: 'child has no session for a tool decision' }
    }
    if (!approvalId || typeof approvalId !== 'string') {
      return { ok: false, status: 400, error: 'approvalId is required for source "tool"' }
    }
    const resolved = resolveApproval(child.sessionId, approvalId, decision, message)
    if (!resolved) {
      return { ok: false, status: 404, error: 'approval not found or already resolved' }
    }
    return { ok: true, status: 200, source, decision, childIdx }
  }

  // source === 'harness': shell the harness CLI in the child's cwd. Whitelist
  // the cwd FIRST — never shell into an arbitrary path.
  if (!requestId || typeof requestId !== 'string') {
    return { ok: false, status: 400, error: 'requestId is required for source "harness"' }
  }
  if (!isKnownHarnessRoot(child.cwd)) {
    return { ok: false, status: 404, error: 'child cwd is not a known root' }
  }

  // Shell the harness CLI DIRECTLY in child.cwd — NO Claude/LLM session. The
  // harness CLI is the single writer of the decided file; it copies the pending's
  // commandHash onto the decision (replay-proofing) and exits non-zero if the
  // pending is missing / already decided. runHarnessApprove never throws/hangs.
  const result = await runHarnessApprove(child.cwd, requestId, decision)
  if (!result.ok) {
    logger.warn({ detail: result.error, id, childIdx, requestId }, 'fleet_decide_harness_failed')
    return { ok: false, status: 502, error: result.error }
  }

  const stdout = result.stdout || ''
  const stderr = result.stderr || ''
  return {
    ok: true,
    status: 200,
    source,
    decision,
    childIdx,
    requestId,
    raw: stderr ? `${stdout}\n${stderr}` : stdout || undefined,
  }
}
