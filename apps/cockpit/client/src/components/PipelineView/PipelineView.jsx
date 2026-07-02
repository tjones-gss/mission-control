import { useEffect, useState } from 'react'
import { Activity, PencilRuler } from 'lucide-react'
import { useApi } from '../../hooks/useApi.js'
import { LoadingState, ErrorState } from '../ui/States.jsx'
import { PipelineCanvas } from '../PipelineCanvas/index.js'
import { LiveRun } from './LiveRun.jsx'

// Runs · Pipeline. The mode's face is the LIVE view: the real harness pipeline
// of a governed project, straight from `harness status --json` (read-only —
// the council brief's "render the rails, don't fake the Composer" ruling).
// The canvas composer remains available one click away under Compose.
const SUB_VIEWS = [
  { id: 'live', label: 'Live', icon: Activity },
  { id: 'compose', label: 'Compose', icon: PencilRuler },
]

export function PipelineView({ harnessVersion }) {
  const [subView, setSubView] = useState('live')
  const [selectedKey, setSelectedKey] = useState(null)
  const { data, loading, error, refetch } = useApi('/api/harness', [harnessVersion])
  const projects = data?.projects || []

  // Keep a valid selection: default to the first project, and recover when the
  // selected project disappears (harness root removed between refetches).
  useEffect(() => {
    if (projects.length === 0) return
    if (!selectedKey || !projects.some((p) => p.projectKey === selectedKey)) {
      setSelectedKey(projects[0].projectKey)
    }
  }, [projects, selectedKey])

  const selected = projects.find((p) => p.projectKey === selectedKey) || null

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-9 shrink-0 flex items-center gap-1 px-3 border-b border-[color:var(--mc-border)]">
        {SUB_VIEWS.map((v) => {
          const Icon = v.icon
          return (
            <button
              key={v.id}
              onClick={() => setSubView(v.id)}
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] transition-colors ${
                subView === v.id
                  ? 'bg-[color:var(--mc-surface-2)] text-[color:var(--mc-fg)]'
                  : 'text-[color:var(--mc-fg-4)] hover:text-[color:var(--mc-fg-2)]'
              }`}
              aria-pressed={subView === v.id}
            >
              <Icon size={11} />
              {v.label}
            </button>
          )
        })}
      </div>

      {subView === 'compose' ? (
        <PipelineCanvas />
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {loading && !data ? (
            <LoadingState label="Discovering governed projects…" className="m-4" />
          ) : error ? (
            <ErrorState message={error} onRetry={refetch} className="m-4" />
          ) : projects.length === 0 ? (
            <div className="m-4 text-sm text-[color:var(--mc-fg-4)]">
              <div className="text-[color:var(--mc-fg-2)]">No governed projects</div>
              <div className="mt-1 text-xs">
                Live shows the running harness pipeline — phases, the active gate, missions — for
                any project with <code>.harness/</code> rails. Start one from Runs · Missions, or
                switch to Compose to draft a pipeline on the canvas.
              </div>
            </div>
          ) : (
            <>
              <nav
                className="w-56 shrink-0 border-r border-[color:var(--mc-border)] overflow-y-auto"
                aria-label="Governed projects"
              >
                {projects.map((p) => (
                  <button
                    key={p.projectKey}
                    onClick={() => setSelectedKey(p.projectKey)}
                    className={`w-full text-left px-3 py-2 border-b border-[color:var(--mc-border)] transition-colors ${
                      p.projectKey === selectedKey
                        ? 'bg-[color:var(--mc-surface-2)]'
                        : 'hover:bg-[color:var(--mc-surface)]'
                    }`}
                    aria-current={p.projectKey === selectedKey ? 'true' : undefined}
                  >
                    <div className="text-xs text-[color:var(--mc-fg)] truncate">
                      {p.projectLabel}
                    </div>
                    <div className="mt-0.5 text-[10px] text-[color:var(--mc-fg-4)] truncate">
                      {!p.available
                        ? 'unavailable'
                        : p.blocked
                          ? `blocked · ${p.pipeline?.gate || 'gate'}`
                          : p.pipeline?.phase || 'idle'}
                    </div>
                  </button>
                ))}
              </nav>
              <div className="flex-1 overflow-y-auto">
                <LiveRun project={selected} harnessVersion={harnessVersion} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
