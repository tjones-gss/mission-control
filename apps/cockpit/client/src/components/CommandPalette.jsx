import { useState, useEffect, useMemo, useRef } from 'react'
import { Search } from 'lucide-react'
import { Dialog } from './ui/Dialog.jsx'
import { projectLabel } from '../utils/session.js'

// ADR-0008 Phase 3 — the front door of the epicenter: one keystroke (Ctrl/⌘+K)
// from anywhere to anything any agent ever did. Sessions matched by name/slug
// come first, then full-text message hits from GET /api/search (FTS5).
// Styled exclusively with --mc-* theme tokens.
const DEBOUNCE_MS = 200
const SESSION_LIMIT = 6
const MESSAGE_LIMIT = 12

// Phase 6 — knowledge surfacing: the doc-type filter mirrors the server's
// GET /api/search?type=. 'all' (the default) omits the param entirely.
const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'message', label: 'Messages' },
  { id: 'memory', label: 'Memory' },
  { id: 'summary', label: 'Summaries' },
]

function formatTs(ms) {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// The server returns snippet() output with literal <mark>…</mark> markers.
// Split on the markers and rebuild with real elements — never innerHTML, so
// transcript content can't inject markup. (Same approach as HistorySearch.)
function renderSnippet(snippet) {
  return (snippet || '').split(/<\/?mark>/).map((part, i) =>
    i % 2 === 1 ? (
      <mark
        key={i}
        className="rounded-sm px-0.5"
        style={{ backgroundColor: 'var(--mc-warn-soft)', color: 'var(--mc-warn)' }}
      >
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  )
}

function sessionLabel(s) {
  return s.displayName || s.slug || s.sessionId
}

// Client-side session match: the sessions list is already in memory (App owns
// it), so name/slug/id/project hits are instant — no server round trip.
function matchSessions(sessions, query) {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  return (sessions || [])
    .filter((s) =>
      [s.displayName, s.slug, s.sessionId, projectLabel(s)]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle)),
    )
    .slice(0, SESSION_LIMIT)
}

function GroupHeading({ children }) {
  return (
    <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--mc-fg-4)]">
      {children}
    </div>
  )
}

function PaletteRow({ active, onSelect, children }) {
  const ref = useRef(null)
  useEffect(() => {
    // jsdom has no scrollIntoView — guard the call.
    if (active) ref.current?.scrollIntoView?.({ block: 'nearest' })
  }, [active])
  return (
    <button
      ref={ref}
      role="option"
      aria-selected={active}
      onClick={onSelect}
      // Keep keyboard focus in the search input while clicking rows.
      onMouseDown={(e) => e.preventDefault()}
      className={`block w-full px-3 py-2 text-left transition-colors ${
        active ? 'bg-[var(--mc-surface-2)]' : 'hover:bg-[var(--mc-surface-2)]'
      }`}
    >
      {children}
    </button>
  )
}

/**
 * ⌘K command palette. Opened from App via the `commandPalette` keyboard
 * shortcut. Grouped results: sessions (matched client-side by name/slug/id/
 * project) first, then message hits with snippets (debounced GET /api/search).
 * Enter/click navigates via onNavigate(sessionId); Escape closes.
 */
export function CommandPalette({ open, onClose, sessions, onNavigate }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [hits, setHits] = useState([])
  const [status, setStatus] = useState('idle') // idle | loading | done | error
  const [errorHint, setErrorHint] = useState(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)

  // Reset to a fresh palette whenever it closes, so reopening starts clean.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setTypeFilter('all')
      setHits([])
      setStatus('idle')
      setErrorHint(null)
      setActiveIndex(0)
    }
  }, [open])

  // Debounced full-text search; aborts in-flight fetches on retype/close.
  useEffect(() => {
    if (!open) return undefined
    if (!query.trim()) {
      setHits([])
      setStatus('idle')
      setErrorHint(null)
      return undefined
    }
    const controller = new AbortController()
    setStatus('loading')
    const timer = setTimeout(async () => {
      const params = new URLSearchParams({ q: query, limit: MESSAGE_LIMIT })
      if (typeFilter !== 'all') params.set('type', typeFilter)
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
        setHits(data.results || [])
        setErrorHint(null)
        setStatus('done')
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Palette search failed:', err)
        setErrorHint('Search failed')
        setStatus('error')
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, typeFilter])

  const sessionMatches = useMemo(() => matchSessions(sessions, query), [sessions, query])

  // Flat selectable list: sessions group first, then message hits.
  const items = useMemo(
    () => [
      ...sessionMatches.map((s) => ({ key: `s-${s.sessionId}`, sessionId: s.sessionId })),
      ...hits.map((h) => ({
        key: `m-${h.sessionId}-${h.idx}`,
        sessionId: h.sessionId,
        docType: h.docType,
      })),
    ],
    [sessionMatches, hits],
  )

  // New query/filter → selection snaps back to the top result.
  useEffect(() => {
    setActiveIndex(0)
  }, [query, typeFilter])

  if (!open) return null

  const select = (item) => {
    if (!item) return
    // Memory docs are knowledge files, not sessions — there is nothing to
    // navigate to (their sessionId is the synthetic 'memory:<path>' key).
    if (item.docType !== 'memory') onNavigate(item.sessionId)
    onClose()
  }

  const onInputKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(items[activeIndex])
    }
  }

  const showEmpty =
    status === 'done' && query.trim() && sessionMatches.length === 0 && hits.length === 0

  return (
    <Dialog
      open
      onClose={onClose}
      label="Command palette"
      initialFocusRef={inputRef}
      className="!top-[15%] w-[min(640px,calc(100vw-2rem))] !translate-y-0 overflow-hidden rounded-xl border border-[var(--mc-border-2)] bg-[var(--mc-surface)] shadow-2xl"
      backdropClassName="bg-[var(--mc-bg)] opacity-70"
    >
      <div className="flex items-center gap-2 border-b border-[var(--mc-border)] px-3 py-2.5">
        <Search size={14} className="shrink-0 text-[var(--mc-fg-4)]" />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="Search sessions and messages…"
          className="flex-1 bg-transparent text-sm text-[var(--mc-fg)] outline-none placeholder:text-[var(--mc-fg-5)]"
        />
        <kbd className="shrink-0 rounded border border-[var(--mc-border-2)] bg-[var(--mc-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--mc-fg-4)]">
          esc
        </kbd>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--mc-border)] px-3 py-1.5">
        {TYPE_FILTERS.map((t) => {
          const active = typeFilter === t.id
          return (
            <button
              key={t.id}
              aria-pressed={active}
              onClick={() => setTypeFilter(t.id)}
              // Keep keyboard focus in the search input while clicking pills.
              onMouseDown={(e) => e.preventDefault()}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
                active
                  ? 'border-[var(--mc-border-2)] bg-[var(--mc-surface-2)] text-[var(--mc-fg)]'
                  : 'border-transparent text-[var(--mc-fg-4)] hover:text-[var(--mc-fg-2)]'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="max-h-[50vh] overflow-y-auto pb-1.5" role="listbox" aria-label="Results">
        {!query.trim() && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mc-fg-4)]">
            Search sessions and everything your agents have ever said or done
          </div>
        )}

        {status === 'error' && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mc-danger)]">{errorHint}</div>
        )}

        {showEmpty && (
          <div className="px-3 py-6 text-center text-xs text-[var(--mc-fg-4)]">No matches</div>
        )}

        {sessionMatches.length > 0 && (
          <>
            <GroupHeading>Sessions</GroupHeading>
            {sessionMatches.map((s, i) => (
              <PaletteRow
                key={`s-${s.sessionId}`}
                active={activeIndex === i}
                onSelect={() => select(items[i])}
              >
                <div className="flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-[var(--mc-fg)]">
                    {sessionLabel(s)}
                  </span>
                  {s.isActive && (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--mc-ok)]" />
                  )}
                  <span className="flex-1" />
                  <span className="shrink-0 text-xs text-[var(--mc-fg-4)]">{projectLabel(s)}</span>
                </div>
              </PaletteRow>
            ))}
          </>
        )}

        {status === 'loading' && hits.length === 0 && query.trim() && (
          <div className="px-3 py-2 text-xs text-[var(--mc-fg-4)]">Searching…</div>
        )}

        {hits.length > 0 && (
          <>
            <GroupHeading>Messages</GroupHeading>
            {hits.map((h, i) => (
              <PaletteRow
                key={`m-${h.sessionId}-${h.idx}`}
                active={activeIndex === sessionMatches.length + i}
                onSelect={() => select(items[sessionMatches.length + i])}
              >
                <div className="mb-0.5 flex items-center gap-2">
                  <span className="truncate text-xs font-semibold text-[var(--mc-fg-2)]">
                    {h.slug || h.sessionId}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase text-[var(--mc-fg-5)]">
                    {h.role || h.docType}
                  </span>
                  <span className="flex-1" />
                  <span className="shrink-0 text-xs text-[var(--mc-fg-5)]">
                    {formatTs(h.lastModified)}
                  </span>
                </div>
                <div className="break-all font-mono text-xs leading-relaxed text-[var(--mc-fg-3)]">
                  {renderSnippet(h.snippet)}
                </div>
              </PaletteRow>
            ))}
          </>
        )}
      </div>
    </Dialog>
  )
}
