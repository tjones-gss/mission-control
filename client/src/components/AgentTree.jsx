import { Bot, GitBranch, MessageSquare } from 'lucide-react'

function timeRange(start, end) {
  if (!start || !end) return ''
  const ms = new Date(end) - new Date(start)
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.round(s / 60)}m`
}

export function AgentTree({ session }) {
  if (!session) return (
    <div className="p-6 text-gray-600 text-sm">Select a session to inspect its agent tree</div>
  )

  const { agentTree, slug, sessionId } = session

  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-gray-300">{slug || sessionId.slice(0, 8)}</h2>
        <p className="text-xs text-gray-600 mt-0.5">{sessionId}</p>
        {session.cwd && (
          <p className="text-xs text-gray-700 mt-0.5 truncate">{session.cwd}</p>
        )}
      </div>

      {/* Main agent */}
      <div className="flex items-start gap-3 mb-4">
        <div className="mt-0.5 w-6 h-6 rounded bg-indigo-700 flex items-center justify-center shrink-0">
          <Bot size={14} />
        </div>
        <div>
          <div className="text-sm font-medium text-indigo-300">Main Agent</div>
          <div className="text-xs text-gray-500 mt-0.5">
            <MessageSquare size={10} className="inline mr-1" />
            {agentTree?.mainMessageCount || 0} messages
          </div>
        </div>
      </div>

      {/* Subagents */}
      {agentTree?.subagents?.length > 0 && (
        <div className="ml-3 border-l border-gray-800 pl-4 space-y-3">
          {agentTree.subagents.map((sub, i) => (
            <div key={sub.toolUseId || i} className="flex items-start gap-3">
              <div className="mt-0.5 w-5 h-5 rounded bg-purple-900 flex items-center justify-center shrink-0">
                <GitBranch size={11} />
              </div>
              <div>
                <div className="text-xs font-medium text-purple-300">Subagent {i + 1}</div>
                <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">{sub.description}</div>
                <div className="text-xs text-gray-600 mt-1 flex gap-3">
                  <span>{sub.messageCount} msgs</span>
                  {sub.startTime && sub.endTime && (
                    <span>{timeRange(sub.startTime, sub.endTime)}</span>
                  )}
                  {sub.model && <span className="text-gray-700">{sub.model?.split('-').slice(-2).join('-')}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {(!agentTree?.subagents?.length) && (
        <div className="ml-3 pl-4 text-xs text-gray-700">No subagents in this session</div>
      )}
    </div>
  )
}
