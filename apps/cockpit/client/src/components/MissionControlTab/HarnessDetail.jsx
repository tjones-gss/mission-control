import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle, GitBranch, Loader2, Play } from 'lucide-react'
import { CompileRoadmapDialog } from './CompileRoadmapDialog.jsx'
import { Toast } from './Toast.jsx'

const STATUS_BADGE = {
  done: 'bg-green-900/60 text-green-200',
  complete: 'bg-green-900/60 text-green-200',
  completed: 'bg-green-900/60 text-green-200',
  in_progress: 'bg-indigo-900/60 text-indigo-200',
  active: 'bg-indigo-900/60 text-indigo-200',
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

// Statuses for which the mission is settled or already running — Run on-rails
// should not be offered.
const NON_RUNNABLE = new Set([
  'in_progress',
  'active',
  'running',
  'done',
  'complete',
  'completed',
])

function normalizeStatus(value) {
  return value == null ? '' : String(value).toLowerCase()
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

function MissionRow({ mission, projectKey, projectLabel, onToast }) {
  const validation = mission.validation ?? mission.validated
  const review = mission.review ?? mission.reviewed
  const status = normalizeStatus(mission.status)
  const isDraft = status === 'draft'
  const runnable = !NON_RUNNABLE.has(status)

  const [confirming, setConfirming] = useState(false)
  const [starting, setStarting] = useState(false)
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
            DRAFT · review before running
          </span>
        )}
        {mission.priority != null && <StatusPill value={mission.priority} map={PRIORITY_BADGE} />}
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

  const phase = status?.pipeline?.phase ?? project.pipeline?.phase
  const gate = status?.pipeline?.gate ?? project.pipeline?.gate
  const active = status?.pipeline?.active ?? project.pipeline?.active
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
            <Card label="Phase" value={phase || '—'} hint={gate ? `gate: ${gate}` : undefined} />
            <Card
              label="Readiness"
              value={score != null ? score : '—'}
              hint={mvpReady == null ? undefined : mvpReady ? 'MVP ready' : 'not MVP ready'}
            />
            <Card label="Missions" value={missions.length} />
          </div>

          {/* Missions list */}
          <div className="flex-1 min-h-0 overflow-auto px-4 py-3">
            <h3 className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Missions</h3>
            {missions.length === 0 ? (
              <div className="text-[11px] text-gray-600">No missions reported for this project.</div>
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
              message:
                'Roadmap compiled — new draft missions will appear as the list refreshes.',
            })
          }}
        />
      )}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  )
}
