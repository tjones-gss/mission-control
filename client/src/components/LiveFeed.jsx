import { useEffect, useRef } from 'react'
import { Zap } from 'lucide-react'

const EVENT_COLORS = {
  session_update: 'text-blue-400',
  new_session: 'text-green-400',
  task_update: 'text-yellow-400',
  team_update: 'text-purple-400',
  history_update: 'text-gray-400',
}

function describeEvent(evt) {
  const fp = evt.data?.filePath || ''

  switch (evt.type) {
    case 'session_update': {
      // filePath like: ~/.claude/projects/C--Users-foo-bar/session.jsonl
      const match = fp.replace(/\\/g, '/').match(/projects\/([^/]+)\//)
      const proj = match ? match[1].replace(/^[A-Z]--/, '').split('-').pop() : fp.split(/[/\\]/).pop()
      return `session updated · ${proj}`
    }
    case 'new_session': {
      const match = fp.replace(/\\/g, '/').match(/projects\/([^/]+)\//)
      const proj = match ? match[1].replace(/^[A-Z]--/, '').split('-').pop() : fp.split(/[/\\]/).pop()
      return `new session · ${proj}`
    }
    case 'task_update': {
      const file = fp.split(/[/\\]/).pop() || 'task'
      return `task changed · ${file}`
    }
    case 'team_update': {
      const match = fp.replace(/\\/g, '/').match(/teams\/([^/]+)\//)
      const team = match ? match[1] : fp.split(/[/\\]/).pop()
      return `team update · ${team}`
    }
    case 'history_update':
      return 'history updated'
    default:
      return evt.type
  }
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false })
}

export function LiveFeed({ events }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length])

  // Filter out heartbeats
  const visible = events.filter(e => e.type !== 'heartbeat')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800">
        <Zap size={12} className="text-yellow-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Live Feed</span>
        {visible.length > 0 && (
          <span className="ml-auto text-xs text-gray-700">{visible.length} events</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-xs">
        {visible.length === 0 && (
          <div className="text-gray-700 italic">Watching for changes...</div>
        )}
        {visible.map((evt, i) => {
          const color = EVENT_COLORS[evt.type] || 'text-gray-500'
          return (
            <div key={i} className="flex items-baseline gap-2">
              <span className="text-gray-700 shrink-0">{formatTime(evt.data.ts)}</span>
              <span className={`${color} shrink-0`}>{describeEvent(evt)}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
