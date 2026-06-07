import { useState, useCallback } from 'react'
import { useApi } from '../hooks/useApi.js'
import { Bot, GitBranch, MessageSquare, GitCommit, Zap } from 'lucide-react'
import { ConversationView } from './ConversationView.jsx'
import { TimelineView } from './TimelineView.jsx'
import { IntelView } from './IntelView.jsx'
import { SessionControlBar } from './SessionControlBar.jsx'
import { PlanViewer } from './PlanViewer.jsx'
import { InspectPanel } from './InspectPanel/InspectPanel.jsx'
import { TokenBreakdownFull } from './TokenBreakdown.jsx'
import { CostSparkline } from './CostSparkline.jsx'
import { formatCost } from '../utils/cost.js'

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
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono ${color}`}
    >
      {name} <span className="opacity-60">×{count}</span>
    </span>
  )
}

function SkillPicker({ sessionId, skills }) {
  const [selectedSkill, setSelectedSkill] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  const userSkills = skills?.userSkills || []
  const pluginSkills = skills?.pluginSkills || []
  const allSkills = [...userSkills, ...pluginSkills]

  const handleRun = useCallback(async () => {
    if (!selectedSkill || !sessionId || running) return
    setRunning(true)
    setError(null)
    try {
      const res = await fetch(`/api/sessions/${sessionId}/skill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skill: selectedSkill }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || body.error || `HTTP ${res.status}`)
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setRunning(false)
    }
  }, [selectedSkill, sessionId, running])

  if (allSkills.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      <Zap size={11} className="text-gray-600" />
      <select
        value={selectedSkill}
        onChange={(e) => {
          setSelectedSkill(e.target.value)
          setError(null)
        }}
        className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-xs text-gray-400 focus:outline-none focus:border-indigo-500"
      >
        <option value="">Skill...</option>
        {allSkills.map((s) => (
          <option key={s.name} value={s.name}>
            {s.command || `/${s.name}`}
          </option>
        ))}
      </select>
      <button
        onClick={handleRun}
        disabled={!selectedSkill || running}
        className="px-1.5 py-0.5 rounded bg-purple-700 text-white text-[10px] hover:bg-purple-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        {running ? 'Running...' : 'Run'}
      </button>
      {error && (
        <span className="text-[10px] text-red-400 truncate max-w-[120px]" title={error}>
          Failed
        </span>
      )}
    </div>
  )
}

export function AgentTree({
  session,
  sessionUpdateVersion,
  intelligenceVersion,
  configVersion,
  memoryVersion,
  hooksVersion,
  skills,
  streaming,
}) {
  const [subTab, setSubTab] = useState('conversation')
  const [sessionOptions, setSessionOptions] = useState({
    permissionMode: '',
    model: '',
    effort: '',
  })
  const [compacting, setCompacting] = useState(false)

  // Fetch messages for sparkline (only when summary tab is active)
  const { data: messagesData } = useApi(
    subTab === 'summary' && session?.sessionId
      ? `/api/sessions/${session.sessionId}/messages`
      : null,
    [sessionUpdateVersion],
  )

  const handleCompact = useCallback(async () => {
    if (!session?.sessionId || compacting) return
    setCompacting(true)
    try {
      await fetch(`/api/sessions/${session.sessionId}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '/compact' }),
      })
    } catch {
      /* ignore */
    } finally {
      setCompacting(false)
    }
  }, [session?.sessionId, compacting])

  if (!session) return <div className="p-6 text-gray-600 text-sm">Select a session to inspect</div>

  const {
    agentTree,
    slug,
    sessionId,
    cwd,
    model,
    gitBranch,
    lastThought,
    lastText,
    lastAction,
    toolUseCounts,
  } = session

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Sub-tab bar */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-gray-800 shrink-0 overflow-x-auto no-scrollbar">
        {['conversation', 'timeline', 'summary', 'intel', 'plans', 'inspect'].map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-2.5 py-1 rounded text-xs capitalize transition-colors whitespace-nowrap ${
              subTab === tab ? 'bg-gray-800 text-gray-100' : 'text-gray-600 hover:text-gray-400'
            }`}
          >
            {tab}
          </button>
        ))}
        <div className="ml-auto shrink-0">
          <SkillPicker sessionId={session?.sessionId} skills={skills} />
        </div>
      </div>

      {/* Session control bar */}
      <SessionControlBar
        session={session}
        sessionOptions={sessionOptions}
        onOptionsChange={setSessionOptions}
      />

      {/* Sub-tab content */}
      {subTab === 'conversation' && (
        <div className="flex-1 overflow-hidden">
          <ConversationView
            sessionId={session?.sessionId}
            sessionUpdateVersion={sessionUpdateVersion}
            active={subTab === 'conversation'}
            sessionOptions={sessionOptions}
            skills={skills}
            streaming={streaming}
          />
        </div>
      )}

      {subTab === 'timeline' && (
        <div className="flex-1 overflow-hidden">
          <TimelineView
            sessionId={session?.sessionId}
            sessionUpdateVersion={sessionUpdateVersion}
            active={subTab === 'timeline'}
          />
        </div>
      )}

      {subTab === 'intel' && (
        <div className="flex-1 overflow-hidden">
          <IntelView
            sessionId={session?.sessionId}
            intelligenceVersion={intelligenceVersion}
            active={subTab === 'intel'}
          />
        </div>
      )}

      {subTab === 'plans' && (
        <div className="flex-1 overflow-hidden">
          <PlanViewer />
        </div>
      )}

      {subTab === 'inspect' && (
        <div className="flex-1 overflow-hidden">
          <InspectPanel
            sessionId={session?.sessionId}
            configVersion={configVersion}
            memoryVersion={memoryVersion}
            hooksVersion={hooksVersion}
          />
        </div>
      )}

      {subTab === 'summary' && (
        <div className="flex-1 p-4 overflow-y-auto space-y-4">
          {/* Header */}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-xs text-gray-400">
                {slug || sessionId.slice(0, 8)}
              </span>
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
              <div className="text-[10px] text-gray-700 font-mono truncate" title={cwd}>
                {cwd}
              </div>
            )}
          </div>

          {/* Thinking section */}
          {lastThought && (
            <div className="rounded-lg border-l-2 border-amber-700 bg-amber-900/20 p-3 space-y-1">
              <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">
                THINK
              </div>
              <div className="text-xs text-amber-200/70 font-mono leading-relaxed">
                {lastThought}
              </div>
            </div>
          )}

          {/* Output section */}
          {lastText && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-cyan-500 uppercase tracking-wider">
                OUT
              </div>
              <div className="text-xs text-cyan-100/80 leading-relaxed">{lastText}</div>
            </div>
          )}

          {/* Last action section */}
          {lastAction && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                ACT
              </div>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] ${TOOL_COLORS[lastAction.name] || DEFAULT_TOOL_COLOR}`}
                >
                  {lastAction.name}
                </span>
                <span className="text-gray-500 truncate">{lastAction.summary}</span>
              </div>
            </div>
          )}

          {/* Tools used */}
          {toolUseCounts && Object.keys(toolUseCounts).length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                TOOLS
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(toolUseCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, count]) => (
                    <ToolPill key={name} name={name} count={count} />
                  ))}
              </div>
            </div>
          )}

          {/* Token breakdown + cost */}
          {session.tokenUsage && (
            <TokenBreakdownFull tokenUsage={session.tokenUsage} model={session.model} />
          )}

          {/* Cost sparkline */}
          {messagesData?.messages?.length > 1 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                Cost Over Time
              </div>
              <CostSparkline
                messages={messagesData.messages}
                model={session.model}
                width={300}
                height={48}
              />
            </div>
          )}

          {/* Session actions */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCompact}
              disabled={compacting}
              className="px-2.5 py-1 rounded text-xs bg-gray-800 text-gray-400 hover:text-gray-200 hover:bg-gray-700 disabled:opacity-30 transition-colors border border-gray-700"
            >
              {compacting ? 'Compacting...' : 'Compact Session'}
            </button>
            {session.hasBeenCompacted && (
              <span className="text-[10px] text-amber-600">Previously compacted</span>
            )}
          </div>

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
                      <div className="text-xs font-medium text-purple-300 flex items-center gap-1.5">
                        Agent {i + 1}
                        {sub.agentType && (
                          <span className="px-1 py-0.5 rounded bg-purple-900/60 text-purple-400 text-[9px] font-normal">
                            {sub.agentType}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5 line-clamp-2">
                        {sub.description}
                      </div>
                      <div className="text-xs text-gray-600 mt-1 flex gap-3">
                        <span>{sub.messageCount} msgs</span>
                        {sub.startTime && sub.endTime && (
                          <span>{timeRange(sub.startTime, sub.endTime)}</span>
                        )}
                        {sub.model && (
                          <span className="text-gray-700">
                            {sub.model.split('-').slice(-2).join('-')}
                          </span>
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
