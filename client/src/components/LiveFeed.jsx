import { useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'

const EVENT_LABELS = {
  session_update: { label: 'session updated', color: 'text-blue-400' },
  new_session: { label: 'new session', color: 'text-green-400' },
  task_update: { label: 'task changed', color: 'text-yellow-400' },
  team_update: { label: 'team update', color: 'text-purple-400' },
  history_update: { label: 'command run', color: 'text-gray-400' },
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

export function LiveFeed({ events }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <Zap size={12} className="text-yellow-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Feed</span>
        {events.length > 0 && (
          <span className="ml-auto text-xs text-gray-700">{events.length} events</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {events.length === 0 && (
          <div className="text-gray-700 italic">Watching for changes...</div>
        )}
        {events.map((evt, i) => {
          const cfg = EVENT_LABELS[evt.type] || { label: evt.type, color: 'text-gray-500' }
          return (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-gray-700 shrink-0">{formatTime(evt.data.ts)}</span>
              <span className={`${cfg.color} shrink-0`}>{cfg.label}</span>
              {evt.data.filePath && (
                <span className="text-gray-600 truncate">{evt.data.filePath.split(/[/\\]/).pop()}</span>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
