import { useEffect } from 'react'
import { AlertTriangle, Clock, DollarSign, Repeat, X } from 'lucide-react'

// I1 — non-blocking anomaly notifications. The server's deterministic detector
// emits an `anomaly` SSE event; App collects them into a list and renders this
// stack pinned top-right. Each toast auto-dismisses after 8s and opens the
// offending session's detail on click. Colours are --mc-* tokens only (no
// hardcoded hex / Tailwind palette) per the universal styling constraint.

const AUTO_DISMISS_MS = 8000

const KIND_META = {
  stall: { label: 'Stalled session', Icon: Clock },
  budget: { label: 'Budget overrun', Icon: DollarSign },
  loop: { label: 'Tool loop', Icon: Repeat },
  approval: { label: 'Approval waiting', Icon: Clock },
}

function ToastRow({ anomaly, onOpen, onDismiss }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss?.(anomaly.id), AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [anomaly.id, onDismiss])

  const meta = KIND_META[anomaly.kind] || { label: anomaly.kind, Icon: AlertTriangle }
  const { Icon } = meta

  return (
    <div
      data-testid="anomaly-toast"
      data-anomaly-kind={anomaly.kind}
      role="alert"
      onClick={() => onOpen?.(anomaly.sessionId)}
      className="pointer-events-auto flex w-80 max-w-[92vw] cursor-pointer items-start gap-2 rounded border px-3 py-2 text-xs shadow-lg transition-colors"
      style={{
        background: 'var(--mc-surface)',
        borderColor: 'var(--mc-warn)',
        color: 'var(--mc-fg)',
      }}
    >
      <Icon size={14} className="mt-0.5 shrink-0" style={{ color: 'var(--mc-warn)' }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium" style={{ color: 'var(--mc-warn)' }}>
          {meta.label}
        </div>
        <div className="mt-0.5 break-words" style={{ color: 'var(--mc-fg-2)' }}>
          {anomaly.detail}
        </div>
      </div>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={(e) => {
          e.stopPropagation()
          onDismiss?.(anomaly.id)
        }}
        className="shrink-0 transition-opacity hover:opacity-70"
        style={{ color: 'var(--mc-fg-4)' }}
      >
        <X size={12} />
      </button>
    </div>
  )
}

export function AnomalyToast({ anomalies = [], onOpen, onDismiss }) {
  if (!anomalies.length) return null
  return (
    <div className="pointer-events-none fixed right-3 top-3 z-toast flex flex-col gap-2">
      {anomalies.map((a) => (
        <ToastRow key={a.id} anomaly={a} onOpen={onOpen} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
