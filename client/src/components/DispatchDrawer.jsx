import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import {
  X,
  Send,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CheckSquare,
  Square,
  Layers,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { formatCost } from '../utils/cost.js'

const STATUS_LABEL = {
  active: { cls: 'text-green-400', dot: 'bg-green-400' },
  needsInput: { cls: 'text-amber-400', dot: 'bg-amber-400' },
  idle: { cls: 'text-gray-400', dot: 'bg-gray-500' },
  done: { cls: 'text-gray-600', dot: 'bg-gray-700' },
}

function getStatus(child) {
  if (child.isActive) return 'active'
  if (child.needsInput) return 'needsInput'
  const idleWindow = 60 * 60 * 1000
  if (Date.now() - child.lastModified < idleWindow) return 'idle'
  return 'done'
}

function ChildRow({ child, selected, onToggle, dispatchState }) {
  const status = getStatus(child)
  const meta = STATUS_LABEL[status]
  const pending = dispatchState?.status === 'pending'
  const ok = dispatchState?.status === 'ok'
  const failed = dispatchState?.status === 'failed'
  // Strip leading/trailing whitespace and collapse newlines so the
  // preview stays single-line. lastText is the last assistant text
  // block from the session's JSONL — exactly what the dispatcher needs
  // to know "what was this session last doing?" before sending input.
  const preview = (child.lastText || '').replace(/\s+/g, ' ').trim()

  return (
    <button
      type="button"
      onClick={onToggle}
      title={child.lastText || child.slug}
      className={[
        'w-full flex flex-col gap-1 px-2 py-1.5 rounded text-left transition-colors min-w-0',
        selected
          ? 'bg-indigo-900/30 border border-indigo-700'
          : 'border border-transparent hover:bg-gray-800/60',
      ].join(' ')}
    >
      <div className="flex items-center gap-2 min-w-0">
        {selected ? (
          <CheckSquare size={14} className="shrink-0 text-indigo-400" />
        ) : (
          <Square size={14} className="shrink-0 text-gray-600" />
        )}
        <span className={`relative flex h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`}>
          {status === 'active' && (
            <span className="absolute inset-0 rounded-full bg-green-400 animate-ping opacity-75" />
          )}
        </span>
        <span className="text-sm text-gray-200 truncate flex-1 min-w-0">{child.slug}</span>
        <span className={`text-[10px] uppercase ${meta.cls} shrink-0`}>{status}</span>
        {child.estimatedCost && (
          <span className="text-[10px] text-emerald-500 font-mono shrink-0">
            {formatCost(child.estimatedCost.totalCost)}
          </span>
        )}
        {pending && <Loader2 size={12} className="shrink-0 text-indigo-400 animate-spin" />}
        {ok && <Check size={12} className="shrink-0 text-green-400" />}
        {failed && <AlertCircle size={12} className="shrink-0 text-red-400" />}
      </div>
      {preview && (
        // Indent under the checkbox + status dot so the preview lines up
        // with the slug above. truncate keeps it to a single line — full
        // text is in the title attribute on hover.
        <div className="pl-[26px] text-[11px] text-gray-500 truncate min-w-0">{preview}</div>
      )}
    </button>
  )
}

function ManagerCard({
  manager,
  selectedIds,
  onToggleChild,
  onSelectAll,
  onClearAll,
  dispatchState,
  expanded,
  onToggleExpanded,
}) {
  const allSelected = manager.children.every((c) => selectedIds.has(c.sessionId))
  const anySelected = manager.children.some((c) => selectedIds.has(c.sessionId))

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-800/40 transition-colors rounded-t-lg"
      >
        {expanded ? (
          <ChevronDown size={14} className="text-gray-500" />
        ) : (
          <ChevronRight size={14} className="text-gray-500" />
        )}
        <Layers size={13} className="text-indigo-400 shrink-0" />
        <span className="text-sm font-medium text-gray-100 truncate flex-1 text-left">
          {manager.slug}
        </span>
        <span className="text-[10px] text-gray-500 truncate hidden md:inline">{manager.dir}</span>
        <span className="text-xs text-gray-500 font-mono shrink-0 ml-2">{manager.childCount}</span>
        {manager.activeCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-green-400 shrink-0 ml-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {manager.activeCount}
          </span>
        )}
        {manager.needsInputCount > 0 && (
          <span className="text-[10px] text-amber-400 shrink-0 ml-1">
            {manager.needsInputCount} waiting
          </span>
        )}
        {manager.totalCost > 0 && (
          <span className="text-[10px] text-emerald-500 font-mono shrink-0 ml-2">
            {formatCost(manager.totalCost)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-2 pb-2 space-y-1">
          <div className="flex items-center gap-2 px-1 pt-1 pb-2">
            <button
              type="button"
              onClick={() => (allSelected ? onClearAll(manager) : onSelectAll(manager))}
              className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
            >
              {allSelected ? 'clear all' : 'select all'}
            </button>
            {anySelected && !allSelected && (
              <button
                type="button"
                onClick={() => onClearAll(manager)}
                className="text-[10px] text-gray-500 hover:text-gray-300 transition-colors"
              >
                clear
              </button>
            )}
          </div>
          {manager.children.map((child) => (
            <ChildRow
              key={child.sessionId}
              child={child}
              selected={selectedIds.has(child.sessionId)}
              onToggle={() => onToggleChild(child)}
              dispatchState={dispatchState[child.sessionId]}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Slim, always-visible tab pinned to the bottom-center of the viewport.
 * Clicking it toggles the dispatch drawer. Hidden when the drawer is open
 * (the drawer has its own close button). Polls /api/managers in the
 * background so it can show a badge with the total session count.
 */
export function DispatchDrawerHandle({ open, onToggle }) {
  // Lightweight background fetch for the badge — refetched every 10s.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (open) return // pause polling while drawer is open (drawer fetches its own copy)
    const i = setInterval(() => setTick((t) => t + 1), 10_000)
    return () => clearInterval(i)
  }, [open])
  const { data } = useApi(open ? null : '/api/managers', [tick])
  const managers = data?.managers || []
  const totalChildren = managers.reduce((sum, m) => sum + m.childCount, 0)
  const waitingCount = managers.reduce((sum, m) => sum + (m.needsInputCount || 0), 0)
  const activeCount = managers.reduce((sum, m) => sum + (m.activeCount || 0), 0)

  if (open) return null

  return (
    <button
      type="button"
      onClick={onToggle}
      className="fixed bottom-0 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 px-4 py-1.5 rounded-t-lg border border-b-0 border-gray-700 bg-gray-900 hover:bg-gray-800 hover:border-indigo-700 transition-colors shadow-lg group"
      title="Open Dispatch Manager (d)"
      aria-label="Open dispatch manager"
    >
      <Layers size={13} className="text-indigo-400 group-hover:text-indigo-300" />
      <span className="text-xs font-medium text-gray-200">Dispatch</span>
      {managers.length > 0 && (
        <span className="text-[10px] text-gray-500 font-mono">
          {managers.length} {managers.length === 1 ? 'group' : 'groups'} · {totalChildren}
        </span>
      )}
      {activeCount > 0 && (
        <span className="flex items-center gap-1 text-[10px] text-green-400">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          {activeCount}
        </span>
      )}
      {waitingCount > 0 && (
        <span className="px-1.5 py-0.5 rounded-full bg-amber-900/40 text-amber-300 text-[10px] font-medium">
          {waitingCount} waiting
        </span>
      )}
      <ChevronUp size={12} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
    </button>
  )
}

export function DispatchDrawer({ open, onClose }) {
  const { data, loading, error, refetch } = useApi(open ? '/api/managers' : null, [open])
  const managers = data?.managers || []

  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [text, setText] = useState('')
  const [dispatchState, setDispatchState] = useState({}) // sessionId -> { status, error }
  const [sending, setSending] = useState(false)
  const [expanded, setExpanded] = useState(() => new Set())
  const inputRef = useRef(null)

  // When the drawer opens, default-expand the first manager and focus the input
  useEffect(() => {
    if (!open) return
    if (managers.length > 0 && expanded.size === 0) {
      setExpanded(new Set([managers[0].id]))
    }
    setTimeout(() => inputRef.current?.focus(), 50)
  }, [open, managers.length])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape' && !sending) {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, sending, onClose])

  const toggleChild = useCallback((child) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(child.sessionId)) next.delete(child.sessionId)
      else next.add(child.sessionId)
      return next
    })
  }, [])

  const selectAll = useCallback((manager) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const c of manager.children) next.add(c.sessionId)
      return next
    })
  }, [])

  const clearAll = useCallback((manager) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const c of manager.children) next.delete(c.sessionId)
      return next
    })
  }, [])

  const toggleExpanded = useCallback((id) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectedCount = selectedIds.size
  const totalChildren = useMemo(
    () => managers.reduce((sum, m) => sum + m.children.length, 0),
    [managers],
  )

  const dispatchToAll = useCallback(async () => {
    if (!text.trim() || selectedCount === 0 || sending) return
    setSending(true)
    const targets = Array.from(selectedIds)

    // Mark all as pending
    setDispatchState(targets.reduce((acc, id) => ({ ...acc, [id]: { status: 'pending' } }), {}))

    const results = await Promise.allSettled(
      targets.map((id) =>
        fetch(`/api/sessions/${id}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text.trim() }),
        }).then(async (r) => {
          if (!r.ok) {
            const body = await r.json().catch(() => ({}))
            throw new Error(body.detail || body.error || `HTTP ${r.status}`)
          }
          return id
        }),
      ),
    )

    const nextState = {}
    results.forEach((res, i) => {
      const id = targets[i]
      if (res.status === 'fulfilled') {
        nextState[id] = { status: 'ok' }
      } else {
        nextState[id] = { status: 'failed', error: res.reason?.message || 'failed' }
      }
    })
    setDispatchState(nextState)

    // Clear text only if all succeeded
    const allOk = results.every((r) => r.status === 'fulfilled')
    if (allOk) {
      setText('')
      // Clear "ok" badges after a moment
      setTimeout(() => setDispatchState({}), 2000)
    }
    setSending(false)
  }, [text, selectedIds, selectedCount, sending])

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        dispatchToAll()
      }
    },
    [dispatchToAll],
  )

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity z-40 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => !sending && onClose()}
      />

      {/* Drawer — centered, max 1100px wide so it doesn't span the full screen */}
      <div
        className="fixed left-1/2 bottom-0 z-50 w-[min(92vw,1100px)] bg-gray-950 border border-b-0 border-gray-800 rounded-t-xl shadow-2xl transition-transform duration-200 ease-out"
        style={{
          height: 'min(72vh, 640px)',
          transform: open ? 'translate(-50%, 0)' : 'translate(-50%, 100%)',
        }}
        role="dialog"
        aria-label="Dispatch manager"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800">
          <Layers size={16} className="text-indigo-400" />
          <span className="text-sm font-semibold text-gray-100">Dispatch Manager</span>
          <span
            className="text-xs text-gray-600 cursor-help underline decoration-dotted decoration-gray-700 underline-offset-2"
            title="A group is a set of 2+ Claude Code sessions that share the same parent directory — usually one project. Use the dispatch composer to broadcast a message to every session you select across groups."
          >
            {managers.length} {managers.length === 1 ? 'group' : 'groups'} • {totalChildren}{' '}
            {totalChildren === 1 ? 'session' : 'sessions'}
          </span>
          {selectedCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-300 text-[10px] font-medium">
              {selectedCount} selected
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="ml-auto text-gray-600 hover:text-gray-300 transition-colors p-1 rounded disabled:opacity-30"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-col h-[calc(100%-58px)]">
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && <div className="text-xs text-gray-500 italic px-2">Loading…</div>}
            {error && (
              <div className="text-xs text-red-400 px-2 flex items-center gap-1.5">
                <AlertCircle size={12} />
                {error}
                <button
                  type="button"
                  onClick={refetch}
                  className="ml-2 underline hover:text-red-300"
                >
                  retry
                </button>
              </div>
            )}
            {!loading && managers.length === 0 && (
              <div className="text-xs text-gray-500 italic px-2 py-6 text-center">
                No manager groups found. A manager appears when 2+ sessions share the same parent
                directory.
              </div>
            )}
            {managers.map((manager) => (
              <ManagerCard
                key={manager.id}
                manager={manager}
                selectedIds={selectedIds}
                onToggleChild={toggleChild}
                onSelectAll={selectAll}
                onClearAll={clearAll}
                dispatchState={dispatchState}
                expanded={expanded.has(manager.id)}
                onToggleExpanded={() => toggleExpanded(manager.id)}
              />
            ))}
          </div>

          {/* Footer dispatch composer */}
          <div className="border-t border-gray-800 px-3 py-3 bg-gray-900/40">
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                disabled={sending}
                placeholder={
                  selectedCount === 0
                    ? 'Select children above, then type a message…'
                    : `Broadcast to ${selectedCount} ${selectedCount === 1 ? 'session' : 'sessions'}… (⌘/Ctrl+Enter to send)`
                }
                rows={2}
                className="flex-1 bg-gray-900 border border-gray-700 rounded px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-50 resize-none"
              />
              <button
                type="button"
                onClick={dispatchToAll}
                disabled={!text.trim() || selectedCount === 0 || sending}
                className="px-4 py-2 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 shrink-0"
              >
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                {sending ? 'Sending…' : 'Dispatch'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
