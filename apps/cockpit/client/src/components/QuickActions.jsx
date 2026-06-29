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

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error])

  const send = useCallback(
    async (message) => {
      setSending(message)
      setError(null)
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
      } catch (e) {
        setError(message)
      } finally {
        setSending(null)
      }
    },
    [sessionId],
  )

  return (
    <div className="flex items-center gap-1 mt-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      {/* Smart Triage suggestion — context-aware reply derived from the session
          transcript (see utils/suggestReply.js). Pre-filled for the user to send
          with one tap; never sent automatically. Accent-toned to stand apart from
          the generic chips. Uses --mc-* tokens per the client style rule. */}
      {suggestion && (
        <button
          type="button"
          title={suggestion}
          disabled={sending !== null}
          onClick={() => {
            if (sending === null) send(suggestion)
          }}
          className="px-1.5 py-0.5 rounded text-[10px] max-w-[260px] truncate transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
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
          disabled={sending !== null}
          onClick={() => {
            if (sending === null) send(msg)
          }}
          className="px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-default"
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
          onClick={() => onReply(sessionId)}
          className="px-1.5 py-0.5 rounded text-[10px] transition-colors flex items-center gap-0.5 cursor-pointer"
          style={{ color: 'var(--mc-accent)', backgroundColor: 'var(--mc-accent-soft)' }}
        >
          <MessageSquare size={8} /> reply
        </button>
      )}
    </div>
  )
}
