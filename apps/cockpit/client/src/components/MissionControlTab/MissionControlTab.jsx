import { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { HarnessDetail } from './HarnessDetail.jsx'
import { NewHarnessProjectDialog } from './NewHarnessProjectDialog.jsx'

const MODE_BADGE = {
  'idea-to-mvp': 'bg-blue-900/60 text-blue-200',
  'existing-repo-retrofit': 'bg-purple-900/60 text-purple-200',
}

function ModePill({ mode }) {
  if (!mode) return null
  const cls = MODE_BADGE[mode] || 'bg-gray-700 text-gray-200'
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cls}`}>{mode}</span>
}

function MasterRow({ project, selected, onSelect }) {
  const phase = project.pipeline?.phase
  return (
    <button
      onClick={() => onSelect(project)}
      className={`w-full text-left px-2 py-1.5 rounded text-xs transition-colors ${
        selected
          ? 'bg-gray-800 text-gray-100'
          : 'text-gray-400 hover:bg-gray-900 hover:text-gray-200'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-gray-300 truncate">{project.projectLabel}</span>
        {project.blocked && (
          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
        )}
      </div>
      {project.available ? (
        <div className="mt-1 space-y-0.5">
          <div className="flex items-center gap-1.5 flex-wrap">
            <ModePill mode={project.mode} />
            {phase && <span className="text-[10px] text-gray-500">phase {phase}</span>}
          </div>
          {project.currentMission && (
            <div className="text-[10px] text-gray-500 truncate">
              mission <span className="text-gray-400">{project.currentMission}</span>
            </div>
          )}
          {project.blocked && (
            <div className="text-[10px] text-amber-400 truncate">
              blocked by gate: {project.pipeline?.gate || project.blocker || 'unknown'}
            </div>
          )}
          {!project.blocked && project.next?.recommended_action && (
            <div className="text-[10px] text-gray-500 truncate">
              next: {project.next.recommended_action}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-1 text-[10px] text-red-400/80">harness unavailable</div>
      )}
    </button>
  )
}

export function MissionControlTab({ harnessVersion }) {
  const { data, loading, error, refetch } = useApi('/api/harness', [harnessVersion])
  const [selectedKey, setSelectedKey] = useState(null)
  const [showNewDialog, setShowNewDialog] = useState(false)

  const projects = useMemo(() => {
    const list = data?.projects || []
    return [...list].sort((a, b) => a.projectLabel.localeCompare(b.projectLabel))
  }, [data])

  // Auto-select first project when data loads
  useEffect(() => {
    if (!selectedKey && projects.length) {
      setSelectedKey(projects[0].projectKey)
    }
  }, [projects, selectedKey])

  const selectedProject = useMemo(
    () => projects.find((p) => p.projectKey === selectedKey) || null,
    [projects, selectedKey],
  )

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Master pane */}
      <div className="w-72 shrink-0 border-r border-gray-800 flex flex-col bg-gray-950">
        <div className="h-10 shrink-0 flex items-center px-3 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Mission Control
          </span>
          {data && <span className="ml-2 text-xs text-gray-500">{projects.length}</span>}
          <button
            onClick={() => setShowNewDialog(true)}
            className="ml-auto flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium text-gray-400 hover:text-gray-100 hover:bg-gray-800 transition-colors"
            title="Create a new harness project"
          >
            <Plus size={12} />
            New
          </button>
        </div>
        <div className="flex-1 overflow-auto px-2 py-2 space-y-1">
          {loading && !data && <div className="px-2 py-1 text-xs text-gray-600">Loading…</div>}
          {error && <div className="px-2 py-1 text-xs text-red-400">{error}</div>}
          {data && projects.length === 0 && (
            <div className="px-2 py-3 space-y-2 text-xs text-gray-600">
              <p>
                No governed projects found. A project becomes visible here once it has a{' '}
                <code className="text-gray-400">.harness/</code> directory and the harness CLI can
                report its status.
              </p>
              <button
                onClick={() => setShowNewDialog(true)}
                className="flex items-center gap-1 px-2 py-1 rounded bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-500 transition-colors"
              >
                <Plus size={12} />
                New harness project
              </button>
            </div>
          )}
          {projects.map((project) => (
            <MasterRow
              key={project.projectKey}
              project={project}
              selected={selectedKey === project.projectKey}
              onSelect={(p) => setSelectedKey(p.projectKey)}
            />
          ))}
        </div>
      </div>

      {/* Detail pane */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {selectedProject ? (
          <HarnessDetail project={selectedProject} harnessVersion={harnessVersion} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-gray-600">
            Select a project on the left.
          </div>
        )}
      </div>

      {showNewDialog && (
        <NewHarnessProjectDialog
          onClose={() => setShowNewDialog(false)}
          onCreated={() => {
            setShowNewDialog(false)
            // The watcher's harness_update will also bump harnessVersion, but
            // refetch immediately so the new project shows without waiting.
            refetch()
          }}
        />
      )}
    </div>
  )
}
