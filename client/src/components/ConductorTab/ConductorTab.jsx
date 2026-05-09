import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { RunDetail } from './RunDetail.jsx'
import { StartConductorDialog } from './StartConductorDialog.jsx'

function runKey(run) {
  return `${run.projectPath}::${run.adr}`
}

const PHASE_BADGE = {
  bootstrap: 'bg-gray-700 text-gray-200',
  plan: 'bg-blue-900/60 text-blue-200',
  build: 'bg-indigo-900/60 text-indigo-200',
  integration: 'bg-purple-900/60 text-purple-200',
  ship: 'bg-emerald-900/60 text-emerald-200',
  retrospective: 'bg-teal-900/60 text-teal-200',
  completed: 'bg-green-900/60 text-green-200',
  aborted: 'bg-red-900/60 text-red-200',
  escalated: 'bg-amber-900/60 text-amber-200',
}

function PhasePill({ phase }) {
  const cls = PHASE_BADGE[phase] || 'bg-gray-700 text-gray-200'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{phase}</span>
}

function MasterRow({ run, selected, onSelect }) {
  const iters = run.currentTaskId ? run.taskIters[run.currentTaskId] || 0 : 0
  const splits = run.currentTaskId ? run.splits[run.currentTaskId] || 0 : 0
  return (
    <button
      onClick={() => onSelect(run)}
      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
        selected
          ? 'bg-gray-800 text-gray-100'
          : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <PhasePill phase={run.phase} />
        <span className="font-mono text-gray-300">ADR {run.adr}</span>
        {run.isPaused && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>
      {run.currentTaskId && (
        <div className="mt-1 text-[10px] text-gray-500">
          task <span className="text-gray-400">{run.currentTaskId}</span> · iter {iters}/5
          {splits > 0 && (
            <span className={splits >= 2 ? 'text-amber-400' : 'text-gray-500'}>
              {' '}
              · splits {splits}
            </span>
          )}
        </div>
      )}
    </button>
  )
}

export function ConductorTab({ conductorVersion, sessions }) {
  const { data: runs, loading, error } = useApi('/api/conductor', [conductorVersion])
  const [selectedKey, setSelectedKey] = useState(null)
  const [showStart, setShowStart] = useState(false)

  // Group by project for the master list
  const grouped = useMemo(() => {
    const buckets = new Map()
    for (const run of runs || []) {
      const list = buckets.get(run.projectPath) || []
      list.push(run)
      buckets.set(run.projectPath, list)
    }
    return [...buckets.entries()]
      .map(([projectPath, list]) => ({
        projectPath,
        projectLabel: list[0].projectLabel,
        runs: list,
      }))
      .sort((a, b) => a.projectLabel.localeCompare(b.projectLabel))
  }, [runs])

  // Auto-select first run when data loads
  useEffect(() => {
    if (!selectedKey && runs?.length) {
      setSelectedKey(runKey(runs[0]))
    }
  }, [runs, selectedKey])

  const selectedRun = useMemo(
    () => (runs || []).find((r) => runKey(r) === selectedKey) || null,
    [runs, selectedKey],
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Master pane */}
      <div className="w-72 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950">
        <div className="h-10 shrink-0 flex items-center px-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Conductor Runs
          </span>
          {runs && <span className="ml-2 text-xs text-gray-500">{runs.length}</span>}
          <button
            onClick={() => setShowStart(true)}
            className="ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
            title="Start a new /conductor run"
          >
            <Plus size={12} />
            Start
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2 py-2 space-y-3">
          {loading && !runs && <div className="px-2 py-1 text-xs text-gray-600">Loading…</div>}
          {error && <div className="px-2 py-1 text-xs text-red-400">{error}</div>}
          {runs && runs.length === 0 && (
            <div className="px-2 py-3 text-xs text-gray-600">
              No conductor runs detected. Start one with the button above, or run{' '}
              <code className="text-gray-400">/conductor &lt;NNNN&gt;</code> in any project that has
              the harness installed.
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.projectPath} className="space-y-1">
              <div className="px-2 text-[10px] uppercase tracking-wider text-gray-600 truncate">
                {group.projectLabel}
              </div>
              {group.runs.map((run) => (
                <MasterRow
                  key={runKey(run)}
                  run={run}
                  selected={selectedKey === runKey(run)}
                  onSelect={(r) => setSelectedKey(runKey(r))}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedRun ? (
          <RunDetail run={selectedRun} conductorVersion={conductorVersion} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-gray-600">
            Select a run on the left.
          </div>
        )}
      </div>

      {showStart && (
        <StartConductorDialog
          sessions={sessions}
          onClose={() => setShowStart(false)}
          onStarted={() => setShowStart(false)}
        />
      )}
    </div>
  )
}
