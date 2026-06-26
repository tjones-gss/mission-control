import { useState, useCallback, useEffect, useMemo } from 'react'
import { Layers, Plus } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { LaunchDrawer } from './LaunchDrawer.jsx'
import { RunDetail, RUN_STATUS } from './FleetRunDetail.jsx'

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
export function FleetTab({ fleetVersion = 0, onOpenSession }) {
  const [showLaunch, setShowLaunch] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
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

  const onOpen = useCallback(
    (sessionId) => {
      if (onOpenSession) onOpenSession(sessionId)
    },
    [onOpenSession],
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: run list */}
      <div className="w-56 shrink-0 border-r border-gray-800 flex flex-col overflow-hidden">
        <div className="h-10 shrink-0 px-3 border-b border-gray-800 flex items-center">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Fleet Runs
          </span>
          <button
            type="button"
            onClick={() => setShowLaunch(true)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-[11px] text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
            title="New Fleet Run"
          >
            <Plus size={12} /> New
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {runs.length === 0 ? (
            <div className="text-[11px] text-gray-600 italic px-2 py-4 text-center">
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
                      ? 'bg-indigo-900/30 border border-indigo-700'
                      : 'border border-transparent hover:bg-gray-800/60',
                  ].join(' ')}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${meta.dot}`} />
                    <span className="text-xs text-gray-200 truncate flex-1 min-w-0">
                      {run.goal}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-600">
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

      {/* Right: selected run detail */}
      <div className="flex-1 min-w-0 overflow-y-auto">
        {selectedId ? (
          <RunDetail runId={selectedId} version={fleetVersion} onOpenSession={onOpen} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-3 p-6">
            <Layers size={28} className="text-gray-700" />
            <p className="text-sm text-gray-500 max-w-sm">
              Fleet fans a single goal across multiple child agents, each in its own git
              worktree/branch, then synthesizes the results.
            </p>
            <button
              type="button"
              onClick={() => setShowLaunch(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
            >
              <Plus size={14} /> New Fleet Run
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
