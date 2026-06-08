import { useCallback, useEffect, useState } from 'react'
import { X, Loader2, CheckCircle2, ShieldCheck } from 'lucide-react'

// Dialog that adopts the opt-in harness rails into an EXISTING project by POSTing
// to /api/rails/adopt. The target is chosen from a picker of adopt candidates
// (session cwds that are real dirs without a Claude adapter yet) — the server
// validates membership again, so the cockpit never writes to an arbitrary path.
//
// Adoption is the pure-Node path: it installs the .claude adapter wired to the
// Node hooks (no python, no bash, no jq), so a known-bad Bash command is denied
// even on a machine with neither Git Bash nor jq. On success the watcher emits
// harness_update → the parent refetches.
export function AddRailsDialog({ onClose, onAdopted }) {
  const [candidates, setCandidates] = useState(null) // null = loading
  const [projectPath, setProjectPath] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  useEffect(() => {
    let active = true
    fetch('/api/rails/adopt-candidates')
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

  const canSubmit = !!projectPath && !submitting && !result

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/rails/adopt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || data.message || `HTTP ${res.status}`)
        return
      }
      setResult({ installed: data.installed || [], hooks: data.hooks })
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, projectPath])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-rails-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.()
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
        <div className="flex items-center px-4 py-3 border-b border-gray-800">
          <ShieldCheck size={14} className="text-emerald-400 mr-2 shrink-0" />
          <h2 id="add-rails-title" className="text-sm font-semibold text-gray-200">
            Add rails to a project
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
                <div className="font-semibold">Rails adopted</div>
                <div className="mt-1 text-emerald-300/80">
                  pure-Node hooks wired (no bash or jq needed)
                </div>
              </div>
            </div>
            <div className="text-[11px] text-gray-500">
              Restart Claude Code in that project and run{' '}
              <code className="text-gray-400">/hooks</code> to verify. A dangerous Bash command
              (e.g. <code className="text-gray-400">rm -rf</code>) is now denied before it runs.
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
            session in it and it does not already have a{' '}
            <code className="text-gray-400">.claude/</code> adapter.
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            <div>
              <label
                htmlFor="add-rails-path"
                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
              >
                Directory
              </label>
              <select
                id="add-rails-path"
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

            <p className="text-[11px] text-gray-500">
              Installs the opt-in guardrails (danger-command blocking, mission-scope enforcement,
              session-start context) wired to pure-Node hooks. Best-effort accident prevention —
              pair it with OS-level sandboxing, not a substitute for it.
            </p>

            {submitting && (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-950/30 border border-indigo-900/50 rounded text-xs text-indigo-200">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span>Adopting rails…</span>
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
              onClick={() => onAdopted?.()}
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
                  className="ml-auto px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  {submitting ? 'Adopting…' : 'Adopt rails'}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
