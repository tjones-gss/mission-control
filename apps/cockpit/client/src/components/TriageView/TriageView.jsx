import { useState, useMemo, useCallback, useRef } from 'react'
import {
  Clock,
  Cpu,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
  ShieldAlert,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react'
import { QuickActions } from '../QuickActions.jsx'
import { MetaBuildBanner } from './MetaBuildBanner.jsx'
import { SelectionBar } from './SelectionBar.jsx'
import { useApi } from '../../hooks/useApi.js'
import { projectLabel } from '../../utils/session.js'
import { suggestReply } from '../../utils/suggestReply.js'
import { formatCost } from '../../utils/cost.js'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'

// The "Needs you" triage home (Oversight redesign). Instead of the equal-weight
// Active/Idle/Done kanban, it ranks by ATTENTION: the few agents blocking on you
// first (with the real one-tap reply path inline), everything calm below. Wired
// to the real session list + the existing /api/sessions/:id/message write path
// (via QuickActions) — no mock data, no new backend.
//
// Risk badge: the session summary now carries `riskLevel`/`riskDescription` —
// the WORST live pending-approval classification, joined server-side from the
// real PTY approval state (GET /api/sessions). null means "nothing classified",
// so no badge renders — the danger styling is gated on REAL data only.

const ONE_HOUR = 3_600_000

// Display labels for the classifier's risk levels. SAFE_READONLY/UNKNOWN render
// no badge — they are not attention signals.
const RISK_BADGES = {
  DESTRUCTIVE: { label: 'Destructive', tone: 'danger', Icon: ShieldAlert, rank: 0 },
  CODE_EXECUTION: { label: 'Runs code', tone: 'warn', Icon: AlertTriangle, rank: 1 },
  REQUIRES_REVIEW: { label: 'Needs review', tone: 'warn', Icon: AlertTriangle, rank: 2 },
}

async function defaultQuickReply(sessionId, message) {
  await fetch(`/api/sessions/${sessionId}/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  })
}

function RiskBadge({ riskLevel, riskDescription }) {
  const badge = RISK_BADGES[riskLevel]
  if (!badge) return null
  const color = badge.tone === 'danger' ? 'var(--mc-danger)' : 'var(--mc-warn)'
  const bg = badge.tone === 'danger' ? 'var(--mc-danger-soft)' : 'var(--mc-warn-soft)'
  const Icon = badge.Icon
  return (
    <span
      title={riskDescription || undefined}
      className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={{ color, backgroundColor: bg }}
    >
      <Icon size={11} />
      {badge.label}
    </span>
  )
}

// Multi-select checkbox for a session card. Hidden until the card is hovered,
// pinned visible once checked. Lives as a sibling of the card's open-button so
// toggling selection never navigates into the session. --mc-* tokens only.
function SelectCheckbox({ label, checked, onToggle, className = '' }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={`Select ${label}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
      className={`shrink-0 rounded transition-opacity ${
        checked
          ? 'text-[var(--mc-accent)] opacity-100'
          : 'text-[var(--mc-fg-4)] opacity-0 hover:text-[var(--mc-fg-2)] group-hover:opacity-100 focus-visible:opacity-100 focus-visible:text-[var(--mc-fg-2)]'
      } ${className}`}
    >
      {checked ? <CheckSquare size={16} /> : <Square size={16} />}
    </button>
  )
}

function topTools(toolUseCounts, n = 2) {
  if (!toolUseCounts || typeof toolUseCounts !== 'object') return []
  return Object.entries(toolUseCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
}

// A card for an agent that is blocking on the user. A DESTRUCTIVE pending
// approval restyles the card's edge to the danger tone — real data only.
function AttnCard({ session, onSelect, selected, onToggleSelect, focused, registerCard }) {
  const label = projectLabel(session)
  const danger = session.riskLevel === 'DESTRUCTIVE'
  const waitLabel = useRelativeTime(session.lastModified, { prefix: 'waiting' })
  // Smart Triage reply: pull the tail of this blocked session's transcript and
  // derive a one-tap context-aware suggestion. Bounded — AttnCard renders only
  // for the (few) needs-input sessions. A failed/empty fetch yields null, so the
  // card silently falls back to the generic QuickActions chips.
  const { data: msgData } = useApi(`/api/sessions/${session.sessionId}/messages?limit=12`, [
    session.sessionId,
  ])
  const suggestion = useMemo(() => suggestReply(msgData?.messages || []), [msgData])
  return (
    <div
      ref={registerCard}
      tabIndex={-1}
      role="listitem"
      data-focused={focused || undefined}
      className={`group relative rounded-lg border bg-[var(--mc-surface)] p-4 transition-colors mc-fade ${
        focused ? 'ring-2 ring-[var(--mc-accent)]' : ''
      }`}
      style={{ borderColor: danger ? 'var(--mc-danger)' : 'var(--mc-accent-line)' }}
      aria-label={`${label}${session.riskLevel ? `, ${RISK_BADGES[session.riskLevel]?.label}` : ''}`}
    >
      <span
        className="absolute left-0 top-4 bottom-4 w-[3px] rounded"
        style={{ backgroundColor: danger ? 'var(--mc-danger)' : 'var(--mc-accent)' }}
        aria-hidden="true"
      />
      <div className="flex items-center gap-2.5">
        <SelectCheckbox label={label} checked={selected} onToggle={onToggleSelect} />
        <button
          onClick={() => onSelect(session.sessionId)}
          className="flex flex-1 items-center gap-2.5 text-left"
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full opacity-75"
              style={{ backgroundColor: danger ? 'var(--mc-danger)' : 'var(--mc-warn)' }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ backgroundColor: danger ? 'var(--mc-danger)' : 'var(--mc-warn)' }}
            />
          </span>
          <span className="truncate text-sm font-semibold text-[var(--mc-fg)]">{label}</span>
          <RiskBadge riskLevel={session.riskLevel} riskDescription={session.riskDescription} />
          {session.permissionMode && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--mc-fg-4)] bg-[var(--mc-surface-2)]">
              {session.permissionMode}
            </span>
          )}
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-[var(--mc-fg-4)]">
            <Clock size={12} /> {waitLabel || 'waiting'}
          </span>
        </button>
      </div>

      {session.lastText && (
        <p className="mt-2.5 text-xs leading-snug text-[var(--mc-fg-2)] line-clamp-2">
          {session.lastText}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {/* Real write path: posts to /api/sessions/:id/message. onReply opens the
            full conversation to type a custom answer. */}
        <QuickActions
          sessionId={session.sessionId}
          suggestion={suggestion}
          onReply={() => onSelect(session.sessionId)}
        />
      </div>
    </div>
  )
}

// A calm tile for an agent that is running but not blocking.
function RunningTile({ session, onSelect, selected, onToggleSelect }) {
  const label = projectLabel(session)
  const tools = topTools(session.toolUseCounts)
  const runLabel = useRelativeTime(session.lastModified, { prefix: 'running' })
  return (
    <div className="group relative">
      <SelectCheckbox
        label={label}
        checked={selected}
        onToggle={onToggleSelect}
        className="absolute right-2.5 top-2.5 z-10"
      />
      <button
        onClick={() => onSelect(session.sessionId)}
        className="flex w-full flex-col rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-3 text-left transition-colors hover:border-[var(--mc-border-2)] hover:bg-[var(--mc-surface-2)]"
      >
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2 shrink-0">
            <span className="absolute inline-flex h-full w-full motion-safe:animate-pulse rounded-full bg-[var(--mc-ok)] opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--mc-ok)]" />
          </span>
          <span className="truncate text-[13px] font-semibold text-[var(--mc-fg)]">{label}</span>
        </div>
        {session.lastText && (
          <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--mc-fg-3)]">
            <Cpu size={12} className="shrink-0 text-[var(--mc-fg-4)]" />
            <span className="truncate">{session.lastText}</span>
          </div>
        )}
        <div className="mt-2.5 flex items-center gap-1.5">
          {tools.map(([tool, count]) => (
            <span
              key={tool}
              className="inline-flex items-center gap-0.5 rounded border border-[var(--mc-border)] bg-[var(--mc-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--mc-fg-3)]"
            >
              <span className="max-w-[72px] truncate">{tool}</span>
              <span className="text-[var(--mc-fg-4)]">{count}</span>
            </span>
          ))}
          {session.estimatedCost && (
            <span className="ml-auto text-[10px] text-[var(--mc-ok)]">
              {formatCost(session.estimatedCost.totalCost)}
            </span>
          )}
        </div>
        {runLabel && (
          <div className="mt-1.5 text-right text-[10px] text-[var(--mc-fg-4)]">{runLabel}</div>
        )}
      </button>
    </div>
  )
}

// A compact row for idle/done sessions.
function CalmRow({ session, onSelect, selected, onToggleSelect }) {
  const label = projectLabel(session)
  const done = !session.isActive && session.lastModified <= Date.now() - ONE_HOUR
  return (
    <div className="group flex items-center gap-1.5 px-1">
      <SelectCheckbox label={label} checked={selected} onToggle={onToggleSelect} />
      <button
        onClick={() => onSelect(session.sessionId)}
        className="flex flex-1 items-center gap-2.5 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-[var(--mc-surface)]"
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: done ? 'var(--mc-accent)' : 'var(--mc-fg-5)' }}
          aria-hidden="true"
        />
        <span className="w-40 shrink-0 truncate text-[13px] font-medium text-[var(--mc-fg-2)]">
          {label}
        </span>
        <span className="flex-1 truncate text-xs text-[var(--mc-fg-3)]">{session.lastText}</span>
        {done && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[var(--mc-ok-soft)] px-2 py-0.5 text-[10px] text-[var(--mc-ok)]">
            <CheckCircle2 size={10} />
            done
          </span>
        )}
      </button>
    </div>
  )
}

function SectionHead({ children, count, color }) {
  return (
    <div className="mb-3.5 flex items-center gap-2.5">
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />
      <h2 className="text-[15px] font-bold text-[var(--mc-fg)]">{children}</h2>
      <span className="rounded-full bg-[var(--mc-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--mc-fg-4)]">
        {count}
      </span>
    </div>
  )
}

export function TriageView({
  sessions = [],
  selectedId,
  onSelect = () => {},
  onQuickReply = defaultQuickReply,
}) {
  const [showCalm, setShowCalm] = useState(true)
  // Multi-select for the folded dispatch verb (SelectionBar). Tracks session ids
  // independently of the single-select `selectedId` used for navigation.
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [focusedIdx, setFocusedIdx] = useState(0)
  const cardRefs = useRef(new Map())
  const list = Array.isArray(sessions) ? sessions : []

  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  const clearSelection = useCallback(() => setSelectedIds(new Set()), [])

  const needs = list
    .filter((s) => s.needsInput)
    .sort((a, b) => {
      const ar = RISK_BADGES[a.riskLevel]?.rank ?? 9
      const br = RISK_BADGES[b.riskLevel]?.rank ?? 9
      if (ar !== br) return ar - br
      return (b.lastModified || 0) - (a.lastModified || 0)
    })
  const running = list.filter((s) => s.isActive && !s.needsInput)
  const calm = list.filter((s) => !s.isActive && !s.needsInput)
  const metaCount = list.filter((s) => s.meta).length
  const focusCard = useCallback(
    (idx) => {
      if (needs.length === 0) return
      const next = Math.max(0, Math.min(idx, needs.length - 1))
      setFocusedIdx(next)
      window.requestAnimationFrame(() => {
        cardRefs.current.get(needs[next]?.sessionId)?.focus()
      })
    },
    [needs],
  )
  const handleNeedsKeyDown = useCallback(
    (e) => {
      if (needs.length === 0) return
      const current = needs[focusedIdx] || needs[0]
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        focusCard(focusedIdx + 1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        focusCard(focusedIdx - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onSelect(current.sessionId)
      } else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault()
        toggleSelect(current.sessionId)
      } else if (e.key.toLowerCase() === 'y') {
        e.preventDefault()
        onQuickReply(current.sessionId, 'yes')
      } else if (e.key.toLowerCase() === 'c') {
        e.preventDefault()
        onQuickReply(current.sessionId, 'continue')
      }
    },
    [needs, focusedIdx, focusCard, onSelect, onQuickReply, toggleSelect],
  )

  return (
    <div className="flex-1 overflow-y-auto bg-[var(--mc-bg)]">
      <div className="mx-auto max-w-5xl px-4 py-6 sm:px-7">
        {/* Phase S1 — Oversight is watching its own build. */}
        {metaCount > 0 && <MetaBuildBanner count={metaCount} />}

        {/* Needs you. The queue is role=list (not listbox): the cards contain
            real tabbable buttons (checkbox, open, quick actions), which the
            ARIA listbox pattern forbids inside options. A focusable list with
            roving arrow-key focus keeps keyboard nav AND coherent SR semantics. */}
        <section aria-label="Needs you">
          <SectionHead count={needs.length} color="var(--mc-warn)">
            Needs you
          </SectionHead>
          {needs.length === 0 ? (
            <div className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] px-5 py-7 text-center text-sm text-[var(--mc-fg-3)]">
              All clear — nothing waiting on you.
            </div>
          ) : (
            <div
              className="grid gap-3.5"
              tabIndex={0}
              role="list"
              aria-label="Needs you queue"
              onFocus={() => {
                if (!cardRefs.current.has(needs[focusedIdx]?.sessionId)) return
                cardRefs.current.get(needs[focusedIdx]?.sessionId)?.focus()
              }}
              onKeyDown={handleNeedsKeyDown}
            >
              {needs.map((s, idx) => (
                <AttnCard
                  key={s.sessionId}
                  session={s}
                  onSelect={onSelect}
                  selected={selectedIds.has(s.sessionId)}
                  onToggleSelect={() => toggleSelect(s.sessionId)}
                  focused={idx === focusedIdx}
                  registerCard={(node) => {
                    if (node) cardRefs.current.set(s.sessionId, node)
                    else cardRefs.current.delete(s.sessionId)
                  }}
                />
              ))}
            </div>
          )}
        </section>

        {/* Running */}
        <section aria-label="Running" className="mt-8">
          <SectionHead count={running.length} color="var(--mc-ok)">
            Running
          </SectionHead>
          {running.length === 0 ? (
            <p className="px-1 text-xs italic text-[var(--mc-fg-4)]">Nothing running right now.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {running.map((s) => (
                <RunningTile
                  key={s.sessionId}
                  session={s}
                  onSelect={onSelect}
                  selected={selectedIds.has(s.sessionId)}
                  onToggleSelect={() => toggleSelect(s.sessionId)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Idle & done */}
        <section aria-label="Idle & done" className="mt-8">
          <button
            onClick={() => setShowCalm((v) => !v)}
            className="mb-3.5 flex items-center gap-2.5"
            aria-expanded={showCalm}
          >
            {showCalm ? (
              <ChevronDown size={16} className="text-[var(--mc-fg-4)]" />
            ) : (
              <ChevronRight size={16} className="text-[var(--mc-fg-4)]" />
            )}
            <h2 className="text-[15px] font-bold text-[var(--mc-fg-2)]">Idle &amp; done</h2>
            <span className="rounded-full bg-[var(--mc-surface)] px-2 py-0.5 text-xs font-semibold text-[var(--mc-fg-4)]">
              {calm.length}
            </span>
          </button>
          {showCalm && calm.length > 0 && (
            <div className="rounded-lg border border-[var(--mc-border)] bg-[var(--mc-surface)] p-1.5">
              {calm.map((s) => (
                <CalmRow
                  key={s.sessionId}
                  session={s}
                  onSelect={onSelect}
                  selected={selectedIds.has(s.sessionId)}
                  onToggleSelect={() => toggleSelect(s.sessionId)}
                />
              ))}
            </div>
          )}
          {calm.length === 0 && (
            <p className="px-1 text-xs italic text-[var(--mc-fg-4)]">
              No idle or completed sessions.
            </p>
          )}
        </section>

        {/* Dispatch verb, folded in: broadcast to every checked session. */}
        <SelectionBar selectedIds={[...selectedIds]} onClear={clearSelection} />
      </div>
    </div>
  )
}
