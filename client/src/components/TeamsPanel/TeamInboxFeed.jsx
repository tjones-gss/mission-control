import { useEffect, useRef, useState } from 'react'
import { Check, Archive } from 'lucide-react'

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function TeamInboxFeed({ teamName, messages, onUpdate }) {
  const bottomRef = useRef(null)
  const [paused, setPaused] = useState(false)

  const active = messages
    .filter(m => !m.archived)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  const archived = messages.filter(m => m.archived)

  useEffect(() => {
    if (!paused && bottomRef.current?.scrollIntoView) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [active.length, paused])

  async function patchMessage(id, updates) {
    try {
      const res = await fetch(`/api/teams/${teamName}/inbox/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
      if (res.ok) onUpdate?.()
    } catch (err) {
      console.error('Failed to update message:', err)
    }
  }

  if (!active.length && !archived.length) {
    return <div className="flex-1 flex items-center justify-center text-xs text-gray-700">No messages yet</div>
  }

  return (
    <div
      className="flex-1 overflow-y-auto p-3 space-y-2"
      onScroll={e => {
        const el = e.currentTarget
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        setPaused(!atBottom)
      }}
    >
      {active.map(msg => (
        <div
          key={msg.id}
          className={`group rounded-lg px-3 py-2 text-xs ${msg.read ? 'bg-gray-900' : 'bg-gray-900 border border-gray-700'}`}
        >
          <div className="flex items-center gap-2 mb-1">
            <span className="text-gray-500 font-medium">{msg.sender}</span>
            <span className="text-gray-700">{formatTime(msg.timestamp)}</span>
            {!msg.read && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 ml-auto" />}
            <div className="ml-auto flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {!msg.read && (
                <button
                  onClick={() => patchMessage(msg.id, { read: true })}
                  title="Mark as read"
                  className="text-gray-600 hover:text-gray-300 transition-colors"
                >
                  <Check size={11} />
                </button>
              )}
              <button
                onClick={() => patchMessage(msg.id, { archived: true })}
                title="Archive"
                className="text-gray-600 hover:text-gray-300 transition-colors"
              >
                <Archive size={11} />
              </button>
            </div>
          </div>
          <p className="text-gray-300 leading-relaxed">{msg.content}</p>
        </div>
      ))}

      {archived.length > 0 && (
        <details className="mt-4">
          <summary className="text-xs text-gray-700 cursor-pointer hover:text-gray-500">
            {archived.length} archived
          </summary>
          <div className="mt-2 space-y-2">
            {archived.map(msg => (
              <div key={msg.id} className="rounded-lg px-3 py-2 text-xs bg-gray-900 opacity-50">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-gray-500">{msg.sender}</span>
                  <span className="text-gray-700">{formatTime(msg.timestamp)}</span>
                </div>
                <p className="text-gray-400">{msg.content}</p>
              </div>
            ))}
          </div>
        </details>
      )}

      <div ref={bottomRef} />
    </div>
  )
}
