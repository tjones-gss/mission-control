import { useState, useCallback } from 'react'
import {
  X,
  Loader2,
  AlertCircle,
  GitBranch,
  Check,
  ShieldAlert,
  FolderGit2,
  Lock,
  ThumbsUp,
  ThumbsDown,
} from 'lucide-react'
import { formatCost } from '../../utils/cost.js'

// Per-child status pill styling. verifying = a verifier is reviewing the worker;
// rejected = a verifier rejected it and re-dispatch is exhausted; budget_skipped =
// never spawned because its projected cost would exceed the budget.
const CHILD_STATUS = {
  starting: { cls: 'text-indigo-300', dot: 'bg-indigo-400' },
  running: { cls: 'text-green-400', dot: 'bg-green-400' },
  escalated: { cls: 'text-amber-300', dot: 'bg-amber-400' },
  succeeded: { cls: 'text-emerald-400', dot: 'bg-emerald-500' },
  failed: { cls: 'text-red-400', dot: 'bg-red-500' },
  cancelled: { cls: 'text-gray-500', dot: 'bg-gray-600' },
  verifying: { cls: 'text-sky-300', dot: 'bg-sky-400' },
  rejected: { cls: 'text-rose-400', dot: 'bg-rose-500' },
  budget_skipped: { cls: 'text-orange-400', dot: 'bg-orange-500' },
}

const RISK_STYLE = {
  DESTRUCTIVE: 'bg-red-700 text-red-100',
  CODE_EXECUTION: 'bg-amber-800 text-amber-200',
  REQUIRES_REVIEW: 'bg-yellow-800 text-yellow-200',
  SAFE_READONLY: 'bg-green-800 text-green-200',
}

// Last path segment of a cwd (handles both / and \ separators) for a compact
// label on each child card.
function basename(cwd) {
  if (!cwd) return ''
  const parts = String(cwd).split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : cwd
}

// ──────────────────────────────────────────────────────────────────────────────
// Escalation banner — prominent Allow / Deny on a child card. Routes the human
// decision through POST /api/fleet/:id/decide (handled by onDecide), which the
// runner dispatches to the existing write paths. Fleet adds NO new approval
// logic — it only POSTs the decision; works for both 'tool' and 'harness'.
// ──────────────────────────────────────────────────────────────────────────────
function EscalationBanner({ escalation, onDecide }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const riskBadge = escalation.riskLevel ? RISK_STYLE[escalation.riskLevel] || null : null

  const decide = useCallback(
    async (decision) => {
      if (busy) return
      setBusy(true)
      setError(null)
      try {
        await onDecide(escalation, decision)
      } catch (e) {
        setError(e.message || 'failed')
      } finally {
        setBusy(false)
      }
    },
    [busy, onDecide, escalation],
  )

  return (
    <div className="mt-2 rounded-lg border border-red-600/70 bg-red-950/40 shadow-[0_0_12px_rgba(220,38,38,0.2)] p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert size={13} className="text-red-400 shrink-0" />
        <span className="text-[11px] font-semibold text-red-200">Escalation</span>
        {escalation.tool && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-800 text-gray-300">
            {escalation.tool}
          </span>
        )}
        {riskBadge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${riskBadge}`}>
            {escalation.riskLevel}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-gray-800 text-gray-500">
          {escalation.source}
        </span>
      </div>
      {escalation.command && (
        <pre className="mt-1.5 bg-gray-900 text-gray-400 text-[11px] font-mono p-1.5 rounded overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-all">
          {escalation.command}
        </pre>
      )}
      {error && <div className="mt-1.5 text-[11px] text-red-400">⚠ {error}</div>}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => decide('allow')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-green-700 text-white text-[11px] font-medium hover:bg-green-600 disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Allow
        </button>
        <button
          type="button"
          onClick={() => decide('deny')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-red-700 text-white text-[11px] font-medium hover:bg-red-600 disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          <X size={10} /> Deny
        </button>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Verdict list — one row per adversarial verification round on a worker. Each
// verdict is approve/reject + a reason; a reject means the verifier sent the
// worker back (bounded by policy.verify.maxRounds). Read-only: the verdict was
// produced server-side by an independent verifier child; the UI only renders it.
// ──────────────────────────────────────────────────────────────────────────────
function VerdictList({ verdicts }) {
  return (
    <div className="flex flex-col gap-1">
      {verdicts.map((v, i) => {
        const approved = v.verdict === 'approve'
        const reasons = Array.isArray(v.reasons) ? v.reasons.filter(Boolean) : []
        return (
          <div
            key={`${v.round}-${v.verifierSessionId || i}`}
            data-testid={`fleet-verdict-${i}`}
            className={[
              'rounded border px-2 py-1 text-[11px] flex items-start gap-1.5',
              approved
                ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300'
                : 'border-rose-800/60 bg-rose-950/30 text-rose-300',
            ].join(' ')}
          >
            {approved ? (
              <ThumbsUp size={11} className="shrink-0 mt-0.5" />
            ) : (
              <ThumbsDown size={11} className="shrink-0 mt-0.5" />
            )}
            <span className="flex-1 min-w-0 break-words">
              <span className="font-semibold uppercase tracking-wide">
                {approved ? 'approved' : 'rejected'}
              </span>
              {typeof v.round === 'number' && (
                <span className="text-gray-500 ml-1">round {v.round}</span>
              )}
              {reasons.length > 0 && <span className="text-gray-400"> — {reasons.join('; ')}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────────
// Child card — idx, cwd basename, branch/worktree, status pill, per-child cost,
// a link into the Agents/Inspect view, and (when escalated) an escalation banner.
// ──────────────────────────────────────────────────────────────────────────────
export function ChildCard({ child, escalations, onDecide, onOpenSession }) {
  const meta = CHILD_STATUS[child.status] || CHILD_STATUS.starting
  // Canonical session-cost shape ({ totalCost, breakdown, family }) — render the
  // total USD and, when present, the model family that produced it.
  const cost = child.cost && typeof child.cost.totalCost === 'number' ? child.cost.totalCost : null
  const family = child.cost && child.cost.family ? child.cost.family : null
  // A child is escalated if its status says so OR it has live escalations.
  const isEscalated = child.status === 'escalated' || escalations.length > 0

  return (
    <div
      data-testid={`fleet-child-${child.idx}`}
      className={[
        'rounded-lg border bg-gray-900/60 p-3 flex flex-col gap-2 min-w-0',
        isEscalated ? 'border-red-700/70' : 'border-gray-800',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono text-gray-600 shrink-0">#{child.idx}</span>
        <FolderGit2 size={13} className="text-indigo-400 shrink-0" />
        <span
          className="text-sm font-medium text-gray-100 truncate flex-1 min-w-0"
          title={child.cwd}
        >
          {basename(child.cwd)}
        </span>
        {child.quarantine && (
          <span
            data-testid={`fleet-quarantine-${child.idx}`}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-orange-900/50 text-orange-300 text-[9px] font-semibold uppercase tracking-wide shrink-0"
            title="Quarantined: best-effort read-only stance (advisory, not a sandbox)"
          >
            <Lock size={9} /> quarantine
          </span>
        )}
        <span className="flex items-center gap-1 shrink-0">
          <span className={`relative flex h-1.5 w-1.5 rounded-full ${meta.dot}`}>
            {(child.status === 'running' ||
              child.status === 'starting' ||
              child.status === 'verifying') && (
              <span className="absolute inset-0 rounded-full bg-current animate-ping opacity-60" />
            )}
          </span>
          <span className={`text-[10px] uppercase ${meta.cls}`}>{child.status}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-gray-500 min-w-0">
        <GitBranch size={11} className="shrink-0 text-gray-600" />
        <span className="font-mono truncate min-w-0" title={child.branch}>
          {child.branch || '—'}
        </span>
        {child.worktree && (
          <span className="px-1 py-0.5 rounded bg-gray-800 text-gray-500 text-[9px] shrink-0">
            worktree
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        {cost != null ? (
          <span className="text-emerald-500 font-mono">{formatCost(cost)}</span>
        ) : (
          <span className="text-gray-600 font-mono">—</span>
        )}
        {family != null && <span className="text-gray-600 font-mono">{family}</span>}
        {child.sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(child.sessionId)}
            className="ml-auto text-indigo-400 hover:text-indigo-300 transition-colors"
            title="Open this child session in the Agents view"
          >
            open session →
          </button>
        )}
      </div>

      {child.error && (
        <div className="text-[11px] text-red-400 flex items-start gap-1">
          <AlertCircle size={11} className="shrink-0 mt-0.5" />
          <span className="break-words min-w-0">{child.error}</span>
        </div>
      )}

      {Array.isArray(child.verdicts) && child.verdicts.length > 0 && (
        <VerdictList verdicts={child.verdicts} />
      )}

      {escalations.map((esc) => (
        <EscalationBanner
          key={`${esc.source}-${esc.approvalId || esc.requestId}`}
          escalation={esc}
          onDecide={onDecide}
        />
      ))}
    </div>
  )
}
