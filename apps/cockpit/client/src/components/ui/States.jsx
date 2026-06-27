import { Loader2, AlertCircle, RotateCw } from 'lucide-react'

// Shared loading / error surfaces so every data-fetching component degrades the
// same way — a spinner while loading, and a friendly error with a Retry button
// instead of a silently blank panel. --mc-* tokens only.

export function Spinner({ size = 16, className = '' }) {
  return (
    <Loader2
      size={size}
      className={`animate-spin text-[var(--mc-fg-4)] ${className}`}
      aria-hidden="true"
    />
  )
}

/**
 * Centered loading placeholder. Use in a flex/scroll container where a
 * data-fetch is in flight.
 */
export function LoadingState({ label = 'Loading…', className = '' }) {
  return (
    <div
      role="status"
      className={`flex flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--mc-fg-4)] ${className}`}
    >
      <Spinner size={18} />
      <span>{label}</span>
    </div>
  )
}

/**
 * Friendly error surface with an optional Retry button. Pass the useApi
 * `error` string as `message` and its `refetch` as `onRetry`.
 */
export function ErrorState({ message = 'Something went wrong.', onRetry, className = '' }) {
  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
    >
      <div className="flex items-center gap-2 text-sm text-[var(--mc-danger)]">
        <AlertCircle size={16} className="shrink-0" />
        <span className="max-w-sm break-words">{message}</span>
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--mc-border-2)] bg-[var(--mc-surface)] px-3 py-1.5 text-xs font-medium text-[var(--mc-fg-2)] transition-colors hover:bg-[var(--mc-surface-2)] hover:text-[var(--mc-fg)]"
        >
          <RotateCw size={12} /> Retry
        </button>
      )}
    </div>
  )
}
