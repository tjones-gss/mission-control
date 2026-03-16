import { useState, useCallback } from 'react'
import { GitFork, Pencil, Check, X } from 'lucide-react'

const PERMISSION_MODES = ['default', 'plan', 'auto', 'acceptEdits', 'dontAsk', 'bypassPermissions']
const MODELS = ['', 'sonnet', 'opus', 'haiku']
const EFFORTS = ['', 'low', 'medium', 'high', 'max']

function Dropdown({ label, value, options, onChange, labelMap }) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-gray-500">
      {label}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-[11px] text-gray-300 focus:outline-none focus:border-indigo-500"
      >
        {options.map(o => (
          <option key={o} value={o}>{(labelMap && labelMap[o]) || o || '—'}</option>
        ))}
      </select>
    </label>
  )
}

export function SessionControlBar({ session, sessionOptions, onOptionsChange }) {
  const [forking, setForking] = useState(false)
  const [forkPrompt, setForkPrompt] = useState('')
  const [forkLoading, setForkLoading] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')

  const handleFork = useCallback(async () => {
    if (!forkPrompt.trim() || forkLoading) return
    setForkLoading(true)
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/fork`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: forkPrompt.trim(), options: sessionOptions }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      }
      setForking(false)
      setForkPrompt('')
    } catch (e) {
      alert(`Fork failed: ${e.message}`)
    } finally {
      setForkLoading(false)
    }
  }, [session?.sessionId, forkPrompt, forkLoading, sessionOptions])

  const handleSaveName = useCallback(async () => {
    if (!nameInput.trim()) { setEditingName(false); return }
    try {
      const res = await fetch(`/api/sessions/${session.sessionId}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save name')
      setEditingName(false)
    } catch (e) {
      alert(e.message)
    }
  }, [session?.sessionId, nameInput])

  if (!session) return null

  const statusColor = session.isActive ? 'bg-green-400' : session.needsInput ? 'bg-amber-400' : 'bg-gray-600'
  const statusLabel = session.isActive ? 'active' : session.needsInput ? 'needs input' : 'idle'

  return (
    <div className="px-3 py-1.5 border-b border-gray-800 space-y-1.5 bg-gray-900/30">
      {/* Row 1: Status + Name + Model badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="flex items-center gap-1.5 text-[10px] text-gray-400">
          <span className={`w-1.5 h-1.5 rounded-full ${statusColor} ${session.isActive ? 'animate-pulse' : ''}`} />
          {statusLabel}
        </span>

        {editingName ? (
          <span className="flex items-center gap-1">
            <input
              autoFocus
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSaveName(); if (e.key === 'Escape') setEditingName(false) }}
              className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-gray-200 w-32 focus:outline-none focus:border-indigo-500"
              placeholder="Session name..."
            />
            <button onClick={handleSaveName} className="text-green-500 hover:text-green-400"><Check size={11} /></button>
            <button onClick={() => setEditingName(false)} className="text-gray-500 hover:text-gray-400"><X size={11} /></button>
          </span>
        ) : (
          <button
            onClick={() => { setNameInput(session.displayName || session.slug || ''); setEditingName(true) }}
            className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200 transition-colors"
            title="Rename session"
          >
            <Pencil size={9} />
            <span className="font-mono truncate max-w-[150px]">{session.displayName || session.slug || session.sessionId.slice(0, 8)}</span>
          </button>
        )}

        {session.model && (
          <span className="px-1.5 py-0.5 rounded bg-gray-800 text-indigo-400 text-[10px] font-mono">
            {session.model.split('-').slice(-2).join('-')}
          </span>
        )}
      </div>

      {/* Row 2: Dropdowns + Fork */}
      <div className="flex items-center gap-3 flex-wrap">
        <Dropdown
          label="Mode"
          value={sessionOptions.permissionMode || 'default'}
          options={PERMISSION_MODES}
          onChange={v => onOptionsChange({ ...sessionOptions, permissionMode: v === 'default' ? '' : v })}
        />
        <Dropdown
          label="Model"
          value={sessionOptions.model || ''}
          options={MODELS}
          onChange={v => onOptionsChange({ ...sessionOptions, model: v })}
        />
        <Dropdown
          label="Effort"
          value={sessionOptions.effort || ''}
          options={EFFORTS}
          onChange={v => onOptionsChange({ ...sessionOptions, effort: v })}
        />

        {forking ? (
          <span className="flex items-center gap-1 ml-auto">
            <input
              autoFocus
              value={forkPrompt}
              onChange={e => setForkPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleFork(); if (e.key === 'Escape') { setForking(false); setForkPrompt('') } }}
              placeholder="Fork prompt..."
              className="bg-gray-900 border border-gray-600 rounded px-1.5 py-0.5 text-[11px] text-gray-200 w-48 focus:outline-none focus:border-indigo-500"
              disabled={forkLoading}
            />
            <button
              onClick={handleFork}
              disabled={!forkPrompt.trim() || forkLoading}
              className="px-1.5 py-0.5 rounded bg-purple-700 text-white text-[10px] hover:bg-purple-600 disabled:opacity-30 transition-colors"
            >
              {forkLoading ? '...' : 'Fork'}
            </button>
            <button onClick={() => { setForking(false); setForkPrompt('') }} className="text-gray-500 hover:text-gray-400">
              <X size={11} />
            </button>
          </span>
        ) : (
          <button
            onClick={() => setForking(true)}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-purple-400 hover:bg-purple-900/30 transition-colors"
          >
            <GitFork size={10} /> Fork
          </button>
        )}
      </div>
    </div>
  )
}
