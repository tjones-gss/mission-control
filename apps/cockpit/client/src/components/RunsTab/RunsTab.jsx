import { useState } from 'react'
import { Gauge, Workflow } from 'lucide-react'
import { ErrorBoundary } from '../ErrorBoundary.jsx'
import { MissionControlTab } from '../MissionControlTab/MissionControlTab.jsx'
import { ConductorTab } from '../ConductorTab/ConductorTab.jsx'

// Unified "drive a structured run" surface. Hosts the two existing surfaces
// behind a mode switch instead of two separate top-level tabs:
//   - Missions   → MissionControlTab (harness-governed projects, the rails)
//   - Conductor  → ConductorTab (ADR-driven conductor runs)
// The two surfaces are reused as-is; this wrapper only owns the mode toggle and
// threads each surface its existing props (harnessVersion / conductorVersion +
// sessions). The conductor escalation pipeline in App.jsx still feeds
// conductorVersion straight through.
const MODES = [
  { id: 'missions', label: 'Missions', icon: Gauge },
  { id: 'conductor', label: 'Conductor', icon: Workflow },
]

export function RunsTab({ harnessVersion, conductorVersion, sessions }) {
  const [mode, setMode] = useState('missions')

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode switch */}
      <div className="h-10 shrink-0 flex items-center gap-1 px-3 border-b border-gray-800">
        {MODES.map((m) => {
          const Icon = m.icon
          return (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors ${
                mode === m.id ? 'bg-gray-800 text-gray-100' : 'text-gray-500 hover:text-gray-300'
              }`}
              aria-pressed={mode === m.id}
            >
              <Icon size={12} />
              {m.label}
            </button>
          )
        })}
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
        {mode === 'missions' && (
          <ErrorBoundary>
            <MissionControlTab harnessVersion={harnessVersion} />
          </ErrorBoundary>
        )}
        {mode === 'conductor' && (
          <ErrorBoundary>
            <ConductorTab conductorVersion={conductorVersion} sessions={sessions} />
          </ErrorBoundary>
        )}
      </div>
    </div>
  )
}
