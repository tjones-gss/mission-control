import { useState, useEffect } from 'react'

const DEBOUNCE_MS = 250
const RESULT_LIMIT = 50

function formatTs(ms) {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function projectBasename(p) {
  return (p || '').split(/[\\/]/).pop() || p
}

// The server returns snippet() output with literal <mark>…</mark> markers.
// Split on the markers and rebuild with real elements — never innerHTML, so
// transcript content can't inject markup.
function renderSnippet(snippet) {
  return (snippet || '').split(/<\/?mark>/).map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-amber-500/30 text-amber-200 rounded-sm px-0.5">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function ResultRow({ result, onOpenSession }) {
  return (
    <button
      onClick={() => onOpenSession(result.sessionId)}
      className="w-full text-left px-3 py-2 border-b border-gray-900 hover:bg-gray-900 transition-colors"
    >
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-gray-300 text-xs font-semibold truncate">
          {result.slug || result.sessionId}
        </span>
        <span className="text-gray-700 text-[10px] uppercase shrink-0">{result.role}</span>
        <span className="flex-1" />
        <span className="text-gray-700 text-xs shrink-0">{projectBasename(result.cwd)}</span>
        <span className="text-gray-700 text-xs shrink-0">{formatTs(result.lastModified)}</span>
      </div>
      <div className="text-gray-400 text-xs font-mono leading-relaxed break-all">
        {renderSnippet(result.snippet)}
      </div>
    </button>
  )
}

/**
 * "Search everything" mode for the History tab (ADR-0008 Phase 2): a
 * debounced full-text query against GET /api/search (FTS5 over every indexed
 * session message). Result rows deep-link into Agents → detail via
 * onOpenSession(sessionId).
 */
export function HistorySearch({ query, project, onOpenSession }) {
  const [results, setResults] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [errorHint, setErrorHint] = useState(null)

  useEffect(() => {
    if (!query.trim()) {
      setResults([])
      setStatus('idle')
      setErrorHint(null)
      return undefined
    }
    const controller = new AbortController()
    setStatus('loading')
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query, limit: RESULT_LIMIT })
      if (project) params.set('project', project)
      try {
        const res = await fetch(`/api/search?${params}`, { signal: controller.signal })
        if (!res.ok) {
          let hint = 'Search failed'
          try {
            const body = await res.json()
            hint = body.hint || body.error || hint
          } catch {
            /* non-JSON error body — keep the generic hint */
          }
          setErrorHint(hint)
          setStatus('error')
          return
        }
        const data = await res.json()
        setResults(data.results || [])
        setErrorHint(null)
        setStatus('done')
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Failed to search:', err)
        setErrorHint('Search failed')
        setStatus('error')
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, project])

  if (status === 'idle') {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-700">
        Type to search everything your agents have ever said or done
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center text-xs text-red-400">
        {errorHint}
      </div>
    )
  }

  if (status === 'done' && results.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-700">
        No matches
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {results.map((r) => (
        <ResultRow key={`${r.sessionId}-${r.idx}`} result={r} onOpenSession={onOpenSession} />
      ))}
    </div>
  )
}
