import { useCallback, useEffect, useState } from 'react'
import { ShieldAlert, Trash2, FolderPlus, Loader2 } from 'lucide-react'
import { FolderPicker } from '../FolderPicker.jsx'

// "Trusted folders" — the in-cockpit per-folder trust-grant control (the locked
// Phase 3 decision). A trusted folder lets agents spawned there run with
// --dangerously-skip-permissions, so this is an explicit, revocable, default-DENY
// security setting. Reads/writes GET/POST/DELETE /api/trust.
export function TrustedFoldersTab() {
  const [trusted, setTrusted] = useState(null) // null = loading
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showPicker, setShowPicker] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/trust')
      const data = await res.json().catch(() => ({}))
      setTrusted(Array.isArray(data?.trusted) ? data.trusted : [])
    } catch (e) {
      setError(e.message)
      setTrusted([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const grant = useCallback(async (cwd) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      setTrusted(Array.isArray(data.trusted) ? data.trusted : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  const revoke = useCallback(async (cwd) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/trust', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || `HTTP ${res.status}`)
        return
      }
      setTrusted(Array.isArray(data.trusted) ? data.trusted : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 px-3 py-2 bg-amber-950/30 border border-amber-900/50 rounded">
        <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-amber-200/90">
          Trusting a folder lets agents started there run with{' '}
          <code className="text-amber-100">--dangerously-skip-permissions</code> — file edits and
          commands run without prompting. Only trust folders you fully control. Untrusted folders
          default to guarded (acceptEdits) mode.
        </p>
      </div>

      {trusted === null ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 size={14} className="animate-spin" />
          <span>Loading trusted folders…</span>
        </div>
      ) : trusted.length === 0 ? (
        <p className="text-xs text-gray-500">No trusted folders. Spawns default to guarded mode.</p>
      ) : (
        <ul className="space-y-1">
          {trusted.map((cwd) => (
            <li
              key={cwd}
              className="flex items-center gap-2 px-2 py-1.5 bg-gray-800/50 border border-gray-700 rounded"
            >
              <span className="font-mono text-[11px] text-gray-300 truncate flex-1" title={cwd}>
                {cwd}
              </span>
              <button
                onClick={() => revoke(cwd)}
                disabled={busy}
                aria-label={`Revoke trust for ${cwd}`}
                className="text-gray-500 hover:text-red-400 disabled:opacity-30 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        onClick={() => setShowPicker(true)}
        disabled={busy}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 transition-colors"
      >
        <FolderPlus size={13} />
        Trust a folder
      </button>

      {error && (
        <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded px-2 py-1 whitespace-pre-wrap break-words">
          {error}
        </div>
      )}

      {showPicker && (
        <FolderPicker
          onClose={() => setShowPicker(false)}
          onSelect={(cwd) => {
            setShowPicker(false)
            if (cwd) grant(cwd)
          }}
        />
      )}
    </div>
  )
}
