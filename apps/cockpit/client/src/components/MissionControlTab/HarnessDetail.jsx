import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Circle } from 'lucide-react'

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

function MissionRow({ mission }) {
  const validation = mission.validation ?? mission.validated
  const review = mission.review ?? mission.reviewed
  return (
    <li className="bg-gray-900 border border-gray-800 rounded px-3 py-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-mono text-xs text-gray-200 truncate">{mission.id}</span>
        <StatusPill value={mission.status} map={STATUS_BADGE} />
        {mission.priority != null && <StatusPill value={mission.priority} map={PRIORITY_BADGE} />}
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
    </li>
  )
}

export function HarnessDetail({ project, harnessVersion }) {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

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
  const score = status?.readiness?.score ?? project.readiness?.score
  const mvpReady = status?.readiness?.mvp_ready ?? project.readiness?.mvp_ready
  const blocked = status?.next?.blocked ?? project.blocked
  const blocker = status?.next?.blocker ?? project.blocker

  return (
    <div className="h-full flex flex-col overflow-hidden">
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
                  <MissionRow key={mission.id} mission={mission} />
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
