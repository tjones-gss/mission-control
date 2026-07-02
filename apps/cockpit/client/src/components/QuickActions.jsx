import { useState, useCallback, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'

const DEFAULT_REPLIES = ['yes', 'continue', 'approve']

export function QuickActions({
  sessionId,
  onReply,
  replies = DEFAULT_REPLIES,
  options,
  suggestion,
}) {
  const [sending, setSending] = useState(null)
  const [error, setError] = useState(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error])

  const send = useCallback(
    async (message) => {
      setSending(message)
      setError(null)
      setStatus(`Sending ${message}`)
      try {
        const res = await fetch(`/api/sessions/${sessionId}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message,
            ...(options && Object.keys(options).some((k) => options[k]) ? { options } : {}),
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.detail || body.error || `HTTP ${res.status}`)
        }
        setStatus(`Sent ${message}`)
      } catch (e) {
        setError(message)
        setStatus(`Failed to send ${message}`)
      } finally {
        setSending(null)
      }
    },
    [sessionId],
  )

  return (
    <div
      className="mt-1.5 flex flex-wrap items-center gap-1.5"
      onClick={(e) => e.stopPropagation()}
    >
      <span className="sr-only" role="status" aria-live="polite">
        {status}
      </span>
      {/* Smart Triage suggestion — context-aware reply derived from the session
          transcript (see utils/suggestReply.js). Pre-filled for the user to send
          with one tap; never sent automatically. Accent-toned to stand apart from
          the generic chips. Uses --mc-* tokens per the client style rule. */}
      {suggestion && (
        <button
          type="button"
          title={`${suggestion} (suggested reply)`}
          disabled={sending !== null}
          onClick={() => {
            if (sending === null) send(suggestion)
          }}
          className="min-h-7 max-w-[260px] cursor-pointer truncate rounded border border-[var(--mc-accent-line)] px-2.5 py-1 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-30"
          style={
            error === suggestion
              ? { color: 'var(--mc-danger)', backgroundColor: 'var(--mc-danger-soft)' }
              : { color: 'var(--mc-accent)', backgroundColor: 'var(--mc-accent-soft)' }
          }
        >
          {sending === suggestion ? '...' : error === suggestion ? 'failed' : `✨ ${suggestion}`}
        </button>
      )}
      {replies.map((msg) => (
        <button
          key={msg}
          type="button"
          title={
            msg === 'yes'
              ? 'Approve (Y)'
              : msg === 'continue'
                ? 'Continue (C)'
                : `${msg.charAt(0).toUpperCase()}${msg.slice(1)}`
          }
          disabled={sending !== null}
          onClick={() => {
            if (sending === null) send(msg)
          }}
          className="min-h-7 cursor-pointer rounded border border-transparent px-2.5 py-1 text-[11px] transition-colors disabled:cursor-default disabled:opacity-30"
          style={
            error === msg
              ? { color: 'var(--mc-danger)', backgroundColor: 'var(--mc-danger-soft)' }
              : { color: 'var(--mc-warn)', backgroundColor: 'var(--mc-warn-soft)' }
          }
        >
          {sending === msg ? '...' : error === msg ? 'failed' : msg}
        </button>
      ))}
      {onReply && (
        <button
          type="button"
          title="Open reply composer"
          onClick={() => onReply(sessionId)}
          className="flex min-h-7 cursor-pointer items-center gap-1 rounded border border-[var(--mc-accent-line)] px-2.5 py-1 text-[11px] transition-colors"
          style={{ color: 'var(--mc-accent)', backgroundColor: 'var(--mc-accent-soft)' }}
        >
          <MessageSquare size={8} /> reply
        </button>
      )}
    </div>
  )
}
