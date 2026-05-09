import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'

const ADR_RE = /^\d{4}$/

export function StartConductorDialog({ sessions = [], onClose, onStarted }) {
  const [cwd, setCwd] = useState('')
  const [adr, setAdr] = useState('')
  const [model, setModel] = useState('')
  const [mode, setMode] = useState('acceptEdits')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const dialogRef = useRef(null)

  const recentCwds = useMemo(() => {
    const seen = new Set()
    return [...sessions]
      .sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0))
      .map((s) => s.cwd)
      .filter((c) => {
        if (!c || seen.has(c)) return false
        seen.add(c)
        return true
      })
      .slice(0, 8)
  }, [sessions])

  // Auto-pick the most recent cwd as a sensible default
  useEffect(() => {
    if (!cwd && recentCwds.length) setCwd(recentCwds[0])
  }, [recentCwds, cwd])

  // ESC closes
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const canSubmit = cwd.trim() && ADR_RE.test(adr) && !submitting

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        cwd: cwd.trim(),
        prompt: `/conductor ${adr}`,
        name: `conductor ${adr}`,
      }
      const options = {}
      if (model) options.model = model
      if (mode) options.permissionMode = mode
      if (Object.keys(options).length > 0) body.options = options

      const res = await fetch('/api/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.detail || data.error || `HTTP ${res.status}`)
        return
      }
      onStarted?.(data.pendingSessionId || null)
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, cwd, adr, model, mode, onStarted])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-conductor-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md mx-4 bg-gray-950 border border-gray-800 rounded-lg shadow-2xl"
      >
        <div className="flex items-center px-4 py-3 border-b border-gray-800">
          <h2 id="start-conductor-title" className="text-sm font-semibold text-gray-200">
            Start Conductor run
          </h2>
          <button
            onClick={onClose}
            className="ml-auto text-gray-600 hover:text-gray-400 transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              Project directory
            </label>
            <input
              type="text"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="C:\\path\\to\\project"
              list="conductor-recent-cwds"
              className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
            />
            <datalist id="conductor-recent-cwds">
              {recentCwds.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <div className="mt-0.5 text-[10px] text-gray-600">
              Must contain <code>.claude/skills/conductor/</code> (the harness).
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
              ADR number
            </label>
            <input
              type="text"
              value={adr}
              onChange={(e) => setAdr(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="0012"
              maxLength={4}
              inputMode="numeric"
              className={`w-32 bg-gray-900 border rounded px-2 py-1.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 ${
                adr && !ADR_RE.test(adr) ? 'border-red-700' : 'border-gray-700'
              }`}
            />
            {adr && !ADR_RE.test(adr) && (
              <div className="mt-0.5 text-[10px] text-red-400">Must be exactly 4 digits.</div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Model
              </label>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">Default</option>
                <option value="sonnet">sonnet</option>
                <option value="opus">opus</option>
                <option value="haiku">haiku</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1">
                Permission mode
              </label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="default">default</option>
                <option value="acceptEdits">acceptEdits</option>
                <option value="plan">plan</option>
                <option value="auto">auto</option>
                <option value="bypassPermissions">bypassPermissions</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded px-2 py-1">
              {error}
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="ml-auto px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Starting…' : `Run /conductor ${adr || 'NNNN'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
