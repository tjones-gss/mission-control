import { useState, useEffect, useCallback } from 'react'
import { Bot, Wrench, Shield, ChevronRight, ChevronDown, Copy, Check } from 'lucide-react'
import { QuickActions } from './QuickActions.jsx'
import { formatCost } from '../utils/cost.js'

const PERMISSION_BADGE = {
  bypassPermissions: { label: 'bypass', cls: 'bg-green-900/50 text-green-400 border-green-800' },
  dontAsk: { label: 'dontAsk', cls: 'bg-green-900/50 text-green-400 border-green-800' },
  acceptEdits: { label: 'acceptEdits', cls: 'bg-amber-900/50 text-amber-400 border-amber-800' },
  auto: { label: 'auto', cls: 'bg-amber-900/50 text-amber-400 border-amber-800' },
  plan: { label: 'plan', cls: 'bg-purple-900/50 text-purple-400 border-purple-800' },
  default: { label: 'default', cls: 'bg-gray-800 text-gray-500 border-gray-700' },
}

function getModelAbbr(model) {
  if (!model) return '—'
  const parts = model.split('-')
  if (parts.length < 2) return model
  return parts.slice(-2).join('-')
}

function getProjectSlug(cwd) {
  if (!cwd) return '—'
  const normalized = cwd.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] || '—'
}

function getTopTools(toolUseCounts, n = 3) {
  if (!toolUseCounts || typeof toolUseCounts !== 'object') return []
  return Object.entries(toolUseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

// Hidden-textarea fallback for environments where navigator.clipboard
// is unavailable (insecure contexts, denied permissions, older browsers).
function fallbackCopy(text) {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    ta.setAttribute('readonly', '')
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

function ResumeId({ sessionId }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(
    (e) => {
      e.stopPropagation()
      const cmd = `claude --resume ${sessionId}`
      const onCopied = () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }
      // navigator.clipboard requires a secure context (https or localhost)
      // and rejects on missing permissions. Fall back to a hidden textarea
      // + execCommand so this works even when clipboard isn't available.
      if (navigator.clipboard?.writeText) {
        navigator.clipboard
          .writeText(cmd)
          .then(onCopied)
          .catch(() => {
            fallbackCopy(cmd) && onCopied()
          })
      } else {
        if (fallbackCopy(cmd)) onCopied()
      }
    },
    [sessionId],
  )

  return (
    <div
      className="flex items-center gap-1 mt-1.5 px-1.5 py-1 rounded bg-gray-800/50 border border-gray-800 cursor-pointer hover:border-gray-700 transition-colors group"
      onClick={handleCopy}
      title="Click to copy resume command"
    >
      <span className="text-[10px] text-gray-600 shrink-0">resume:</span>
      <code className="text-[10px] text-gray-500 font-mono truncate group-hover:text-gray-400 transition-colors">
        {sessionId}
      </code>
      {copied ? (
        <Check size={10} className="shrink-0 text-green-500 ml-auto" />
      ) : (
        <Copy
          size={10}
          className="shrink-0 text-gray-700 group-hover:text-gray-500 ml-auto transition-colors"
        />
      )}
    </div>
  )
}

function SessionCard({ session, isSelected, onSelect }) {
  const slug = getProjectSlug(session.cwd)
  const modelAbbr = getModelAbbr(session.model)
  const topTools = getTopTools(session.toolUseCounts)
  const agentCount = session.agents?.length ?? 0

  return (
    <div
      onClick={() => onSelect(session.sessionId)}
      className={[
        'cursor-pointer rounded-lg border bg-gray-900 p-3 hover:bg-gray-800 transition-colors',
        isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-gray-800',
      ].join(' ')}
    >
      {/* Header row */}
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          {session.isActive && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-400" />
            </span>
          )}
          {session.needsInput && !session.isActive && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-400" />
            </span>
          )}
          <span className="text-sm font-medium text-gray-100 truncate">{slug}</span>
        </div>
        {session.permissionMode && PERMISSION_BADGE[session.permissionMode] && (
          <span
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${PERMISSION_BADGE[session.permissionMode].cls}`}
          >
            <Shield size={8} />
            {PERMISSION_BADGE[session.permissionMode].label}
          </span>
        )}
        <span className="text-xs text-gray-500 shrink-0 font-mono">{modelAbbr}</span>
      </div>

      {/* Last text */}
      {session.lastText && (
        <p className="text-xs text-gray-400 truncate mb-2 leading-snug">{session.lastText}</p>
      )}

      {/* Footer row */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Subagent count */}
        {agentCount > 0 && (
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <Bot size={11} />
            {agentCount}
          </span>
        )}

        {/* Tool pills */}
        {topTools.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {topTools.map(([tool, count]) => (
              <span
                key={tool}
                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs bg-gray-800 text-gray-400 border border-gray-700"
              >
                <Wrench size={9} className="shrink-0" />
                <span className="truncate max-w-[72px]">{tool}</span>
                <span className="text-gray-500 ml-0.5">{count}</span>
              </span>
            ))}
          </div>
        )}

        {/* Cost estimate */}
        {session.estimatedCost && (
          <span className="text-[10px] text-emerald-500 ml-auto shrink-0">
            {formatCost(session.estimatedCost.totalCost)}
          </span>
        )}
      </div>

      {/* Quick actions only for active sessions waiting for input */}
      {session.isActive && session.needsInput && (
        <QuickActions sessionId={session.sessionId} onReply={() => onSelect(session.sessionId)} />
      )}

      {/* Resume ID for inactive sessions */}
      {!session.isActive && <ResumeId sessionId={session.sessionId} />}
    </div>
  )
}

function Column({
  title,
  titleClass,
  sessions,
  selectedId,
  onSelect,
  emptyLabel,
  collapsible,
  collapsed,
  onToggle,
}) {
  return (
    <div className="flex flex-col min-w-0 flex-1">
      <div className="flex items-center justify-between mb-3 px-1">
        {collapsible ? (
          <button onClick={onToggle} className="flex items-center gap-1 group">
            {collapsed ? (
              <ChevronRight size={14} className={titleClass} />
            ) : (
              <ChevronDown size={14} className={titleClass} />
            )}
            <h3 className={`text-xs font-semibold uppercase tracking-wider ${titleClass}`}>
              {title}
            </h3>
          </button>
        ) : (
          <h3 className={`text-xs font-semibold uppercase tracking-wider ${titleClass}`}>
            {title}
          </h3>
        )}
        <span className="text-xs text-gray-500 font-mono">{sessions.length}</span>
      </div>
      {!collapsed && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="text-xs text-gray-500 italic px-1">{emptyLabel}</p>
          ) : (
            sessions.map((session) => (
              <SessionCard
                key={session.sessionId}
                session={session}
                isSelected={selectedId === session.sessionId}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function KanbanBoard({ sessions = [], selectedId, onSelect }) {
  const [doneCollapsed, setDoneCollapsed] = useState(true)
  const now = Date.now()
  const ONE_HOUR = 3_600_000

  const active = sessions.filter((s) => s.isActive === true)
  const idle = sessions.filter((s) => !s.isActive && s.lastModified > now - ONE_HOUR)
  const done = sessions.filter((s) => !s.isActive && s.lastModified <= now - ONE_HOUR)

  // Auto-expand Done column if selected session is in it
  useEffect(() => {
    if (selectedId && doneCollapsed && done.some((s) => s.sessionId === selectedId)) {
      setDoneCollapsed(false)
    }
  }, [selectedId, sessions])

  return (
    <div className="flex gap-4 h-full p-4 bg-gray-950 overflow-hidden">
      <Column
        title="Active"
        titleClass="text-green-400"
        sessions={active}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No active sessions"
      />
      <Column
        title="Idle"
        titleClass="text-amber-400"
        sessions={idle}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No idle sessions"
      />
      <Column
        title="Done"
        titleClass="text-gray-500"
        sessions={done}
        selectedId={selectedId}
        onSelect={onSelect}
        emptyLabel="No completed sessions"
        collapsible
        collapsed={doneCollapsed}
        onToggle={() => setDoneCollapsed((p) => !p)}
      />
    </div>
  )
}
