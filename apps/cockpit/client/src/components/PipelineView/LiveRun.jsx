import { useMemo } from 'react'
import { AlertTriangle, Target } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { LoadingState, ErrorState } from '../ui/States.jsx'
import {
  normalizeMissions,
  normalizePlans,
  normalizeStatus,
} from '../MissionControlTab/HarnessDetail.jsx'
import { StageStrip } from './StageStrip.jsx'
import { StageCanvas } from './StageCanvas.jsx'
import { GuardrailsPanel } from './GuardrailsPanel.jsx'
import { BudgetBar } from './BudgetBar.jsx'

// Read-only live view of one governed project's harness pipeline. Everything
// rendered here maps 1:1 onto a real `harness status --json` field (via
// GET /api/harness/:projectKey) — budget bars / guardrail cards from the
// design prototype are deliberately absent until the contract carries them.

function fmtWhen(iso) {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString()
}

// Order mirrors the mission lifecycle so the counts read left → right.
const MISSION_ORDER = ['in-progress', 'review', 'ready', 'blocked', 'failed', 'draft', 'complete']

function missionCounts(missions) {
  const counts = new Map()
  for (const m of missions) {
    const s = normalizeStatus(m.status) || 'unknown'
    counts.set(s, (counts.get(s) || 0) + 1)
  }
  return [...counts.entries()].sort(
    ([a], [b]) =>
      (MISSION_ORDER.indexOf(a) + 1 || MISSION_ORDER.length + 1) -
      (MISSION_ORDER.indexOf(b) + 1 || MISSION_ORDER.length + 1),
  )
}

export function LiveRun({ project, harnessVersion }) {
  const detailUrl = project?.available ? `/api/harness/${project.projectKey}` : null
  const { data: status, loading, error, refetch } = useApi(detailUrl, [harnessVersion])

  const missions = useMemo(() => normalizeMissions(status), [status])
  const plans = useMemo(() => normalizePlans(status), [status])

  if (!project) return null

  if (!project.available) {
    return (
      <div className="m-4 p-4 rounded-lg border border-[color:var(--mc-danger)] bg-[color:var(--mc-danger-soft)] text-sm text-[color:var(--mc-fg-2)]">
        <div className="flex items-center gap-2 font-medium text-[color:var(--mc-danger)]">
          <AlertTriangle size={14} />
          Harness unavailable
        </div>
        <div className="mt-1 text-xs">{project.error}</div>
      </div>
    )
  }

  if (loading && !status) return <LoadingState label="Reading harness status…" />
  if (error) return <ErrorState message={error} onRetry={refetch} />
  if (!status) return null

  const pipeline = status.pipeline || {}
  const blocked = Boolean(status.next?.blocked)
  const blocker = status.next?.blocker || null
  const goal = pipeline.goal || pipeline.active || null
  const when = fmtWhen(pipeline.transitioned_at)
  const readiness = status.readiness_overall
  const counts = missionCounts(missions)

  return (
    <div className="p-4 space-y-4 overflow-y-auto">
      {/* Run header — goal + posture chips */}
      <div className="space-y-2">
        {goal && (
          <div className="flex items-start gap-2 text-sm text-[color:var(--mc-fg)]">
            <Target size={14} className="mt-0.5 shrink-0 text-[color:var(--mc-accent)]" />
            <span>{goal}</span>
          </div>
        )}
        <div className="flex items-center flex-wrap gap-1.5 text-[10px] uppercase tracking-wider">
          {pipeline.strategy && (
            <span className="px-1.5 py-0.5 rounded bg-[color:var(--mc-surface-2)] text-[color:var(--mc-fg-3)]">
              strategy: {pipeline.strategy}
            </span>
          )}
          {blocked && (
            <span className="px-1.5 py-0.5 rounded bg-[color:var(--mc-warn-soft)] text-[color:var(--mc-warn)]">
              waiting at {pipeline.gate ? `${pipeline.gate} gate` : 'gate'}
            </span>
          )}
          {readiness?.score != null && (
            <span
              className={`px-1.5 py-0.5 rounded ${
                readiness.mvp_ready
                  ? 'bg-[color:var(--mc-ok-soft)] text-[color:var(--mc-ok)]'
                  : 'bg-[color:var(--mc-surface-2)] text-[color:var(--mc-fg-3)]'
              }`}
            >
              readiness {readiness.score}
            </span>
          )}
          {when && (
            <span className="px-1.5 py-0.5 rounded text-[color:var(--mc-fg-4)]">
              in phase since {when}
            </span>
          )}
        </div>
        {blocked && blocker && <div className="text-xs text-[color:var(--mc-warn)]">{blocker}</div>}
      </div>

      {/* v10 harnesses emit the active pipeline's full ordered stage graph —
          render the canvas. Older harnesses get the honest 3-slot window. */}
      {Array.isArray(status.phases) && status.phases.length > 0 ? (
        <StageCanvas
          phases={status.phases}
          currentPhase={pipeline.phase}
          blocked={blocked}
          gateKinds={status.gates}
        />
      ) : (
        <StageStrip pipeline={pipeline} blocked={blocked} blocker={blocker} />
      )}

      <BudgetBar budget={status.budget} />

      <GuardrailsPanel
        guardrails={status.guardrails}
        blockedTransitions={status.transitions?.blocked}
      />

      {/* Missions + plans, summarized. Full mission detail lives in Runs · Missions. */}
      {(counts.length > 0 || pipeline.plan_status || plans.length > 0) && (
        <div className="flex items-center flex-wrap gap-1.5 text-xs text-[color:var(--mc-fg-3)]">
          {counts.map(([s, n]) => (
            <span key={s} className="px-1.5 py-0.5 rounded bg-[color:var(--mc-surface)]">
              {n} {s}
            </span>
          ))}
          {pipeline.plan_status && (
            <span className="px-1.5 py-0.5 rounded bg-[color:var(--mc-surface)]">
              plan: {pipeline.plan_status}
            </span>
          )}
          {plans.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-[color:var(--mc-surface)]">
              {plans.length} plan{plans.length === 1 ? '' : 's'}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
