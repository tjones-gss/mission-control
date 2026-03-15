import { useState, useEffect } from 'react'
import { Clock, Activity, ChevronRight, ChevronDown } from 'lucide-react'

const ONE_HOUR = 3_600_000

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

function SectionHeader({ title, count, collapsed, onToggle, titleClass }) {
  const Chevron = collapsed ? ChevronRight : ChevronDown
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full px-1 py-1.5 text-left hover:bg-gray-900/50 rounded transition-colors"
    >
      <Chevron size={12} className="text-gray-600 shrink-0" />
      <span className={`text-xs font-semibold uppercase tracking-wider ${titleClass}`}>{title}</span>
      <span className="text-xs text-gray-700 ml-auto">{count}</span>
    </button>
  )
}

function SessionCard({ session, isSelected, onSelect }) {
  const activeClasses = session.isActive
    ? 'border-green-800 shadow-[0_0_8px_rgba(74,222,128,0.2)]'
    : 'border-gray-800'
  const selectedClasses = isSelected
    ? 'bg-indigo-900/40 border-indigo-500'
    : `bg-gray-900 hover:border-gray-600 ${activeClasses}`

  return (
    <button
      onClick={() => onSelect(session.sessionId)}
      className={`text-left p-3 rounded-lg border transition-all ${selectedClasses}`}
    >
      {/* Project name row */}
      <div className="flex items-center gap-2">
        {session.isActive && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        )}
        {session.needsInput && !session.isActive && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
          </span>
        )}
        <span className="text-sm font-medium text-gray-200 truncate">
          {projectName(session)}
        </span>
        {session.needsInput && (
          <span className="text-[10px] text-amber-400 shrink-0">Waiting</span>
        )}
      </div>

      {/* Summary row */}
      {(session.lastText || session.slug) && (
        <div className="mt-0.5 text-xs text-gray-500 line-clamp-2 leading-snug">
          {session.lastText || session.slug}
        </div>
      )}

      {/* Meta row */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Clock size={10} />
          {timeAgo(session.lastModified)}
        </span>
        <span className="flex items-center gap-1">
          <Activity size={10} />
          {session.agentTree?.subagents?.length || 0} agents
        </span>
      </div>

      {/* Footer: model + tokens */}
      {(session.model || session.tokenUsage) && (
        <div className="mt-1.5 flex items-center gap-2 text-xs text-gray-700">
          {modelShort(session.model) && (
            <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono text-[10px]">
              {modelShort(session.model)}
            </span>
          )}
          {totalTokens(session.tokenUsage) && (
            <span className="text-gray-700">{totalTokens(session.tokenUsage)} tok</span>
          )}
        </div>
      )}
    </button>
  )
}

export function SessionsList({ sessions, selectedId, onSelect }) {
  const [collapsed, setCollapsed] = useState({ active: false, recent: false, older: true })

  if (!sessions) return <div className="p-4 text-gray-500">Loading...</div>

  const now = Date.now()
  const active = sessions.filter(s => s.isActive === true)
  const recent = sessions.filter(s => !s.isActive && s.lastModified > now - ONE_HOUR)
  const older = sessions.filter(s => !s.isActive && s.lastModified <= now - ONE_HOUR)

  // Auto-expand collapsed group if selected session is inside it
  const toggle = key => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }))

  // Check if selected session is in a collapsed group and expand it
  useEffect(() => {
    if (!selectedId) return
    if (collapsed.older && older.some(s => s.sessionId === selectedId)) {
      setCollapsed(prev => ({ ...prev, older: false }))
    }
    if (collapsed.recent && recent.some(s => s.sessionId === selectedId)) {
      setCollapsed(prev => ({ ...prev, recent: false }))
    }
    if (collapsed.active && active.some(s => s.sessionId === selectedId)) {
      setCollapsed(prev => ({ ...prev, active: false }))
    }
  }, [selectedId])

  const groups = [
    { key: 'active', title: 'Active', titleClass: 'text-green-400', items: active },
    { key: 'recent', title: 'Recent', titleClass: 'text-amber-400', items: recent },
    { key: 'older', title: 'Older', titleClass: 'text-gray-500', items: older },
  ]

  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto h-full">
      {groups.map(group => {
        if (group.items.length === 0) return null
        return (
          <div key={group.key}>
            <SectionHeader
              title={group.title}
              count={group.items.length}
              collapsed={collapsed[group.key]}
              onToggle={() => toggle(group.key)}
              titleClass={group.titleClass}
            />
            {!collapsed[group.key] && (
              <div className="flex flex-col gap-2 mt-1">
                {group.items.map(s => (
                  <SessionCard
                    key={s.sessionId}
                    session={s}
                    isSelected={selectedId === s.sessionId}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
