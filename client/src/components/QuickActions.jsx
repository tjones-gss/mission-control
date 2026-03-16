import { useState, useCallback, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'

const DEFAULT_REPLIES = ['yes', 'continue', 'approve']

export function QuickActions({ sessionId, onReply, replies = DEFAULT_REPLIES, options }) {
  const [sending, setSending] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 3000)
    return () => clearTimeout(t)
  }, [error])

  const send = useCallback(async (message) => {
    setSending(message)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, ...(options && Object.keys(options).some(k => options[k]) ? { options } : {}) }),
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
  }, [sessionId])

  return (
    <div className="flex items-center gap-1 mt-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
      {replies.map(msg => (
        <span
          key={msg}
          role="button"
          tabIndex={0}
          onClick={() => { if (sending === null) send(msg) }}
          onKeyDown={e => { if (e.key === 'Enter' && sending === null) send(msg) }}
          className={`px-1.5 py-0.5 rounded text-[10px] transition-colors cursor-pointer ${
            error === msg
              ? 'bg-red-900/50 text-red-300'
              : 'bg-amber-900/40 text-amber-300 hover:bg-amber-800/60'
          } ${sending !== null ? 'opacity-30 pointer-events-none' : ''}`}
        >
          {sending === msg ? '...' : error === msg ? 'failed' : msg}
        </span>
      ))}
      {onReply && (
        <span
          role="button"
          tabIndex={0}
          onClick={() => onReply(sessionId)}
          onKeyDown={e => { if (e.key === 'Enter') onReply(sessionId) }}
          className="px-1.5 py-0.5 rounded bg-indigo-900/40 text-indigo-300 text-[10px] hover:bg-indigo-800/60 transition-colors flex items-center gap-0.5 cursor-pointer"
        >
          <MessageSquare size={8} /> reply
        </span>
      )}
    </div>
  )
}
