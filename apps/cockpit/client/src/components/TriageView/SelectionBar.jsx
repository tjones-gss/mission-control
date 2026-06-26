import { useState, useEffect, useCallback } from 'react'
import { Send, X, Loader2 } from 'lucide-react'

// The dispatch verb, folded into the Triage multi-select. Appears at the bottom
// of TriageView whenever 1+ session cards are checked. Broadcasts one message to
// every selected session via the real /api/sessions/:id/message write path — the
// same call the retired DispatchDrawer used. On full success it calls onClear so
// the bar dismisses and the cards deselect; a partial failure keeps the bar up so
// the user can retry. --mc-* tokens only.
export function SelectionBar({ selectedIds = [], onClear = () => {} }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [failedCount, setFailedCount] = useState(0)
  const count = selectedIds.length

  // Escape clears the selection (only when idle — don't drop a send in flight).
  useEffect(() => {
    if (count === 0) return
    const handler = (e) => {
      if (e.key === 'Escape' && !sending) {
        e.preventDefault()
        onClear()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [count, sending, onClear])

  const sendToAll = useCallback(async () => {
    const message = text.trim()
    if (!message || count === 0 || sending) return
    setSending(true)
    setFailedCount(0)

    const results = await Promise.allSettled(
      selectedIds.map((id) =>
        fetch(`/api/sessions/${id}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            throw new Error(body.detail || body.error || `HTTP ${r.status}`)
          }
        }),
      ),
    )

    const failed = results.filter((r) => r.status === 'rejected').length
    setSending(false)
    if (failed === 0) {
      setText('')
      onClear()
    } else {
      setFailedCount(failed)
    }
  }, [text, selectedIds, count, sending, onClear])

  if (count === 0) return null

  return (
    <div
      className="sticky bottom-0 mt-6 flex items-center gap-3 rounded-xl border border-[var(--mc-accent-line)] bg-[var(--mc-surface)] px-4 py-3 shadow-lg"
      role="region"
      aria-label="Selection actions"
    >
      <span className="shrink-0 text-sm font-semibold text-[var(--mc-fg)]">
        {count} {count === 1 ? 'session' : 'sessions'} selected
      </span>
      {failedCount > 0 && (
        <span className="shrink-0 text-xs font-medium text-[var(--mc-danger)]">
          {failedCount} failed
        </span>
      )}
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            sendToAll()
          }
        }}
        disabled={sending}
        placeholder="Send message to all selected..."
        className="flex-1 rounded-lg border border-[var(--mc-border)] bg-[var(--mc-bg)] px-3 py-1.5 text-sm text-[var(--mc-fg)] placeholder-[var(--mc-fg-4)] focus:border-[var(--mc-accent)] focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        onClick={sendToAll}
        disabled={!text.trim() || sending}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--mc-accent)] px-4 py-1.5 text-sm font-medium text-[var(--mc-on-accent)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
        {sending ? 'Sending…' : 'Send'}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={sending}
        aria-label="Clear selection"
        title="Clear selection (Esc)"
        className="shrink-0 rounded-lg p-1.5 text-[var(--mc-fg-4)] transition-colors hover:text-[var(--mc-fg)] disabled:opacity-30"
      >
        <X size={16} />
      </button>
    </div>
  )
}
