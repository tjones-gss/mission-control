import { AlertTriangle, Check, Clock, ExternalLink, X } from 'lucide-react'
import { Dialog } from './ui/Dialog.jsx'

function labelFor(anomaly) {
  return anomaly.kind
    ? anomaly.kind
        .split('_')
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join(' ')
    : 'Anomaly'
}

function timeFor(anomaly) {
  const value = anomaly.ts || anomaly.createdAt
  if (!value) return ''
  const date = typeof value === 'number' ? new Date(value) : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function AnomalyPanel({
  open,
  anomalies = [],
  onClose,
  onOpenSession,
  onAcknowledge,
  onResolve,
}) {
  if (!open) return null
  const sorted = [...anomalies].sort((a, b) => (b.ts || 0) - (a.ts || 0))
  return (
    <Dialog
      open
      placement="right"
      onClose={onClose}
      label="Anomalies"
      className="flex w-[min(26rem,92vw)] flex-col overflow-hidden border-l border-[var(--mc-border)] bg-[var(--mc-bg)] shadow-2xl"
      backdropClassName="bg-[var(--mc-bg)] opacity-60"
    >
      <div className="flex h-11 items-center gap-2 border-b border-[var(--mc-border)] px-3">
        <AlertTriangle size={15} className="text-[var(--mc-warn)]" />
        <span className="text-sm font-semibold text-[var(--mc-fg)]">Anomalies</span>
        <span className="rounded border border-[var(--mc-border)] bg-[var(--mc-surface)] px-1.5 py-0.5 text-[10px] text-[var(--mc-fg-4)]">
          {anomalies.filter((a) => a.state !== 'resolved').length} open
        </span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto rounded p-1 text-[var(--mc-fg-4)] transition-colors hover:text-[var(--mc-fg)]"
          aria-label="Close anomalies"
        >
          <X size={15} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {sorted.length === 0 ? (
          <div className="rounded border border-[var(--mc-border)] bg-[var(--mc-surface)] px-4 py-8 text-center text-xs text-[var(--mc-fg-4)]">
            No anomalies reported.
          </div>
        ) : (
          <div className="space-y-2">
            {sorted.map((anomaly) => {
              const resolved = anomaly.state === 'resolved'
              const acknowledged = anomaly.state === 'acknowledged'
              return (
                <article
                  key={anomaly.id}
                  data-testid="anomaly-panel-row"
                  className="rounded border bg-[var(--mc-surface)] p-3"
                  style={{
                    borderColor: resolved
                      ? 'var(--mc-border)'
                      : acknowledged
                        ? 'var(--mc-accent-line)'
                        : 'var(--mc-warn)',
                  }}
                >
                  <div className="flex items-start gap-2">
                    <Clock size={13} className="mt-0.5 shrink-0 text-[var(--mc-fg-4)]" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-xs font-semibold text-[var(--mc-fg)]">
                          {labelFor(anomaly)}
                        </h3>
                        <span className="rounded bg-[var(--mc-surface-2)] px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--mc-fg-4)]">
                          {anomaly.state || 'new'}
                        </span>
                      </div>
                      <p className="mt-1 break-words text-xs leading-relaxed text-[var(--mc-fg-2)]">
                        {anomaly.detail || anomaly.message || 'Review this session.'}
                      </p>
                      {timeFor(anomaly) && (
                        <div className="mt-1 text-[10px] text-[var(--mc-fg-5)]">
                          {timeFor(anomaly)}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-1.5">
                    {anomaly.sessionId && (
                      <button
                        type="button"
                        onClick={() => onOpenSession?.(anomaly.sessionId)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--mc-border)] px-2 py-1 text-[11px] text-[var(--mc-accent-2)] transition-colors hover:bg-[var(--mc-surface-2)]"
                      >
                        <ExternalLink size={11} /> Open
                      </button>
                    )}
                    {!acknowledged && !resolved && (
                      <button
                        type="button"
                        onClick={() => onAcknowledge?.(anomaly.id)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--mc-accent-line)] bg-[var(--mc-accent-soft)] px-2 py-1 text-[11px] text-[var(--mc-accent-2)]"
                      >
                        <Check size={11} /> Acknowledge
                      </button>
                    )}
                    {!resolved && (
                      <button
                        type="button"
                        onClick={() => onResolve?.(anomaly.id)}
                        className="inline-flex items-center gap-1 rounded border border-[var(--mc-border)] px-2 py-1 text-[11px] text-[var(--mc-fg-3)] transition-colors hover:bg-[var(--mc-surface-2)]"
                      >
                        <Check size={11} /> Resolve
                      </button>
                    )}
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </div>
    </Dialog>
  )
}
