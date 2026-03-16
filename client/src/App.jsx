import { useState, useCallback, useEffect, useMemo } from 'react'
import { Eye, GitBranch, ListTodo, Command, HelpCircle, LayoutGrid, List, ArrowLeft, Bell, Settings, Plus } from 'lucide-react'
import { useApi } from './hooks/useApi.js'
import { useSSE } from './hooks/useSSE.js'
import { useNotifications, getNotificationPrefs } from './hooks/useNotifications.js'
import { useSound } from './hooks/useSound.js'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { SessionsList } from './components/SessionsList.jsx'
import { AgentTree } from './components/AgentTree.jsx'
import { KanbanBoard } from './components/KanbanBoard.jsx'
import { TaskBoard } from './components/TaskBoard.jsx'
import { WorkflowsPanel } from './components/WorkflowsPanel.jsx'
import { SkillsPanel } from './components/SkillsPanel.jsx'
import { LiveFeed } from './components/LiveFeed.jsx'
import { LegendModal } from './components/LegendModal.jsx'
import { SettingsModal } from './components/SettingsModal.jsx'
import { ShortcutHelpOverlay } from './components/ShortcutHelpOverlay.jsx'
import { projectLabel } from './utils/session.js'

const TABS = [
  { id: 'agents', label: 'Agents', icon: Eye },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'skills', label: 'Skills', icon: Command },
]

// Map SSE event types to sound event names
const SSE_SOUND_MAP = {
  session_update: 'sessionUpdate',
  task_update: 'taskUpdate',
  intelligence_update: 'intelligenceReady',
  new_session: 'newSession',
  team_update: 'teamUpdate',
  history_update: 'historyUpdate',
}

export default function App() {
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [activeTab, setActiveTab] = useState('agents')
  const [agentView, setAgentView] = useState('board') // 'board' | 'detail'
  const [showLegend, setShowLegend] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [events, setEvents] = useState([])
  const [sessionsVersion, setSessionsVersion] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)
  const [intelligenceVersion, setIntelligenceVersion] = useState(0)

  const { data: sessions, refetch: refetchSessions } = useApi('/api/sessions', [sessionsVersion])
  const { data: tasks, loading: tasksLoading, refetch: refetchTasks } = useApi(
    selectedSessionId ? `/api/tasks/${selectedSessionId}` : null,
    [selectedSessionId, tasksVersion]
  )
  const { data: workflows, loading: workflowsLoading, refetch: refetchWorkflows } = useApi('/api/workflows')
  const { data: skills, loading: skillsLoading, refetch: refetchSkills } = useApi('/api/skills')

  // Auto-select first active session
  useEffect(() => {
    if (sessions?.length && !selectedSessionId) {
      const active = sessions.find(s => s.isActive) || sessions[0]
      setSelectedSessionId(active.sessionId)
    }
  }, [sessions, selectedSessionId])

  const selectedSession = sessions?.find(s => s.sessionId === selectedSessionId)

  // Sound engine
  const soundEngine = useSound()

  const { connected } = useSSE(useCallback(evt => {
    setEvents(prev => [...prev.slice(-199), evt])
    if (evt.type === 'session_update' || evt.type === 'new_session') {
      setSessionsVersion(v => v + 1)
    }
    if (evt.type === 'task_update') {
      setTasksVersion(v => v + 1)
    }
    if (evt.type === 'intelligence_update') {
      setIntelligenceVersion(v => v + 1)
    }

    // Play sound for non-session events (needsInput is handled by useNotifications)
    const soundEvent = SSE_SOUND_MAP[evt.type]
    if (soundEvent && getNotificationPrefs().sound) {
      soundEngine.play(soundEvent, evt.sessionId ? { projectLabel: evt.projectLabel || 'session' } : undefined)
    }
  }, [soundEngine]))

  const activeSessions = sessions?.filter(s => s.isActive) || []
  const { requestPermission, muteSession, mutedIds } = useNotifications(sessions, soundEngine)
  const needsInputSessions = sessions?.filter(s => s.needsInput && !mutedIds.current.has(s.sessionId)) || []

  // Keyboard shortcuts
  const shortcutHandlers = useMemo(() => ({
    nextSession: () => {
      if (!sessions?.length) return
      const idx = sessions.findIndex(s => s.sessionId === selectedSessionId)
      const next = sessions[(idx + 1) % sessions.length]
      if (next) setSelectedSessionId(next.sessionId)
    },
    prevSession: () => {
      if (!sessions?.length) return
      const idx = sessions.findIndex(s => s.sessionId === selectedSessionId)
      const prev = sessions[(idx - 1 + sessions.length) % sessions.length]
      if (prev) setSelectedSessionId(prev.sessionId)
    },
    openDetail: () => setAgentView('detail'),
    backToBoard: () => {
      if (showSettings) setShowSettings(false)
      else if (showLegend) setShowLegend(false)
      else setAgentView('board')
    },
    tabAgents: () => setActiveTab('agents'),
    tabTasks: () => setActiveTab('tasks'),
    tabWorkflows: () => setActiveTab('workflows'),
    tabSkills: () => setActiveTab('skills'),
    quickApprove: () => {
      if (selectedSession?.needsInput) {
        fetch(`/api/sessions/${selectedSession.sessionId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'yes' }),
        })
      }
    },
    quickContinue: () => {
      if (selectedSession?.needsInput) {
        fetch(`/api/sessions/${selectedSession.sessionId}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'continue' }),
        })
      }
    },
    focusInput: () => {
      const input = document.querySelector('[data-shortcut-focus="message-input"]')
      if (input) input.focus()
    },
    showHelp: () => setShowShortcutHelp(prev => !prev),
    toggleSettings: () => setShowSettings(prev => !prev),
    toggleMute: () => {
      if (selectedSessionId) muteSession(selectedSessionId)
    },
  }), [sessions, selectedSessionId, selectedSession, showSettings, showLegend, muteSession])

  const { shortcuts, updateShortcut, resetDefaults: resetShortcuts } = useKeyboardShortcuts(shortcutHandlers)

  const [showNewSession, setShowNewSession] = useState(false)
  const [newSessionCwd, setNewSessionCwd] = useState('')
  const [newSessionPrompt, setNewSessionPrompt] = useState('')
  const [newSessionName, setNewSessionName] = useState('')
  const [newSessionModel, setNewSessionModel] = useState('')
  const [newSessionMode, setNewSessionMode] = useState('')
  const [newSessionEffort, setNewSessionEffort] = useState('')
  const [newSessionWorktree, setNewSessionWorktree] = useState(false)
  const [newSessionCreating, setNewSessionCreating] = useState(false)

  const handleNewSession = useCallback(async () => {
    if (!newSessionCwd.trim() || !newSessionPrompt.trim() || newSessionCreating) return
    setNewSessionCreating(true)
    try {
      const body = { cwd: newSessionCwd.trim(), prompt: newSessionPrompt.trim() }
      if (newSessionName.trim()) body.name = newSessionName.trim()
      if (newSessionWorktree) body.worktree = true
      const options = {}
      if (newSessionModel) options.model = newSessionModel
      if (newSessionMode) options.permissionMode = newSessionMode
      if (newSessionEffort) options.effort = newSessionEffort
      if (Object.keys(options).length > 0) body.options = options

      const res = await fetch('/api/sessions/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || data.error || `HTTP ${res.status}`)
      }
      setShowNewSession(false)
      setNewSessionCwd('')
      setNewSessionPrompt('')
      setNewSessionName('')
      setNewSessionModel('')
      setNewSessionMode('')
      setNewSessionEffort('')
      setNewSessionWorktree(false)
    } catch (e) {
      alert(`Failed to create session: ${e.message}`)
    } finally {
      setNewSessionCreating(false)
    }
  }, [newSessionCwd, newSessionPrompt, newSessionName, newSessionModel, newSessionMode, newSessionEffort, newSessionWorktree, newSessionCreating])

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-sm font-bold text-gray-200 tracking-tight">Oversight</span>
        <span className="ml-2 text-xs text-gray-600 tracking-tight">behind the agent curtain</span>
        {!connected && (
          <span className="ml-3 flex items-center gap-1.5 text-xs text-red-400" title="Live connection lost — reconnecting...">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
            disconnected
          </span>
        )}
        {activeSessions.length > 0 && (
          <span className="ml-3 flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {activeSessions.length} active
          </span>
        )}
        {needsInputSessions.length > 0 && (
          <button
            onClick={requestPermission}
            className="ml-3 flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
            title="Sessions waiting for input — click to enable desktop notifications"
          >
            <Bell size={12} />
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            {needsInputSessions.length} waiting
          </button>
        )}
        <nav className="ml-auto flex items-center gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                  activeTab === tab.id
                    ? 'bg-gray-800 text-gray-100'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                <Icon size={12} />
                {tab.label}
              </button>
            )
          })}
          <button
            onClick={() => setShowSettings(true)}
            className="ml-2 text-gray-600 hover:text-gray-400 transition-colors p-1 rounded"
            title="Settings (,)"
          >
            <Settings size={14} />
          </button>
          <button
            onClick={() => setShowLegend(true)}
            className="text-gray-600 hover:text-gray-400 transition-colors p-1 rounded"
            title="Help"
          >
            <HelpCircle size={14} />
          </button>
        </nav>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sessions list */}
        <aside className="w-56 shrink-0 border-r border-gray-800 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-gray-800 flex items-center">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Sessions</span>
            {sessions && (
              <span className="ml-2 text-xs text-gray-700">{sessions.length}</span>
            )}
            <button
              onClick={() => setShowNewSession(s => !s)}
              className="ml-auto text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
              title="New session"
            >
              <Plus size={14} />
            </button>
          </div>
          {showNewSession && (
            <div className="px-3 py-2 border-b border-gray-800 space-y-1.5 bg-gray-900/50">
              <input
                type="text"
                value={newSessionName}
                onChange={e => setNewSessionName(e.target.value)}
                placeholder="Session name (optional)..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={newSessionCwd}
                onChange={e => setNewSessionCwd(e.target.value)}
                placeholder="Working directory..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
              />
              <input
                type="text"
                value={newSessionPrompt}
                onChange={e => setNewSessionPrompt(e.target.value)}
                placeholder="Prompt..."
                className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-indigo-500"
                onKeyDown={e => { if (e.key === 'Enter') handleNewSession() }}
              />
              <div className="flex gap-1.5">
                <select
                  value={newSessionModel}
                  onChange={e => setNewSessionModel(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Model...</option>
                  <option value="sonnet">sonnet</option>
                  <option value="opus">opus</option>
                  <option value="haiku">haiku</option>
                </select>
                <select
                  value={newSessionMode}
                  onChange={e => setNewSessionMode(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Mode...</option>
                  <option value="plan">plan</option>
                  <option value="auto">auto</option>
                  <option value="default">default</option>
                  <option value="acceptEdits">acceptEdits</option>
                  <option value="dontAsk">dontAsk</option>
                  <option value="bypassPermissions">bypassPermissions</option>
                </select>
                <select
                  value={newSessionEffort}
                  onChange={e => setNewSessionEffort(e.target.value)}
                  className="flex-1 bg-gray-900 border border-gray-700 rounded px-1.5 py-1 text-[11px] text-gray-400 focus:outline-none focus:border-indigo-500"
                >
                  <option value="">Effort...</option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                  <option value="max">max</option>
                </select>
              </div>
              <label className="flex items-center gap-1.5 text-[11px] text-gray-500 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newSessionWorktree}
                  onChange={e => setNewSessionWorktree(e.target.checked)}
                  className="rounded border-gray-700 bg-gray-900 text-indigo-500 focus:ring-indigo-500 focus:ring-offset-0"
                />
                Worktree (isolated copy)
              </label>
              <button
                onClick={handleNewSession}
                disabled={!newSessionCwd.trim() || !newSessionPrompt.trim() || newSessionCreating}
                className="w-full px-2 py-1 rounded bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {newSessionCreating ? 'Creating...' : 'Create Session'}
              </button>
            </div>
          )}
          <SessionsList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onMuteSession={muteSession}
            onReplySession={id => { setSelectedSessionId(id); setAgentView('detail') }}
          />
        </aside>

        {/* Center: Main panel */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'agents' && (
            <>
              {/* Board / Detail toggle bar */}
              <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800 shrink-0">
                {agentView === 'detail' && (
                  <button
                    onClick={() => setAgentView('board')}
                    className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors mr-1"
                  >
                    <ArrowLeft size={12} /> Board
                  </button>
                )}
                <div className="ml-auto flex gap-1">
                  <button
                    onClick={() => setAgentView('board')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${agentView === 'board' ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:text-gray-400'}`}
                    title="Kanban board"
                  >
                    <LayoutGrid size={11} /> Board
                  </button>
                  <button
                    onClick={() => setAgentView('detail')}
                    className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${agentView === 'detail' ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:text-gray-400'}`}
                    title="Session detail"
                  >
                    <List size={11} /> Detail
                  </button>
                </div>
              </div>
              {agentView === 'board'
                ? <KanbanBoard
                    sessions={sessions || []}
                    selectedId={selectedSessionId}
                    onSelect={id => { setSelectedSessionId(id); setAgentView('detail') }}
                  />
                : <AgentTree session={selectedSession} sessionUpdateVersion={sessionsVersion} intelligenceVersion={intelligenceVersion} skills={skills} />
              }
            </>
          )}
          {activeTab === 'tasks' && (
            <TaskBoard tasks={tasks} loading={tasksLoading} sessionId={selectedSessionId} refetch={refetchTasks} />
          )}
          {activeTab === 'workflows' && <WorkflowsPanel workflows={workflows} loading={workflowsLoading} refetch={refetchWorkflows} skills={skills} />}
          {activeTab === 'skills' && <SkillsPanel skills={skills} loading={skillsLoading} refetch={refetchSkills} />}
        </main>

        {/* Right: Live Feed */}
        <aside className="w-64 shrink-0 border-l border-gray-800 overflow-hidden">
          <LiveFeed events={events} />
        </aside>
      </div>

      {showLegend && <LegendModal onClose={() => setShowLegend(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          soundEngine={soundEngine}
          shortcuts={shortcuts}
          updateShortcut={updateShortcut}
          resetShortcuts={resetShortcuts}
        />
      )}
      <ShortcutHelpOverlay
        shortcuts={shortcuts}
        open={showShortcutHelp}
        onToggle={() => setShowShortcutHelp(prev => !prev)}
      />
    </div>
  )
}
