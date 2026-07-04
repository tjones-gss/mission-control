import { useState, useEffect } from 'react'
import { Clock, Activity, ChevronRight, ChevronDown, X, Shield } from 'lucide-react'
import { projectLabel } from '../utils/session.js'
import { formatCost } from '../utils/cost.js'
import { TokenBreakdownCompact } from './TokenBreakdown.jsx'
import { QuickActions } from './QuickActions.jsx'

const ONE_HOUR = 3_600_000

// bypassPermissions and dontAsk run with NO permission gating, so they're
// rendered in red to make the user stop and notice — these sessions can
// edit anything, run anything. Yellow = lighter footgun. Purple = plan-only.
const PERM_COLORS = {
  bypassPermissions: 'text-red-400',
  dontAsk: 'text-red-400',
  acceptEdits: 'text-amber-400',
  auto: 'text-amber-400',
  plan: 'text-purple-400',
  default: 'text-gray-500',
}

function timeAgo(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
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
      <span className={`text-xs font-semibold uppercase tracking-wider ${titleClass}`}>
        {title}
      </span>
      <span className="text-xs text-gray-500 ml-auto">{count}</span>
    </button>
  )
}

function SessionCard({ session, isSelected, onSelect, onMute, onReply }) {
  const activeClasses = session.isActive
    ? 'border-green-800 shadow-[0_0_8px_rgba(74,222,128,0.2)]'
    : 'border-gray-800'
  const selectedClasses = isSelected
    ? 'bg-indigo-900/40 border-indigo-500'
    : `bg-gray-900 hover:border-gray-600 ${activeClasses}`

  // Shorten the longer permission-mode labels so they don't push the
  // footer row past the (narrow) sidebar width. The full label is in
  // the title attribute below for hover discoverability.
  const PERM_SHORT = {
    bypassPermissions: 'bypass',
    acceptEdits: 'accept',
    dontAsk: 'dontAsk',
  }

  return (
    // A div (not a <button>): waiting cards contain their own interactive
    // controls (mute X, QuickActions), and nested buttons are invalid DOM.
    // Mouse users can click anywhere on the card; the project-name button
    // below is the keyboard/screen-reader affordance for opening it.
    <div
      data-session-card-id={session.sessionId}
      onClick={() => onSelect(session.sessionId)}
      className={`text-left p-3 rounded-lg border transition-all w-full min-w-0 cursor-pointer ${selectedClasses}`}
    >
      {/* Project name row — status dot matches the section color:
           green = active, amber = idle (recent OR waiting on input),
           gray = older / done. Pulse only on active or needs-input,
           steady on plain idle so it doesn't visually shout. */}
      <div className="flex items-center gap-2 min-w-0">
        {session.isActive && (
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse shrink-0" />
        )}
        {session.needsInput && !session.isActive && (
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
          </span>
        )}
        {!session.isActive &&
          !session.needsInput &&
          Date.now() - session.lastModified < ONE_HOUR && (
            <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
          )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onSelect(session.sessionId)
          }}
          className="text-sm font-medium text-gray-200 truncate min-w-0 flex-1 text-left"
        >
          {projectLabel(session)}
        </button>
        {session.needsInput && <span className="text-[10px] text-amber-400 shrink-0">Waiting</span>}
        {session.needsInput && onMute && (
          // ≥24px hit area (WCAG 2.5.8) around the small glyph; -m-1.5 keeps
          // the visual footprint unchanged inside the dense row.
          <span
            role="button"
            tabIndex={0}
            aria-label="Dismiss notification"
            onClick={(e) => {
              e.stopPropagation()
              onMute(session.sessionId)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                onMute(session.sessionId)
              }
            }}
            className="ml-auto p-1.5 -m-1.5 flex items-center justify-center text-gray-600 hover:text-gray-400 transition-colors shrink-0 cursor-pointer"
            title="Dismiss notification"
          >
            <X size={12} />
          </span>
        )}
      </div>

      {/* Summary row */}
      {(session.lastText || session.slug) && (
        <div className="mt-0.5 text-xs text-gray-500 line-clamp-2 leading-snug break-words">
          {session.lastText || session.slug}
        </div>
      )}

      {/* Meta row */}
      <div className="mt-1.5 flex items-center gap-3 text-xs text-gray-500 min-w-0">
        <span className="flex items-center gap-1 shrink-0">
          <Clock size={10} />
          {timeAgo(session.lastModified)}
        </span>
        <span className="flex items-center gap-1 shrink-0">
          <Activity size={10} />
          {session.agentTree?.subagents?.length || 0} agents
        </span>
      </div>

      {/* Footer: model + tokens + permission mode */}
      {(session.model || session.tokenUsage || session.permissionMode) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500 min-w-0">
          {modelShort(session.model) && (
            <span className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 font-mono text-[10px] shrink-0">
              {modelShort(session.model)}
            </span>
          )}
          <TokenBreakdownCompact tokenUsage={session.tokenUsage} model={session.model} />
          {session.permissionMode && PERM_COLORS[session.permissionMode] && (
            <span
              className={`flex items-center gap-0.5 shrink-0 ${PERM_COLORS[session.permissionMode]}`}
              title={session.permissionMode}
            >
              <Shield size={9} />
              <span className="text-[10px]">
                {PERM_SHORT[session.permissionMode] || session.permissionMode}
              </span>
            </span>
          )}
        </div>
      )}

      {/* Quick actions for waiting sessions */}
      {session.needsInput && !session.isActive && (
        <QuickActions sessionId={session.sessionId} onReply={onReply} />
      )}
    </div>
  )
}

export function SessionsList({ sessions, selectedId, onSelect, onMuteSession, onReplySession }) {
  const [collapsed, setCollapsed] = useState({ active: false, recent: false, older: true })

  const now = Date.now()
  const safeSessions = sessions || []
  const active = safeSessions.filter((s) => s.isActive === true)
  const recent = safeSessions.filter((s) => !s.isActive && s.lastModified > now - ONE_HOUR)
  const older = safeSessions.filter((s) => !s.isActive && s.lastModified <= now - ONE_HOUR)

  // Auto-expand collapsed group if selected session is inside it
  useEffect(() => {
    if (!selectedId) return
    setCollapsed((prev) => {
      const next = { ...prev }
      if (prev.older && older.some((s) => s.sessionId === selectedId)) next.older = false
      if (prev.recent && recent.some((s) => s.sessionId === selectedId)) next.recent = false
      if (prev.active && active.some((s) => s.sessionId === selectedId)) next.active = false
      return next
    })
  }, [selectedId, sessions])

  if (!sessions) return <div className="p-4 text-gray-500">Loading...</div>

  if (sessions.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-xs">
        No sessions yet — start a Claude Code session to see it here.
      </div>
    )
  }

  const toggle = (key) => setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))

  const groups = [
    { key: 'active', title: 'Active', titleClass: 'text-green-400', items: active },
    { key: 'recent', title: 'Recent', titleClass: 'text-amber-400', items: recent },
    { key: 'older', title: 'Older', titleClass: 'text-gray-500', items: older },
  ]

  return (
    <div className="flex flex-col gap-1 p-2 overflow-y-auto h-full">
      {groups.map((group) => {
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
                {group.items.map((s) => (
                  <SessionCard
                    key={s.sessionId}
                    session={s}
                    isSelected={selectedId === s.sessionId}
                    onSelect={onSelect}
                    onMute={onMuteSession}
                    onReply={onReplySession}
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
