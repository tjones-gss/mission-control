import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, CheckCircle2 } from 'lucide-react'

// The modes the harness understands, with human labels. Mirrors the CLI's
// VALID_MODES / the harness-scaffold contract enum — keep in sync.
const MODES = [
  ['idea-to-mvp', 'Idea → MVP'],
  ['mvp-sketch', 'MVP sketch'],
  ['existing-repo-retrofit', 'Existing repo retrofit'],
  ['feature-development', 'Feature development'],
  ['bugfix', 'Bugfix'],
  ['refactor', 'Refactor'],
  ['release-readiness', 'Release readiness'],
]

// Dialog that creates a NEW harness project by POSTing to /api/harness/create.
// The target is chosen from a picker of scaffold candidates (session cwds that
// are NOT already harness projects) — the server validates membership again, so
// the cockpit never scaffolds into an arbitrary path. On success the server's
// watcher emits harness_update → the parent refetches on harnessVersion; we do
// not refetch here, just surface success and let the parent close.
export function NewHarnessProjectDialog({ onClose, onCreated }) {
  const [candidates, setCandidates] = useState(null) // null = loading
  const [projectPath, setProjectPath] = useState('')
  const [mode, setMode] = useState('idea-to-mvp')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  // ESC closes (but not mid-create — a scaffold in flight should not be
  // dismissed by a stray keypress).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  // Load the candidate directories once on mount.
  useEffect(() => {
    let active = true
    fetch('/api/harness/scaffold-candidates')
      .then((res) => res.json())
      .then((data) => {
        if (!active) return
        const list = Array.isArray(data?.candidates) ? data.candidates : []
        setCandidates(list)
        if (list.length) setProjectPath(list[0])
      })
      .catch(() => {
        if (active) setCandidates([])
      })
    return () => {
      active = false
    }
  }, [])

  const canSubmit = !!projectPath && !!mode && !submitting && !result

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/harness/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath, mode }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || data.message || `HTTP ${res.status}`)
        return
      }
      setResult({ root: data.root, mode: data.mode, created: data.created || [] })
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, projectPath, mode])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-harness-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.()
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
        <div className="flex items-center px-4 py-3 border-b border-gray-800">
          <h2 id="new-harness-title" className="text-sm font-semibold text-gray-200">
            New harness project
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="ml-auto text-gray-600 hover:text-gray-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>

        {result ? (
          <div className="px-4 py-4 space-y-3">
            <div className="flex items-start gap-2 px-3 py-2 bg-emerald-950/30 border border-emerald-900/50 rounded">
              <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs text-emerald-200 min-w-0">
                <div className="font-semibold">Harness project created</div>
                <div className="mt-1 text-emerald-300/80">
                  mode <span className="font-mono">{result.mode}</span> · {result.created.length}{' '}
                  file{result.created.length === 1 ? '' : 's'} written
                </div>
                {result.root && (
                  <div className="mt-1 text-[10px] font-mono text-emerald-300/60 truncate">
                    {result.root}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[11px] text-gray-500">
              The project will appear in the list automatically. Open it to bootstrap the harness
              and pick your first mission.
            </div>
          </div>
        ) : candidates === null ? (
          <div className="px-4 py-6 flex items-center gap-2 text-xs text-gray-500">
            <Loader2 size={14} className="animate-spin shrink-0" />
            <span>Finding eligible directories…</span>
          </div>
        ) : candidates.length === 0 ? (
          <div className="px-4 py-4 text-xs text-gray-500">
            No eligible directories. A directory becomes eligible once you&apos;ve run an agent
            session in it and it does not already contain a{' '}
            <code className="text-gray-400">.harness/</code> project.
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            <div>
              <label
                htmlFor="new-harness-path"
                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
              >
                Directory
              </label>
              <select
                id="new-harness-path"
                value={projectPath}
                onChange={(e) => setProjectPath(e.target.value)}
                disabled={submitting}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              >
                {candidates.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="new-harness-mode"
                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
              >
                Mode
              </label>
              <select
                id="new-harness-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                disabled={submitting}
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              >
                {MODES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {submitting && (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-950/30 border border-indigo-900/50 rounded text-xs text-indigo-200">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span>Scaffolding the project…</span>
              </div>
            )}

            {error && (
              <div className="text-[11px] text-red-400 bg-red-950/30 border border-red-900/50 rounded px-2 py-1 whitespace-pre-wrap break-words">
                {error}
              </div>
            )}
          </div>
        )}

        <div className="px-4 py-3 border-t border-gray-800 flex items-center gap-2">
          {result ? (
            <button
              onClick={() => onCreated?.()}
              className="ml-auto px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
            >
              Done
            </button>
          ) : (
            <>
              <button
                onClick={onClose}
                disabled={submitting}
                className="px-3 py-1.5 rounded text-xs text-gray-400 hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                Cancel
              </button>
              {candidates && candidates.length > 0 && (
                <button
                  onClick={submit}
                  disabled={!canSubmit}
                  className="ml-auto px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Creating…' : 'Create project'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
