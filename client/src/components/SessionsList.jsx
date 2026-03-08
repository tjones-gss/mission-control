import { Clock, Activity } from 'lucide-react'

function timeAgo(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function projectName(session) {
  const src = session.cwd || session.projectName || ''
  const parts = src.split(/[/\\]/).filter(Boolean)
  return parts[parts.length - 1] || session.slug || session.sessionId.slice(0, 8)
}

function modelShort(model) {
  if (!model) return null
  const parts = model.split('-')
  return parts.slice(-2).join('-')
}

function totalTokens(tokenUsage) {
  if (!tokenUsage) return null
  const t = (tokenUsage.input || 0) + (tokenUsage.output || 0)
  if (t === 0) return null
  return t >= 1000 ? `${(t / 1000).toFixed(1)}k` : String(t)
}

export function SessionsList({ sessions, selectedId, onSelect }) {
  if (!sessions) return <div className="p-4 text-gray-500">Loading...</div>

  return (
    <div className="flex flex-col gap-2 p-2 overflow-y-auto h-full">
      {sessions.map(s => {
        const isSelected = selectedId === s.sessionId
        const activeClasses = s.isActive
          ? 'border-green-800 shadow-[0_0_8px_rgba(74,222,128,0.2)]'
          : 'border-gray-800'
        const selectedClasses = isSelected
          ? 'bg-indigo-900/40 border-indigo-500'
          : `bg-gray-900 hover:border-gray-600 ${activeClasses}`

        return (
          <button
            key={s.sessionId}
            onClick={() => onSelect(s.sessionId)}
            className={`text-left p-3 rounded-lg border transition-all ${selectedClasses}`}
          >
            {/* Project name row */}
            <div className="flex items-center gap-2">
              {s.isActive && (
                <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
              )}
              <span className="text-sm font-medium text-gray-200 truncate">
                {projectName(s)}
              </span>
            </div>

            {/* Slug row */}
            {s.slug && (
              <div className="mt-0.5 text-xs text-gray-600 truncate font-mono">
                {s.slug}
              </div>
            )}

            {/* Meta row */}
            <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <Clock size={10} />
                {timeAgo(s.lastModified)}
              </span>
              <span className="flex items-center gap-1">
                <Activity size={10} />
                {s.agentTree?.subagents?.length || 0} agents
              </span>
            </div>

            {/* Footer: model + tokens */}
            {(s.model || s.tokenUsage) && (
              <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-700">
                {modelShort(s.model) && (
                  <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono text-[10px]">
                    {modelShort(s.model)}
                  </span>
                )}
                {totalTokens(s.tokenUsage) && (
                  <span className="text-gray-700">{totalTokens(s.tokenUsage)} tok</span>
                )}
              </div>
            )}
          </button>
        )
      })}
    </div>
  )
}
