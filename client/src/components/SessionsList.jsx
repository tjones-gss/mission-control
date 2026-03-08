import { Clock, Activity, FolderOpen } from 'lucide-react'

function timeAgo(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function SessionsList({ sessions, selectedId, onSelect }) {
  if (!sessions) return <div className="p-4 text-gray-500">Loading...</div>

  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto h-full">
      {sessions.map(s => (
        <button
          key={s.sessionId}
          onClick={() => onSelect(s.sessionId)}
          className={`text-left p-3 rounded-lg border transition-colors ${
            selectedId === s.sessionId
              ? 'bg-indigo-900/50 border-indigo-500'
              : 'bg-gray-900 border-gray-800 hover:border-gray-600'
          }`}
        >
          <div className="flex items-center gap-2">
            {s.isActive && (
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
            )}
            <span className="text-sm font-medium truncate">
              {s.slug || s.sessionId.slice(0, 8)}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {timeAgo(s.lastModified)}
            </span>
            <span className="flex items-center gap-1">
              <Activity size={10} />
              {s.agentTree?.subagents?.length || 0} subagents
            </span>
          </div>
          <div className="mt-1 text-xs text-gray-600 truncate">
            <FolderOpen size={10} className="inline mr-1" />
            {s.cwd?.split(/[/\\]/).pop() || s.projectName?.split('\\').pop() || '—'}
          </div>
        </button>
      ))}
    </div>
  )
}
