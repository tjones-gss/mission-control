import { useState, useCallback, useEffect, useMemo } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Grid2X2,
  Layers,
  List,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { LaunchDrawer } from './LaunchDrawer.jsx'
import { RunDetail, RUN_STATUS } from './FleetRunDetail.jsx'
import { formatCost } from '../../utils/cost.js'
import { useRelativeTime } from '../../hooks/useRelativeTime.js'
import { Card } from '../ui/Card.jsx'
import { Chip } from '../ui/Chip.jsx'

// Fleet UI — the power-user headline surface. Launch a fleet (a goal + N child
// agents, each in its own git worktree/branch), then watch the children live as
// a grid of cards with per-child cost, escalation banners, and a synthesis report
// at the bottom.
//
// This component owns NO spawn / approval / persistence logic. It calls the
// EXISTING server contract: POST /api/fleet to launch, GET /api/fleet[/:id] to
// read, GET /api/fleet/:id/escalations for banners, and routes Allow/Deny through
// POST /api/fleet/:id/decide. The runner dispatches that decision to the existing
// write paths server-side (the in-memory SDK resolver for 'tool', the harness CLI
// for 'harness') — so both escalation sources resolve from one UI button. The
// fleet_update SSE event (handled in App.jsx) bumps the version prop so the live
// view refetches in place — exactly like harness_update.

// ──────────────────────────────────────────────────────────────────────────────
// FleetTab — the surface itself.
// ──────────────────────────────────────────────────────────────────────────────
const FLEET_VIEW_KEY = 'mc.fleet.view'

function readFleetView() {
  try {
    const raw = localStorage.getItem(FLEET_VIEW_KEY)
    return raw === 'dashboard' ? 'dashboard' : 'list'
  } catch {
    return 'list'
  }
}

function FleetDashboardCard({ run, selected, onSelect }) {
  const meta = RUN_STATUS[run.status] || RUN_STATUS.running
  const settled = run.settledCount || 0
  const total = run.childCount || run.children?.length || 0
  const pct = total > 0 ? Math.min(100, (settled / total) * 100) : 0
  const elapsed = useRelativeTime(run.createdAt)
  const escalationCount =
    run.escalationCount ||
    run.escalations?.length ||
    run.children?.filter((c) => c.status === 'escalated').length ||
    0
  const cost =
    typeof run.spentUsd === 'number'
      ? run.spentUsd
      : (run.children || []).reduce((sum, child) => sum + (child.cost?.totalCost || 0), 0)
  return (
    <Card
      interactive
      onClick={() => onSelect(run.id)}
      className={`p-3 hover:bg-[var(--mc-surface-2)] ${
        selected ? 'border-[var(--mc-accent-line)] ring-1 ring-[var(--mc-accent-line)]' : ''
      }`}
    >
      <div className="flex items-start gap-2">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--mc-fg)]">{run.goal}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--mc-fg-4)]">
            <Chip className={meta.cls}>{run.status}</Chip>
            {run.policy?.verify && (
              <Chip tone="info" caps={false}>
                <ShieldCheck size={10} /> verify
              </Chip>
            )}
            {escalationCount > 0 && (
              <Chip tone="warn" caps={false}>
                <AlertTriangle size={10} /> {escalationCount}
              </Chip>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--mc-fg-4)]">
          <span>
            {settled}/{total} children settled
          </span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mc-surface-2)]">
          <div className="h-full rounded-full bg-[var(--mc-accent)]" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[11px] text-[var(--mc-fg-4)]">
        {cost > 0 && <span className="font-mono text-[var(--mc-ok)]">{formatCost(cost)}</span>}
        <span className="ml-auto inline-flex items-center gap-1">
          <Clock size={11} /> {elapsed || 'new'}
        </span>
      </div>
    </Card>
  )
}

export function FleetTab({ fleetVersion = 0, onOpenSession }) {
  const [showLaunch, setShowLaunch] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState(readFleetView)
  // Optimistic runs added on launch before the first list refetch lands.
  const [optimistic, setOptimistic] = useState([])

  const { data: listData } = useApi('/api/fleet', [fleetVersion])
  const { data: workflows } = useApi('/api/workflows')
  // Fleet-ready projects = the server's known harness roots — the SAME set
  // POST /api/fleet validates child cwds against. (Previously this fed from
  // /api/managers, a broader set, so the picker suggested paths the server
  // would refuse with "child N cwd is not a known root".)
  const { data: harnessData } = useApi('/api/harness')
  // Saved fleet templates for the launcher's "launch from template" picker.
  // Refetched after a save so a newly-saved template appears in the picker.
  const [templateVersion, setTemplateVersion] = useState(0)
  const { data: templatesData } = useApi('/api/fleet/templates', [templateVersion])
  const templates = templatesData?.templates || []

  // Save the launcher form as a reusable template. POSTs to /api/fleet/templates
  // and bumps templateVersion so the picker refetches. Throws on failure so the
  // drawer surfaces the error inline.
  const handleSaveTemplate = useCallback(async (template) => {
    const res = await fetch('/api/fleet/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(template),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) {
      throw new Error(data.error || data.detail || `HTTP ${res.status}`)
    }
    setTemplateVersion((v) => v + 1)
  }, [])

  const runs = useMemo(() => {
    const fromServer = (listData?.runs || []).slice()
    const serverIds = new Set(fromServer.map((r) => r.id))
    // Keep optimistic entries only until the server reports the same id.
    const extra = optimistic.filter((o) => !serverIds.has(o.id))
    const all = [...extra, ...fromServer]
    // Newest first by createdAt.
    return all.sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
  }, [listData, optimistic])

  // Known harness roots are the launcher's cwd picker options.
  const roots = useMemo(() => {
    const projects = harnessData?.projects || []
    const dirs = projects.map((p) => p.projectPath).filter(Boolean)
    return Array.from(new Set(dirs))
  }, [harnessData])

  // Default-select the newest run when none is selected.
  useEffect(() => {
    if (!selectedId && runs.length > 0) {
      setSelectedId(runs[0].id)
    }
  }, [runs, selectedId])

  const handleLaunched = useCallback((run) => {
    setOptimistic((prev) => [run, ...prev.filter((r) => r.id !== run.id)])
    setSelectedId(run.id)
  }, [])
  const setFleetView = useCallback((next) => {
    setView(next)
    try {
      localStorage.setItem(FLEET_VIEW_KEY, next)
    } catch {
      /* ignore persistence failures */
    }
  }, [])

  // Dashboard cards drill into the run detail. Uses the raw setter on purpose:
  // navigating into a run is not a view-preference change, so the persisted
  // dashboard default survives a reload.
  const drillIntoRun = useCallback((id) => {
    setSelectedId(id)
    setView('list')
  }, [])

  const onOpen = useCallback(
    (sessionId) => {
      if (onOpenSession) onOpenSession(sessionId)
    },
    [onOpenSession],
  )

  return (
    <div className="flex-1 flex overflow-hidden bg-[var(--mc-bg)]">
      {/* Left: run list */}
      {view === 'list' && (
        <div className="w-56 shrink-0 border-r border-[var(--mc-border)] flex flex-col overflow-hidden">
          <div className="h-10 shrink-0 px-3 border-b border-[var(--mc-border)] flex items-center">
            <span className="mc-eyebrow">Fleet Runs</span>
            <button
              type="button"
              onClick={() => setShowLaunch(true)}
              className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[11px] text-[var(--mc-accent-2)] hover:bg-[var(--mc-accent-soft)] transition-colors"
              title="New Fleet Run"
            >
              <Plus size={12} /> New
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {runs.length === 0 ? (
              <div className="text-[11px] text-[var(--mc-fg-5)] italic px-2 py-4 text-center">
                No fleet runs yet. Launch one to fan a goal across worktrees.
              </div>
            ) : (
              runs.map((run) => {
                const meta = RUN_STATUS[run.status] || RUN_STATUS.running
                return (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedId(run.id)}
                    className={[
                      'w-full text-left rounded px-2 py-2 transition-colors min-w-0',
                      selectedId === run.id
                        ? 'bg-[var(--mc-accent-soft)] border border-[var(--mc-accent-line)]'
                        : 'border border-transparent hover:bg-[var(--mc-surface-2)]',
                    ].join(' ')}
                  >
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                      <span className="text-xs text-[var(--mc-fg)] truncate flex-1 min-w-0">
                        {run.goal}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[var(--mc-fg-5)]">
                      <span>{run.status}</span>
                      <span>
                        {run.settledCount}/{run.childCount}
                      </span>
                    </div>
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* Right: selected run detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        <div className="sticky top-0 z-10 flex h-10 items-center gap-2 border-b border-[var(--mc-border)] bg-[var(--mc-bg)] px-3">
          <div className="flex rounded border border-[var(--mc-border)] bg-[var(--mc-surface)] p-0.5">
            <button
              type="button"
              onClick={() => setFleetView('list')}
              aria-pressed={view === 'list'}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                view === 'list'
                  ? 'bg-[var(--mc-surface-2)] text-[var(--mc-fg)]'
                  : 'text-[var(--mc-fg-4)]'
              }`}
            >
              <List size={12} /> List
            </button>
            <button
              type="button"
              onClick={() => setFleetView('dashboard')}
              aria-pressed={view === 'dashboard'}
              className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] ${
                view === 'dashboard'
                  ? 'bg-[var(--mc-surface-2)] text-[var(--mc-fg)]'
                  : 'text-[var(--mc-fg-4)]'
              }`}
            >
              <Grid2X2 size={12} /> Dashboard
            </button>
          </div>
          <button
            type="button"
            onClick={() => setShowLaunch(true)}
            className="ml-auto inline-flex items-center gap-1 rounded bg-[var(--mc-accent)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--mc-on-accent)] transition-colors hover:opacity-90"
          >
            <Plus size={12} /> New run
          </button>
        </div>
        {view === 'dashboard' && runs.length > 0 ? (
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {runs.map((run) => (
              <FleetDashboardCard
                key={run.id}
                run={run}
                selected={selectedId === run.id}
                onSelect={drillIntoRun}
              />
            ))}
          </div>
        ) : selectedId ? (
          <RunDetail runId={selectedId} version={fleetVersion} onOpenSession={onOpen} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--mc-accent-soft)] border border-[var(--mc-accent-line)]">
              <Layers size={26} className="text-[var(--mc-accent-2)]" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-base font-semibold text-[var(--mc-fg)]">
                {runs.length === 0 ? 'Launch your first fleet' : 'Pick a run to inspect'}
              </h2>
              <p className="text-sm text-[var(--mc-fg-4)] max-w-sm">
                Fleet fans a single goal across multiple child agents, each in its own git
                worktree/branch, then synthesizes the results.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowLaunch(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[var(--mc-accent)] text-[var(--mc-on-accent)] text-sm font-semibold hover:opacity-90 transition-colors"
            >
              Start your first run <span aria-hidden="true">-&gt;</span>
            </button>
          </div>
        )}
      </div>

      <LaunchDrawer
        open={showLaunch}
        onClose={() => setShowLaunch(false)}
        onLaunched={handleLaunched}
        onSaveTemplate={handleSaveTemplate}
        workflows={workflows}
        roots={roots}
        templates={templates}
      />
    </div>
  )
}
