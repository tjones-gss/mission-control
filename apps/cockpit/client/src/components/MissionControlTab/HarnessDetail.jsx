import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  GitBranch,
  Loader2,
  Play,
} from 'lucide-react'
import { CompileRoadmapDialog } from './CompileRoadmapDialog.jsx'
import { Toast } from './Toast.jsx'

const STATUS_BADGE = {
  done: 'bg-green-900/60 text-green-200',
  complete: 'bg-green-900/60 text-green-200',
  completed: 'bg-green-900/60 text-green-200',
  in_progress: 'bg-indigo-900/60 text-indigo-200',
  'in-progress': 'bg-indigo-900/60 text-indigo-200',
  active: 'bg-indigo-900/60 text-indigo-200',
  review: 'bg-sky-900/60 text-sky-200',
  ready: 'bg-emerald-900/60 text-emerald-200',
  draft: 'bg-gray-700 text-gray-200',
  blocked: 'bg-amber-900/60 text-amber-200',
  pending: 'bg-gray-700 text-gray-200',
  todo: 'bg-gray-700 text-gray-200',
  failed: 'bg-red-900/60 text-red-200',
}

const PRIORITY_BADGE = {
  high: 'bg-red-900/60 text-red-200',
  medium: 'bg-amber-900/60 text-amber-200',
  low: 'bg-gray-700 text-gray-300',
}

const PLAN_STATUS_BADGE = {
  approved: 'bg-green-900/60 text-green-200',
  rejected: 'bg-red-900/60 text-red-200',
  'in-review': 'bg-amber-900/60 text-amber-200',
  draft: 'bg-gray-700 text-gray-200',
}

// Statuses for which the mission is settled or already running — Run on-rails
// should not be offered. Stored with hyphens to match the canonical schema
// values (draft | ready | in-progress | review | complete | …); normalizeStatus
// collapses underscores → hyphens so older `in_progress`-style emitters match.
const NON_RUNNABLE = new Set([
  'in-progress',
  'active',
  'running',
  'review',
  'done',
  'complete',
  'completed',
])

// Lifecycle the harness drives a mission through (see harness-status.schema.json
// `missions.*.status`): authored as draft → graduated to ready via
// `harness mission ready` → picked up (in-progress) → review → complete. We map
// the various synonyms an older harness might emit onto these four columns so
// the stepper renders consistently.
const LIFECYCLE_STEPS = [
  { key: 'draft', label: 'draft', match: new Set(['draft', 'pending', 'todo']) },
  { key: 'ready', label: 'ready', match: new Set(['ready']) },
  {
    key: 'in-progress',
    label: 'in-progress',
    match: new Set(['in-progress', 'active', 'running', 'review']),
  },
  {
    key: 'complete',
    label: 'complete',
    match: new Set(['complete', 'completed', 'done']),
  },
]

// Lowercase + collapse underscores to hyphens so `in_progress` and `in-progress`
// compare equal across the codebase and the canonical schema values.
function normalizeStatus(value) {
  return value == null ? '' : String(value).toLowerCase().replace(/_/g, '-')
}

// Index of the lifecycle column a status belongs to, or -1 for off-track
// statuses (blocked/failed) we render as a badge but not on the stepper.
function lifecycleIndex(status) {
  return LIFECYCLE_STEPS.findIndex((step) => step.match.has(status))
}

function Card({ label, value, hint }) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-gray-600">{label}</div>
      <div className="mt-1 text-sm text-gray-200 font-mono">{value}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-600">{hint}</div>}
    </div>
  )
}

function StatusPill({ value, map }) {
  if (value == null || value === '') return <span className="text-gray-600">—</span>
  const cls = map[String(value).toLowerCase()] || 'bg-gray-700 text-gray-200'
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{String(value)}</span>
  )
}

// The /api/harness/:projectKey response is the raw `harness status --json`
// object (plus projectPath/projectLabel). Missions may live under a couple of
// shapes — normalize to a list of { id, ...fields } so we can render uniformly.
function normalizeMissions(status) {
  const missions = status?.missions
  if (!missions) return []
  if (Array.isArray(missions)) {
    return missions.map((m, i) => ({ id: m.id || m.mission || m.name || `mission-${i}`, ...m }))
  }
  if (typeof missions === 'object') {
    return Object.entries(missions).map(([id, m]) => ({
      id,
      ...(m && typeof m === 'object' ? m : { value: m }),
    }))
  }
  return []
}

// PRDs (phased plans) ride along in the raw status under `plans` (see
// packages/contracts/schemas/harness-status.schema.json). Normalize to a list.
function normalizePlans(status) {
  const plans = status?.plans
  if (!plans || typeof plans !== 'object') return []
  return Object.entries(plans).map(([id, p]) => ({
    id,
    ...(p && typeof p === 'object' ? p : {}),
  }))
}

// Compact left-to-right view of where a mission sits in its lifecycle. The
// current column glows; everything to its left is shown as already-passed.
// Off-track statuses (blocked/failed, index -1) leave every step muted.
function LifecycleStepper({ status }) {
  const current = lifecycleIndex(status)
  return (
    <div className="flex items-center gap-1" aria-label={`lifecycle: ${status || 'unknown'}`}>
      {LIFECYCLE_STEPS.map((step, i) => {
        const reached = current >= 0 && i <= current
        const isCurrent = i === current
        return (
          <span key={step.key} className="flex items-center gap-1">
            {i > 0 && <ArrowRight size={9} className="text-gray-700" />}
            <span
              className={`px-1 py-0.5 rounded text-[9px] font-medium tracking-wide ${
                isCurrent
                  ? 'bg-indigo-900/70 text-indigo-100'
                  : reached
                    ? 'text-emerald-400/80'
                    : 'text-gray-600'
              }`}
            >
              {step.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}

function MissionRow({ mission, projectKey, projectLabel, onToast }) {
  const validation = mission.validation ?? mission.validated
  const review = mission.review ?? mission.reviewed
  const status = normalizeStatus(mission.status)
  const isDraft = status === 'draft'
  // Run on-rails is only offered once a draft has been graduated to ready (or a
  // later still-runnable status). Draft missions must be marked ready first.
  const runnable = !isDraft && !NON_RUNNABLE.has(status)

  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
  // Marking a draft ready is a quick synchronous state flip on the server; we
  // disable the button while in flight and let the next status refetch swap the
  // row out of the draft branch.
  const [markingReady, setMarkingReady] = useState(false)
  // After a successful execute the server has spawned an implementer but the
  // mission status may not flip to in-progress until the next status refetch.
  // `pendingStart` keeps the button disabled / "starting…" across that window so
  // a second click can't double-spawn (pairs with the server-side 409 guard).
  const [pendingStart, setPendingStart] = useState(false)
  const pendingTimer = useRef(null)

  // Clear the pending lock once the refetched status confirms the mission left
  // the runnable set (moved to in-progress/done/etc) — the spawn "took".
  useEffect(() => {
    if (pendingStart && !runnable) {
      setPendingStart(false)
      if (pendingTimer.current) {
        clearTimeout(pendingTimer.current)
        pendingTimer.current = null
      }
    }
  }, [pendingStart, runnable])

  // Cleanup any outstanding timeout on unmount.
  useEffect(() => {
    return () => {
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
    }
  }, [])

  const execute = useCallback(async () => {
    setStarting(true)
    try {
      // projectKey is ALREADY encodeURIComponent(projectPath) — use it bare (double
      // -encoding would 404 the whitelist). mission.id is raw, so it still needs encoding.
      const res = await fetch(
        `/api/harness/${projectKey}/missions/${encodeURIComponent(mission.id)}/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        // A 409 means a run for this mission is already in flight — surface it
        // but keep the pending lock (a sibling start already owns this mission).
        if (res.status === 409) {
          setPendingStart(true)
        }
        onToast?.({
          tone: res.status === 409 ? 'info' : 'error',
          message:
            res.status === 409
              ? `${mission.id} is already starting.`
              : `Could not start ${mission.id}: ${
                  data.error || data.detail || `HTTP ${res.status}`
                }`,
        })
        return
      }
      setConfirming(false)
      // Hold the button disabled until the next status refetch confirms the
      // mission left the runnable set, or a timeout re-arms it as a fallback.
      setPendingStart(true)
      if (pendingTimer.current) clearTimeout(pendingTimer.current)
      pendingTimer.current = setTimeout(() => {
        setPendingStart(false)
        pendingTimer.current = null
      }, 30_000)
      onToast?.({
        tone: 'success',
        message: `${mission.id} started — watch it in the Agents tab.`,
      })
    } catch (e) {
      onToast?.({ tone: 'error', message: `Could not start ${mission.id}: ${e.message}` })
    } finally {
      setStarting(false)
    }
  }, [projectKey, mission.id, onToast])

  // Graduate a draft mission to ready (Stage A endpoint). The harness owns the
  // mission-index write — the server shells `harness mission ready <id>` and the
  // next status refetch flips the row out of the draft branch.
  const markReady = useCallback(async () => {
    setMarkingReady(true)
    try {
      // projectKey is ALREADY encodeURIComponent(projectPath) — use it bare.
      // mission.id is raw, so it still needs encoding.
      const res = await fetch(
        `/api/harness/${projectKey}/missions/${encodeURIComponent(mission.id)}/ready`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        onToast?.({
          tone: res.status === 409 ? 'info' : 'error',
          message:
            res.status === 409
              ? `${mission.id} is already being marked ready.`
              : `Could not mark ${mission.id} ready: ${
                  data.error || data.detail || `HTTP ${res.status}`
                }`,
        })
        return
      }
      onToast?.({
        tone: 'success',
        message: `${mission.id} marked ready — Run on-rails is now available.`,
      })
    } catch (e) {
      onToast?.({ tone: 'error', message: `Could not mark ${mission.id} ready: ${e.message}` })
    } finally {
      setMarkingReady(false)
    }
  }, [projectKey, mission.id, onToast])

  // The button is "busy" while the request is in flight OR while we're waiting
  // for the refetch to confirm the spawn took.
  const busy = starting || pendingStart

  return (
    <li className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-gray-200 truncate">{mission.id}</span>
        <StatusPill value={mission.status} map={STATUS_BADGE} />
        {isDraft && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium border border-amber-600/70 text-amber-300 bg-amber-950/30">
            DRAFT · mark ready before running
          </span>
        )}
        {mission.priority != null && <StatusPill value={mission.priority} map={PRIORITY_BADGE} />}
        {/* Draft missions: offer Mark ready instead of Run on-rails. Execute is
            gated until the mission is graduated to ready. */}
        {isDraft && (
          <button
            onClick={markReady}
            disabled={markingReady}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-emerald-300 hover:text-emerald-200 hover:bg-emerald-900/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={`Mark ${mission.id} ready to run`}
          >
            {markingReady ? (
              <Loader2 size={11} className="animate-spin" />
            ) : (
              <ArrowRight size={11} />
            )}
            {markingReady ? 'Marking ready…' : 'Mark ready'}
          </button>
        )}
        {runnable && pendingStart && !confirming && (
          <span
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-500"
            title={`${mission.id} is starting…`}
          >
            <Loader2 size={11} className="animate-spin" />
            starting…
          </span>
        )}
        {runnable && !pendingStart && !confirming && (
          <button
            onClick={() => setConfirming(true)}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
            title={`Run ${mission.id} on-rails`}
          >
            <Play size={11} />
            Run on-rails
          </button>
        )}
      </div>
      <div className="mt-1.5">
        <LifecycleStepper status={status} />
      </div>
      <div className="mt-1.5 flex items-center gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          {validation ? (
            <CheckCircle2 size={12} className="text-emerald-400" />
          ) : (
            <Circle size={12} className="text-gray-600" />
          )}
          validation
        </span>
        <span className="flex items-center gap-1">
          {review ? (
            <CheckCircle2 size={12} className="text-emerald-400" />
          ) : (
            <Circle size={12} className="text-gray-600" />
          )}
          review
        </span>
      </div>

      {confirming && (
        <div className="mt-2 px-2.5 py-2 bg-gray-950 border border-gray-700 rounded space-y-2">
          <div className="text-[11px] text-gray-300">
            This spawns an agent that will execute{' '}
            <span className="font-mono text-gray-100">{mission.id}</span> inside{' '}
            <span className="font-mono text-gray-100">{projectLabel}</span>. It runs under the
            harness rails.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="px-2 py-1 rounded text-[11px] text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={execute}
              disabled={busy}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              {busy ? 'Starting…' : 'Run on-rails'}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

export function HarnessDetail({ project, harnessVersion }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showCompile, setShowCompile] = useState(false)
  const [toast, setToast] = useState(null)

  const pushToast = useCallback((t) => setToast({ ...t, _id: Date.now() }), [])

  // Fetch the full status for the selected project; refetch on project change
  // or harnessVersion bumps so SSE-driven updates refresh the view.
  useEffect(() => {
    // Skip the detail fetch entirely when the project's harness is unavailable —
    // the summary already carries the error reason and the endpoint would just
    // surface the same failure.
    if (!project.available) {
      setStatus(null)
      setError(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    setStatus(null)
    setLoading(true)
    setError(null)
    fetch(`/api/harness/${project.projectKey}`, { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`
          try {
            const body = await res.json()
            msg = body.detail ?? body.error ?? msg
          } catch {}
          throw new Error(msg)
        }
        return res.json()
      })
      .then((data) => {
        setStatus(data)
        setLoading(false)
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setLoading(false)
      })
    return () => controller.abort()
  }, [project.projectKey, project.available, harnessVersion])

  const missions = useMemo(() => normalizeMissions(status), [status])
  const plans = useMemo(() => normalizePlans(status), [status])

  const phase = status?.pipeline?.phase ?? project.pipeline?.phase
  const gate = status?.pipeline?.gate ?? project.pipeline?.gate
  const active = status?.pipeline?.active ?? project.pipeline?.active
  // Phase 2: the live phase also carries the goal it serves and its fan-out
  // strategy (single|fleet). The raw detail emits snake_case under pipeline.*;
  // the parser-shaped summary uses pipeline.goal/strategy.
  const phaseGoal = status?.pipeline?.goal ?? project.pipeline?.goal
  const phaseStrategy = status?.pipeline?.strategy ?? project.pipeline?.strategy
  const phaseHint = [gate ? `gate: ${gate}` : null, phaseStrategy ? `via ${phaseStrategy}` : null]
    .filter(Boolean)
    .join(' · ')
  // The /api/harness/:projectKey detail is the raw `harness status --json` object,
  // which emits the readiness block under `readiness_overall`. The summary
  // (project.readiness) is the parser-shaped ProjectSummary, so keep that key.
  const score = status?.readiness_overall?.score ?? project.readiness?.score
  const mvpReady = status?.readiness_overall?.mvp_ready ?? project.readiness?.mvp_ready
  const blocked = status?.next?.blocked ?? project.blocked
  const blocker = status?.next?.blocker ?? project.blocker

  return (
    <div className="relative h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-800 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono text-gray-200">{project.projectLabel}</span>
          {project.mode && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-800 text-gray-300">
              {project.mode}
            </span>
          )}
          <span className="text-xs text-gray-500 truncate">{project.projectPath}</span>
          {project.available && (
            <button
              onClick={() => setShowCompile(true)}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
              title="Compile a plain-language roadmap into sequenced draft missions"
            >
              <GitBranch size={12} />
              Compile roadmap → missions
            </button>
          )}
        </div>
        {blocked && (
          <div className="flex items-start gap-2 px-3 py-2 bg-amber-950/40 border border-amber-900/60 rounded">
            <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200">
              <div className="font-semibold">Blocked by gate: {gate || 'unknown'}</div>
              <div className="text-amber-300/80">{blocker || 'Awaiting your decision.'}</div>
            </div>
          </div>
        )}
      </div>

      {!project.available ? (
        <div className="flex-1 overflow-auto px-4 py-6">
          <div className="flex items-start gap-2 px-3 py-2 bg-red-950/30 border border-red-900/50 rounded max-w-xl">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <div className="text-xs text-red-200">
              <div className="font-semibold">Harness unavailable</div>
              <div className="text-red-300/80">
                {project.error || 'harness status --json did not succeed for this project.'}
              </div>
            </div>
          </div>
        </div>
      ) : loading && !status ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          Loading…
        </div>
      ) : error ? (
        <div className="flex-1 overflow-auto px-4 py-6">
          <div className="text-xs text-red-400">{error}</div>
        </div>
      ) : (
        <>
          {/* Cards */}
          <div className="shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-3">
            <Card label="Pipeline" value={active || '—'} />
            <Card label="Phase" value={phase || '—'} hint={phaseHint || undefined} />
            <Card
              label="Readiness"
              value={score != null ? score : '—'}
              hint={mvpReady == null ? undefined : mvpReady ? 'MVP ready' : 'not MVP ready'}
            />
            <Card label="Missions" value={missions.length} />
          </div>

          {/* The goal the current phase is working toward (Phase 2 spine). */}
          {phaseGoal && (
            <div className="shrink-0 px-4 -mt-1 pb-2">
              <p className="text-[11px] text-gray-500 truncate" title={phaseGoal}>
                <span className="text-gray-600">goal:</span> {phaseGoal}
              </p>
            </div>
          )}

          {/* Plans / PRDs — only shown when the project has registered any. A
              PRD is a reviewed, phased plan that gates mission-planning. */}
          {plans.length > 0 && (
            <div className="shrink-0 px-4 pt-1 pb-3">
              <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">
                Plans / PRDs
              </h3>
              <ul className="space-y-2">
                {plans.map((plan) => (
                  <li
                    key={plan.id}
                    className="bg-gray-900 border border-gray-800 rounded px-3 py-2"
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-gray-200 truncate">{plan.id}</span>
                      <StatusPill value={plan.status} map={PLAN_STATUS_BADGE} />
                      {plan.approved_by && (
                        <span className="text-[10px] text-gray-500">
                          approved by {plan.approved_by}
                        </span>
                      )}
                      {Array.isArray(plan.missions) && plan.missions.length > 0 && (
                        <span className="ml-auto text-[10px] text-gray-500">
                          {plan.missions.length} mission{plan.missions.length === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>
                    {plan.file && (
                      <div className="mt-1 text-[10px] text-gray-600 font-mono truncate">
                        {plan.file}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missions list */}
          <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Missions</h3>
            {missions.length === 0 ? (
              <div className="text-[11px] text-gray-600">
                No missions reported for this project.
              </div>
            ) : (
              <ul className="space-y-2">
                {missions.map((mission) => (
                  <MissionRow
                    key={mission.id}
                    mission={mission}
                    projectKey={project.projectKey}
                    projectLabel={project.projectLabel}
                    onToast={pushToast}
                  />
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {showCompile && (
        <CompileRoadmapDialog
          project={project}
          onClose={() => setShowCompile(false)}
          onCompiled={() => {
            setShowCompile(false)
            pushToast({
              tone: 'success',
              message: 'Roadmap compiled — new draft missions will appear as the list refreshes.',
            })
          }}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
