import { useEffect } from 'react'
import { CheckCircle2, AlertTriangle, X } from 'lucide-react'

const TONE = {
  success: {
    wrap: 'bg-emerald-950/80 border-emerald-800 text-emerald-100',
    icon: <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />,
  },
  error: {
    wrap: 'bg-red-950/80 border-red-800 text-red-100',
    icon: <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />,
  },
}

// Lightweight, self-dismissing toast pinned to the bottom-right of the detail
// pane. No external toast lib in this app, so we keep it minimal + native.
export function Toast({ toast, onDismiss }) {
  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => onDismiss?.(), toast.duration ?? 6000)
    return () => clearTimeout(t)
  }, [toast, onDismiss])

  if (!toast) return null
  const tone = TONE[toast.tone] || TONE.success

  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-40 flex justify-end">
      <div
        role="status"
        className={`pointer-events-auto flex items-start gap-2 max-w-sm px-3 py-2 rounded border shadow-lg text-xs ${tone.wrap}`}
      >
        {tone.icon}
        <div className="min-w-0 whitespace-pre-wrap break-words">{toast.message}</div>
        <button
          onClick={() => onDismiss?.()}
          aria-label="Dismiss"
          className="ml-1 text-current/70 hover:text-current transition-colors"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  )
}
