import { useState } from 'react'
import { Bot, GitBranch, MessageSquare, GitCommit } from 'lucide-react'

function timeRange(start, end) {
  if (!start || !end) return ''
  const ms = new Date(end) - new Date(start)
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`
}

export const TOOL_COLORS = {
  Bash: 'bg-orange-900/60 text-orange-300',
  Read: 'bg-blue-900/60 text-blue-300',
  Write: 'bg-green-900/60 text-green-300',
  Edit: 'bg-yellow-900/60 text-yellow-300',
  MultiEdit: 'bg-yellow-900/60 text-yellow-300',
  Agent: 'bg-purple-900/60 text-purple-300',
}
const DEFAULT_TOOL_COLOR = 'bg-gray-800 text-gray-400'

function ToolPill({ name, count }) {
  const color = TOOL_COLORS[name] || DEFAULT_TOOL_COLOR
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${color}`}>
      {name} <span className="opacity-60">×{count}</span>
    </span>
  )
}

export function AgentTree({ session, sessionUpdateVersion }) {
  const [subTab, setSubTab] = useState('conversation')

  if (!session) return (
    <div className="p-6 text-gray-600 text-sm">Select a session to inspect</div>
  )

  const { agentTree, slug, sessionId, cwd, model, gitBranch, lastThought, lastText, lastAction, toolUseCounts } = session

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex gap-1 px-3 py-2 border-b border-gray-800 shrink-0">
        {['conversation', 'timeline', 'summary'].map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-2.5 py-1 rounded text-xs capitalize transition-colors ${
              subTab === tab
                ? 'bg-gray-800 text-gray-100'
                : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Sub-tab content */}
      {subTab === 'conversation' && (
        <div className="flex-1 overflow-hidden">
          {/* ConversationView placeholder — will be implemented in Task 3 */}
          <div className="p-4 text-xs text-gray-600">Conversation view coming soon</div>
        </div>
      )}

      {subTab === 'timeline' && (
        <div className="flex-1 overflow-hidden">
          {/* TimelineView placeholder — will be implemented in Task 4 */}
          <div className="p-4 text-xs text-gray-600">Timeline view coming soon</div>
        </div>
      )}

      {subTab === 'summary' && (
        <div className="flex-1 p-4 overflow-y-auto space-y-4">

          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-gray-400">{slug || sessionId.slice(0, 8)}</span>
              <span className="font-mono text-xs text-gray-700">{sessionId.slice(0, 16)}…</span>
              {gitBranch && (
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800 text-green-400 text-[10px] font-mono">
                  <GitCommit size={9} />
                  {gitBranch}
                </span>
              )}
              {model && (
                <span className="px-1.5 py-0.5 rounded bg-gray-800 text-indigo-400 text-[10px] font-mono">
                  {model.split('-').slice(-2).join('-')}
                </span>
              )}
            </div>
            {cwd && (
              <div className="text-[10px] text-gray-700 font-mono truncate" title={cwd}>{cwd}</div>
            )}
          </div>

          {/* Thinking section */}
          {lastThought && (
            <div className="rounded-lg border-l-2 border-amber-700 bg-amber-900/20 p-3 space-y-1">
              <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">THINK</div>
              <div className="text-xs text-amber-200/70 font-mono leading-relaxed">{lastThought}</div>
            </div>
          )}

          {/* Output section */}
          {lastText && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-cyan-500 uppercase tracking-wider">OUT</div>
              <div className="text-xs text-cyan-100/80 leading-relaxed">{lastText}</div>
            </div>
          )}

          {/* Last action section */}
          {lastAction && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">ACT</div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className={`px-1.5 py-0.5 rounded text-[10px] ${TOOL_COLORS[lastAction.name] || DEFAULT_TOOL_COLOR}`}>
                  {lastAction.name}
                </span>
                <span className="text-gray-500 truncate">{lastAction.summary}</span>
              </div>
            </div>
          )}

          {/* Tools used */}
          {toolUseCounts && Object.keys(toolUseCounts).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">TOOLS</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(toolUseCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => (
                    <ToolPill key={name} name={name} count={count} />
                  ))}
              </div>
            </div>
          )}

          {/* Subagents */}
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
              SUBAGENTS ({agentTree?.subagents?.length || 0})
            </div>
            {agentTree?.subagents?.length > 0 ? (
              <div className="ml-1 border-l border-gray-800 pl-3 space-y-3">
                {agentTree.subagents.map((sub, i) => (
                  <div key={sub.toolUseId || i} className="flex items-start gap-2">
                    <div className="mt-0.5 w-4 h-4 rounded bg-purple-900 flex items-center justify-center shrink-0">
                      <GitBranch size={9} />
                    </div>
                    <div>
                      <div className="text-xs font-medium text-purple-300">Agent {i + 1}</div>
                      <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{sub.description}</div>
                      <div className="text-xs text-gray-600 mt-1 flex gap-3">
                        <span>{sub.messageCount} msgs</span>
                        {sub.startTime && sub.endTime && (
                          <span>{timeRange(sub.startTime, sub.endTime)}</span>
                        )}
                        {sub.model && (
                          <span className="text-gray-700">{sub.model.split('-').slice(-2).join('-')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="ml-1 pl-3 text-xs text-gray-700">No subagents</div>
            )}
          </div>

        </div>
      )}
    </div>
  )
}
