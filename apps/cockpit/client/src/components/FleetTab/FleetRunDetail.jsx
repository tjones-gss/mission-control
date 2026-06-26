import { useCallback } from 'react'
import { Layers, Loader2, AlertCircle } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { formatCost } from '../../utils/cost.js'
import { Markdown } from '../Markdown.jsx'
import { ChildCard } from './FleetRunCard.jsx'

// Run-level status pill styling.
export const RUN_STATUS = {
  running: { cls: 'bg-green-900/50 text-green-300', dot: 'bg-green-400' },
  succeeded: { cls: 'bg-emerald-900/50 text-emerald-300', dot: 'bg-emerald-400' },
  partial: { cls: 'bg-amber-900/50 text-amber-300', dot: 'bg-amber-400' },
  failed: { cls: 'bg-red-900/50 text-red-300', dot: 'bg-red-400' },
  cancelled: { cls: 'bg-gray-800 text-gray-400', dot: 'bg-gray-500' },
  budget_exceeded: { cls: 'bg-orange-900/50 text-orange-300', dot: 'bg-orange-400' },
}

function timeAgo(iso) {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const secs = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

// ──────────────────────────────────────────────────────────────────────────────
// Live run detail — run header + child grid + synthesis report.
// ──────────────────────────────────────────────────────────────────────────────
export function RunDetail({ runId, version, onOpenSession }) {
  // Full persisted run state. The fleetVersion bump (from a fleet_update SSE
  // event) is in deps so the run refetches in place when anything changes.
  const {
    data: run,
    loading,
    error,
  } = useApi(runId ? `/api/fleet/${runId}` : null, [runId, version])
  // Escalation list is read-only and refreshed on the same version bump.
  const { data: escData, refetch: refetchEsc } = useApi(
    runId ? `/api/fleet/${runId}/escalations` : null,
    [runId, version],
  )
  const escalations = escData?.escalations || []

  // Route a human decision through the fleet decision endpoint. Fleet adds no
  // new approval logic — POST /api/fleet/:id/decide dispatches to the EXISTING
  // write paths server-side: the in-memory SDK resolver for source 'tool' and
  // the harness CLI (`harness approve`) shelled in the child cwd for source
  // 'harness'. Both escalation sources are now resolvable from the UI.
  const decide = useCallback(
    async (escalation, decision) => {
      const payload = {
        childIdx: escalation.childIdx,
        source: escalation.source,
        decision,
      }
      // 'tool' decisions carry an approvalId; 'harness' decisions a requestId.
      if (escalation.source === 'harness') {
        payload.requestId = escalation.requestId || escalation.approvalId
      } else {
        payload.approvalId = escalation.approvalId || escalation.requestId
      }
      const res = await fetch(`/api/fleet/${runId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || body.detail || `HTTP ${res.status}`)
      }
      // Refresh the banner list — the resolved escalation should drop off.
      refetchEsc()
    },
    [runId, refetchEsc],
  )

  if (loading && !run) {
    return <div className="text-xs text-gray-500 italic p-4">Loading run…</div>
  }
  if (error) {
    return (
      <div className="text-xs text-red-400 p-4 flex items-center gap-1.5">
        <AlertCircle size={12} /> {error}
      </div>
    )
  }
  if (!run) return null

  const statusMeta = RUN_STATUS[run.status] || RUN_STATUS.running
  // Aggregate cost across children that report one.
  const totalCost = (run.children || []).reduce((sum, c) => {
    const v = c.cost && typeof c.cost.totalCost === 'number' ? c.cost.totalCost : 0
    return sum + v
  }, 0)
  // Budget bar: spentUsd / budgetRemaining come from the runner (recomputed on
  // every cost movement). Only shown when a budget cap is set on the run.
  const budgetUsd =
    run.policy && typeof run.policy.budgetUsd === 'number' ? run.policy.budgetUsd : null
  const spentUsd = typeof run.spentUsd === 'number' ? run.spentUsd : totalCost
  const budgetRemaining =
    typeof run.budgetRemaining === 'number'
      ? run.budgetRemaining
      : budgetUsd != null
        ? Math.max(0, budgetUsd - spentUsd)
        : null
  const budgetPct =
    budgetUsd != null && budgetUsd > 0 ? Math.min(100, (spentUsd / budgetUsd) * 100) : 0
  const budgetOver =
    run.status === 'budget_exceeded' || (budgetUsd != null && spentUsd >= budgetUsd)
  // Group escalations by child idx so each card shows its own.
  const escByChild = escalations.reduce((acc, e) => {
    ;(acc[e.childIdx] = acc[e.childIdx] || []).push(e)
    return acc
  }, {})
  const synthesis = run.synthesis || { status: 'pending' }

  return (
    <div className="p-4 space-y-4">
      {/* Run header */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <Layers size={15} className="text-indigo-400 shrink-0" />
          <span className="text-sm font-semibold text-gray-100">{run.goal}</span>
          <span
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium ${statusMeta.cls}`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />
            {run.status}
          </span>
          {budgetUsd == null && totalCost > 0 && (
            <span className="text-[11px] text-emerald-500 font-mono">{formatCost(totalCost)}</span>
          )}
          <span className="ml-auto text-[10px] text-gray-600">{timeAgo(run.createdAt)}</span>
        </div>

        {/* Budget bar — spent vs cap, with a remaining readout. */}
        {budgetUsd != null && (
          <div data-testid="fleet-budget-bar" className="mt-2.5">
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="text-gray-500">
                Budget{' '}
                <span className={budgetOver ? 'text-orange-400 font-semibold' : 'text-gray-400'}>
                  {formatCost(spentUsd)} / {formatCost(budgetUsd)}
                </span>
              </span>
              <span className={budgetOver ? 'text-orange-400 font-semibold' : 'text-gray-500'}>
                {budgetOver
                  ? 'budget exceeded'
                  : budgetRemaining != null
                    ? `${formatCost(budgetRemaining)} left`
                    : ''}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${budgetOver ? 'bg-orange-500' : 'bg-emerald-500'}`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Child grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {(run.children || []).map((child) => (
          <ChildCard
            key={child.idx}
            child={child}
            escalations={escByChild[child.idx] || []}
            onDecide={decide}
            onOpenSession={onOpenSession}
          />
        ))}
      </div>

      {/* Synthesis report */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-gray-500">Synthesis</span>
          <span className="text-[10px] text-gray-500">{synthesis.status}</span>
          {synthesis.status === 'running' && (
            <Loader2 size={12} className="text-indigo-400 animate-spin" />
          )}
        </div>
        {synthesis.status === 'done' && synthesis.summary ? (
          <div className="mt-2">
            <Markdown>{synthesis.summary}</Markdown>
          </div>
        ) : synthesis.status === 'skipped' ? (
          <div className="mt-2 text-[11px] text-gray-500 italic">
            {synthesis.summary || 'Synthesis skipped.'}
          </div>
        ) : (
          <div className="mt-2 text-[11px] text-gray-600 italic">
            Synthesis runs once all children settle.
          </div>
        )}
      </div>
    </div>
  )
}
