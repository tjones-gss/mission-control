import { useCallback, useEffect, useRef, useState } from 'react'
import { X, Loader2, CheckCircle2 } from 'lucide-react'

// Dialog that POSTs a plain-language roadmap to the harness roadmap compiler.
// On success the harness rewrites .harness/mission-index.yml, which the watcher
// emits as harness_update → the parent refetches on harnessVersion. We do NOT
// re-fetch here; we just surface success and let the parent close.
export function CompileRoadmapDialog({ project, onClose, onCompiled }) {
  const [roadmap, setRoadmap] = useState('')
  const [title, setTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const textareaRef = useRef(null)

  // ESC closes (but not mid-compile — an in-flight agent run should not be
  // accidentally dismissed by a stray keypress).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !submitting) onClose?.()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose, submitting])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  const canSubmit = roadmap.trim().length > 0 && !submitting && !result

  const submit = useCallback(async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError(null)
    try {
      const body = { roadmap: roadmap.trim() }
      if (title.trim()) body.title = title.trim()
      // project.projectKey is ALREADY encodeURIComponent(projectPath) (set by the
      // server's harness parser). Use it bare — re-encoding would double-encode
      // and 404 the whitelist check. (Matches the GET in HarnessDetail.)
      const res = await fetch(`/api/harness/${project.projectKey}/roadmap/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.ok === false) {
        setError(data.error || data.detail || `HTTP ${res.status}`)
        return
      }
      setResult({ specPath: data.specPath, summary: data.summary })
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }, [canSubmit, roadmap, title, project.projectKey])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compile-roadmap-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose?.()
      }}
    >
      <div className="w-full max-w-lg mx-4 bg-gray-950 border border-gray-800 rounded-lg shadow-2xl">
        <div className="flex items-center px-4 py-3 border-b border-gray-800">
          <h2 id="compile-roadmap-title" className="text-sm font-semibold text-gray-200">
            Compile roadmap → missions
          </h2>
          <span className="ml-2 text-xs font-mono text-gray-500 truncate">
            {project.projectLabel}
          </span>
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
                <div className="font-semibold">Roadmap compiled into draft missions</div>
                {result.summary && (
                  <div className="mt-1 text-emerald-300/80 whitespace-pre-wrap break-words">
                    {result.summary}
                  </div>
                )}
                {result.specPath && (
                  <div className="mt-1 text-[10px] font-mono text-emerald-300/60 truncate">
                    {result.specPath}
                  </div>
                )}
              </div>
            </div>
            <div className="text-[11px] text-gray-500">
              New missions land as <span className="text-amber-300">draft</span> — review each one
              before running it on-rails. The list refreshes automatically.
            </div>
          </div>
        ) : (
          <div className="px-4 py-3 space-y-3">
            <div>
              <label
                htmlFor="compile-roadmap-text"
                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
              >
                Roadmap / intent
              </label>
              <textarea
                id="compile-roadmap-text"
                ref={textareaRef}
                value={roadmap}
                onChange={(e) => setRoadmap(e.target.value)}
                disabled={submitting}
                rows={9}
                placeholder="Paste your plain-language roadmap or intent. The mission-writer skill will slice it into bounded, sequenced draft missions."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 resize-y disabled:opacity-60"
              />
            </div>

            <div>
              <label
                htmlFor="compile-roadmap-title-input"
                className="block text-[10px] uppercase tracking-wider text-gray-500 mb-1"
              >
                Title <span className="text-gray-600 normal-case">(optional)</span>
              </label>
              <input
                id="compile-roadmap-title-input"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                placeholder="Used to name the spec file (else a timestamp)"
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500 disabled:opacity-60"
              />
            </div>

            {submitting && (
              <div className="flex items-center gap-2 px-3 py-2 bg-indigo-950/30 border border-indigo-900/50 rounded text-xs text-indigo-200">
                <Loader2 size={14} className="animate-spin shrink-0" />
                <span>Compiling… spawning the mission-writer agent (can take 10s–2min).</span>
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
              onClick={() => onCompiled?.()}
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
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="ml-auto px-3 py-1.5 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? 'Compiling…' : 'Compile'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
