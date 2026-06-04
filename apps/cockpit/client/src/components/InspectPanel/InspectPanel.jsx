import { useState } from 'react'
import { ConfigViewer } from '../ConfigViewer.jsx'
import { HooksPanel } from '../HooksPanel.jsx'
import { McpDashboard } from '../McpDashboard.jsx'
import { MemoryViewer } from '../MemoryViewer.jsx'

// Folds the four read-only inspectors (Config, Hooks, MCP, Memory) into a single
// "Inspect" surface with an inner sub-tab strip. Each child keeps its own fetch
// logic via useApi; InspectPanel only threads the relevant live-refetch version
// into the matching child so config_update / hooks_update / memory_update events
// actually retrigger a fetch. (MCP has no SSE channel yet, so mcpVersion is left
// at its default.)
const SECTIONS = ['config', 'hooks', 'mcp', 'memory']

export function InspectPanel({ sessionId, configVersion = 0, hooksVersion = 0, memoryVersion = 0 }) {
  const [section, setSection] = useState('config')

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Inner sub-tab strip */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800 shrink-0 overflow-x-auto no-scrollbar">
        {SECTIONS.map((id) => (
          <button
            key={id}
            onClick={() => setSection(id)}
            className={`px-2.5 py-1 rounded text-xs capitalize transition-colors whitespace-nowrap ${
              section === id ? 'bg-gray-800 text-gray-100' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {id}
          </button>
        ))}
      </div>

      {/* Section content */}
      <div className="flex-1 overflow-hidden">
        {section === 'config' && (
          <ConfigViewer sessionId={sessionId} configVersion={configVersion} />
        )}
        {section === 'hooks' && <HooksPanel hooksVersion={hooksVersion} />}
        {section === 'mcp' && <McpDashboard />}
        {section === 'memory' && (
          <MemoryViewer sessionId={sessionId} memoryVersion={memoryVersion} />
        )}
      </div>
    </div>
  )
}
