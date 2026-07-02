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
  starting: { cls: 'text-[var(--mc-accent-2)]', dot: 'bg-[var(--mc-accent)]' },
  running: { cls: 'text-[var(--mc-ok)]', dot: 'bg-[var(--mc-ok)]' },
  escalated: { cls: 'text-[var(--mc-warn)]', dot: 'bg-[var(--mc-warn)]' },
  succeeded: { cls: 'text-[var(--mc-ok)]', dot: 'bg-[var(--mc-ok)]' },
  failed: { cls: 'text-[var(--mc-danger)]', dot: 'bg-[var(--mc-danger)]' },
  cancelled: { cls: 'text-[var(--mc-fg-4)]', dot: 'bg-[var(--mc-fg-5)]' },
  verifying: { cls: 'text-[var(--mc-info)]', dot: 'bg-[var(--mc-info)]' },
  rejected: { cls: 'text-[var(--mc-danger)]', dot: 'bg-[var(--mc-danger)]' },
  budget_skipped: { cls: 'text-[var(--mc-warn)]', dot: 'bg-[var(--mc-warn)]' },
}

const RISK_STYLE = {
  DESTRUCTIVE: 'bg-[var(--mc-danger-soft)] text-[var(--mc-danger)]',
  CODE_EXECUTION: 'bg-[var(--mc-warn-soft)] text-[var(--mc-warn)]',
  REQUIRES_REVIEW: 'bg-[var(--mc-warn-soft)] text-[var(--mc-warn)]',
  SAFE_READONLY: 'bg-[var(--mc-ok-soft)] text-[var(--mc-ok)]',
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
    <div className="mt-2 rounded-lg border border-[var(--mc-danger)] bg-[var(--mc-danger-soft)] p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert size={13} className="text-[var(--mc-danger)] shrink-0" />
        <span className="text-[11px] font-semibold text-[var(--mc-danger)]">Escalation</span>
        {escalation.tool && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[var(--mc-surface)] text-[var(--mc-fg-3)]">
            {escalation.tool}
          </span>
        )}
        {riskBadge && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${riskBadge}`}>
            {escalation.riskLevel}
          </span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide bg-[var(--mc-surface)] text-[var(--mc-fg-4)]">
          {escalation.source}
        </span>
      </div>
      {escalation.command && (
        <pre className="mt-1.5 bg-[var(--mc-bg)] text-[var(--mc-fg-3)] text-[11px] font-mono p-1.5 rounded overflow-x-auto max-h-20 overflow-y-auto whitespace-pre-wrap break-all">
          {escalation.command}
        </pre>
      )}
      {error && <div className="mt-1.5 text-[11px] text-[var(--mc-danger)]">! {error}</div>}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={() => decide('allow')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-[var(--mc-ok)] text-[var(--mc-bg)] text-[11px] font-medium hover:opacity-90 disabled:opacity-40 transition-colors flex items-center gap-1"
        >
          {busy ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />} Allow
        </button>
        <button
          type="button"
          onClick={() => decide('deny')}
          disabled={busy}
          className="px-2.5 py-1 rounded bg-[var(--mc-danger)] text-[var(--mc-bg)] text-[11px] font-medium hover:opacity-90 disabled:opacity-40 transition-colors flex items-center gap-1"
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
                ? 'border-[var(--mc-ok)] bg-[var(--mc-ok-soft)] text-[var(--mc-ok)]'
                : 'border-[var(--mc-danger)] bg-[var(--mc-danger-soft)] text-[var(--mc-danger)]',
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
                <span className="text-[var(--mc-fg-4)] ml-1">round {v.round}</span>
              )}
              {reasons.length > 0 && (
                <span className="text-[var(--mc-fg-3)]"> - {reasons.join('; ')}</span>
              )}
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
        'rounded-lg border bg-[var(--mc-surface)] p-3 flex flex-col gap-2 min-w-0',
        isEscalated ? 'border-[var(--mc-danger)]' : 'border-[var(--mc-border)]',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-[10px] font-mono text-[var(--mc-fg-5)] shrink-0">#{child.idx}</span>
        <FolderGit2 size={13} className="text-[var(--mc-accent-2)] shrink-0" />
        <span
          className="text-sm font-medium text-[var(--mc-fg)] truncate flex-1 min-w-0"
          title={child.cwd}
        >
          {basename(child.cwd)}
        </span>
        {child.quarantine && (
          <span
            data-testid={`fleet-quarantine-${child.idx}`}
            className="flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-[var(--mc-warn-soft)] text-[var(--mc-warn)] text-[9px] font-semibold uppercase tracking-wide shrink-0"
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
              <span className="absolute inset-0 rounded-full bg-current motion-safe:animate-pulse opacity-60" />
            )}
          </span>
          <span className={`text-[10px] uppercase ${meta.cls}`}>{child.status}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 text-[11px] text-[var(--mc-fg-4)] min-w-0">
        <GitBranch size={11} className="shrink-0 text-[var(--mc-fg-5)]" />
        <span className="font-mono truncate min-w-0" title={child.branch}>
          {child.branch || '—'}
        </span>
        {child.worktree && (
          <span className="px-1 py-0.5 rounded bg-[var(--mc-surface-2)] text-[var(--mc-fg-4)] text-[9px] shrink-0">
            worktree
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px]">
        {cost != null ? (
          <span className="text-[var(--mc-ok)] font-mono">{formatCost(cost)}</span>
        ) : (
          <span className="text-[var(--mc-fg-5)] font-mono">—</span>
        )}
        {family != null && <span className="text-[var(--mc-fg-5)] font-mono">{family}</span>}
        {child.sessionId && (
          <button
            type="button"
            onClick={() => onOpenSession(child.sessionId)}
            className="ml-auto text-[var(--mc-accent-2)] hover:text-[var(--mc-accent)] transition-colors"
            title="Open this child session in the Agents view"
          >
            open session →
          </button>
        )}
      </div>

      {child.error && (
        <div className="text-[11px] text-[var(--mc-danger)] flex items-start gap-1">
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
