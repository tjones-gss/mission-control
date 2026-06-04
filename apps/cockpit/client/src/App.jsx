import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import {
  Eye,
  GitBranch,
  ListTodo,
  Command,
  HelpCircle,
  LayoutGrid,
  List,
  ArrowLeft,
  Bell,
  Settings,
  Plus,
  Users,
  History,
  Layers,
  Boxes,
  Gauge,
  SlidersHorizontal,
} from 'lucide-react'
import { useApi } from './hooks/useApi.js'
import { useSSE } from './hooks/useSSE.js'
import { useNotifications, getNotificationPrefs } from './hooks/useNotifications.js'
import { useSound } from './hooks/useSound.js'
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts.js'
import { useStreamingSession } from './hooks/useStreamingSession.js'
import { SessionsList } from './components/SessionsList.jsx'
import { AgentTree } from './components/AgentTree.jsx'
import { KanbanBoard } from './components/KanbanBoard.jsx'
import { TaskBoard } from './components/TaskBoard.jsx'
import { WorkflowsPanel } from './components/WorkflowsPanel.jsx'
import { SkillsPanel } from './components/SkillsPanel.jsx'
import { TeamsPanel } from './components/TeamsPanel/TeamsPanel.jsx'
import { HistoryTab } from './components/HistoryTab/HistoryTab.jsx'
import { RunsTab } from './components/RunsTab/RunsTab.jsx'
import { FleetTab } from './components/FleetTab/FleetTab.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { LiveFeed } from './components/LiveFeed.jsx'
import { LegendModal } from './components/LegendModal.jsx'
import { SettingsModal } from './components/SettingsModal.jsx'
import { ShortcutHelpOverlay } from './components/ShortcutHelpOverlay.jsx'
import { DispatchDrawer, DispatchDrawerHandle } from './components/DispatchDrawer.jsx'
import { DispatchSignal } from './components/DispatchSignal.jsx'
import { NewSessionForm } from './components/NewSessionForm.jsx'
import { projectLabel } from './utils/session.js'

// Progressive disclosure: the core loop is always visible; power surfaces live
// one "Advanced" click away. This matches the repo's stated philosophy (the
// window works with zero setup; the rails/power tools are opt-in) instead of
// presenting all eight tabs at once. The preference is persisted so a power user
// who flips Advanced on keeps it on across reloads.
const CORE_TABS = [
  { id: 'agents', label: 'Agents', icon: Eye },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'runs', label: 'Runs', icon: Gauge },
  { id: 'fleet', label: 'Fleet', icon: Boxes },
  { id: 'history', label: 'History', icon: History },
]

const ADVANCED_TABS = [
  { id: 'workflows', label: 'Workflows', icon: GitBranch },
  { id: 'skills', label: 'Skills', icon: Command },
  { id: 'teams', label: 'Teams', icon: Users },
]

// Combined list (core first, then advanced) for any caller that needs the full
// set regardless of disclosure state.
const TABS = [...CORE_TABS, ...ADVANCED_TABS]

const ADVANCED_TAB_IDS = new Set(ADVANCED_TABS.map((t) => t.id))

const SHOW_ADVANCED_KEY = 'mc.showAdvanced'

// Read the persisted Advanced-disclosure preference. Guarded so a missing or
// throwing localStorage (private mode, tests) defaults to the core-only view.
function readShowAdvanced() {
  try {
    return localStorage.getItem(SHOW_ADVANCED_KEY) === 'true'
  } catch {
    return false
  }
}

// Map SSE event types to sound event names
const SSE_SOUND_MAP = {
  session_update: 'sessionUpdate',
  task_update: 'taskUpdate',
  intelligence_update: 'intelligenceReady',
  new_session: 'newSession',
  team_update: 'teamUpdate',
  history_update: 'historyUpdate',
  sdk_message: 'sessionUpdate',
}

// Throttle interval for session_update sounds (ms)
const SESSION_UPDATE_SOUND_COOLDOWN = 5000

async function sendQuickReply(sessionId, message) {
  try {
    const res = await fetch(`/api/sessions/${sessionId}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      console.warn(`Quick reply failed: ${data.detail || data.error || `HTTP ${res.status}`}`)
    }
  } catch (err) {
    console.warn('Quick reply failed:', err.message)
  }
}

export default function App() {
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [activeTab, setActiveTab] = useState('agents')
  const [showAdvanced, setShowAdvanced] = useState(readShowAdvanced)
  const visibleTabs = showAdvanced ? TABS : CORE_TABS
  const toggleAdvanced = useCallback(() => {
    setShowAdvanced((prev) => {
      const next = !prev
      try {
        localStorage.setItem(SHOW_ADVANCED_KEY, String(next))
      } catch {
        /* ignore persistence failures (private mode, etc.) */
      }
      return next
    })
  }, [])
  // If Advanced is collapsed while an advanced-only tab is active, fall back to
  // the core Agents view so the user is never stranded on a now-hidden tab.
  useEffect(() => {
    if (!showAdvanced && ADVANCED_TAB_IDS.has(activeTab)) {
      setActiveTab('agents')
    }
  }, [showAdvanced, activeTab])
  // Navigate to a tab, auto-revealing Advanced when the target is an advanced
  // tab. Keeps keyboard shortcuts (e.g. Workflows/Skills) working even when the
  // user hasn't manually expanded Advanced, instead of being bounced by the
  // guard effect above.
  const selectTab = useCallback((id) => {
    if (ADVANCED_TAB_IDS.has(id)) {
      setShowAdvanced(true)
      try {
        localStorage.setItem(SHOW_ADVANCED_KEY, 'true')
      } catch {
        /* ignore persistence failures */
      }
    }
    setActiveTab(id)
  }, [])
  const [agentView, setAgentView] = useState('board') // 'board' | 'detail'
  const [showLegend, setShowLegend] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showShortcutHelp, setShowShortcutHelp] = useState(false)
  const [showDispatch, setShowDispatch] = useState(false)
  // Dispatch signal animation: { from: {x,y}, to: {x,y}, sessionId } or null
  const [dispatchSignal, setDispatchSignal] = useState(null)
  const [events, setEvents] = useState([])
  const [sessionsVersion, setSessionsVersion] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)
  const [intelligenceVersion, setIntelligenceVersion] = useState(0)
  const [teamsVersion, setTeamsVersion] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [planVersion, setPlanVersion] = useState(0)
  const [configVersion, setConfigVersion] = useState(0)
  const [memoryVersion, setMemoryVersion] = useState(0)
  const [hooksVersion, setHooksVersion] = useState(0)
  const [conductorVersion, setConductorVersion] = useState(0)
  const [harnessVersion, setHarnessVersion] = useState(0)
  const [fleetVersion, setFleetVersion] = useState(0)
  // Per-run escalation dedupe: only fire sound + notification on the
  // transition into a paused/escalated state, not on every status.json
  // rewrite that keeps the same escalation_reason. Key = `${projectPath}::${adr}`,
  // value = the last seen escalation_reason string (or null when running).
  const lastEscalationRef = useRef(new Map())

  const { data: sessions, refetch: refetchSessions } = useApi('/api/sessions', [sessionsVersion])
  const {
    data: tasks,
    loading: tasksLoading,
    refetch: refetchTasks,
  } = useApi(selectedSessionId ? `/api/tasks/${selectedSessionId}` : null, [
    selectedSessionId,
    tasksVersion,
  ])
  const {
    data: workflows,
    loading: workflowsLoading,
    refetch: refetchWorkflows,
  } = useApi('/api/workflows')
  const { data: skills, loading: skillsLoading, refetch: refetchSkills } = useApi('/api/skills')
  const { data: teams, refetch: refetchTeams } = useApi('/api/teams', [teamsVersion])

  // Auto-select first active session
  useEffect(() => {
    if (sessions?.length && !selectedSessionId) {
      const active = sessions.find((s) => s.isActive) || sessions[0]
      setSelectedSessionId(active.sessionId)
    }
  }, [sessions, selectedSessionId])

  const selectedSession = sessions?.find((s) => s.sessionId === selectedSessionId)

  // SDK streaming session
  const streaming = useStreamingSession(selectedSessionId)

  // Sound engine
  const soundEngine = useSound()
  const lastSessionSoundRef = useRef(0)

  const sessionsDebounceRef = useRef(null)
  const { connected } = useSSE(
    useCallback(
      (evt) => {
        // Forward SDK events to streaming handler
        streaming.handleSdkEvent(evt)

        setEvents((prev) => [...prev.slice(-199), evt])
        if (evt.type === 'session_update' || evt.type === 'new_session') {
          if (evt.type === 'new_session') {
            setShowNewSession(false)
          }
          if (!sessionsDebounceRef.current) {
            sessionsDebounceRef.current = setTimeout(() => {
              sessionsDebounceRef.current = null
              setSessionsVersion((v) => v + 1)
            }, 100)
          }
        }
        if (evt.type === 'task_update') {
          setTasksVersion((v) => v + 1)
        }
        if (evt.type === 'intelligence_update') {
          setIntelligenceVersion((v) => v + 1)
        }
        if (evt.type === 'team_update') {
          setTeamsVersion((v) => v + 1)
        }
        if (evt.type === 'history_update') {
          setHistoryVersion((v) => v + 1)
        }
        if (evt.type === 'plan_update') {
          setPlanVersion((v) => v + 1)
        }
        if (evt.type === 'config_update') {
          setConfigVersion((v) => v + 1)
        }
        if (evt.type === 'memory_update') {
          setMemoryVersion((v) => v + 1)
        }
        if (evt.type === 'hooks_update') {
          setHooksVersion((v) => v + 1)
        }
        if (evt.type === 'conductor_update') {
          setConductorVersion((v) => v + 1)
          // The watcher payload only tells us *something* in this run's
          // .conductor/<adr>/ changed — it doesn't include the parsed
          // status. Fetch the run and check isPaused so we can fire the
          // escalation sound + notification exactly once on transition.
          const { projectPath, adr } = evt.data || {}
          if (projectPath && adr) {
            const key = `${projectPath}::${adr}`
            fetch(`/api/conductor/${encodeURIComponent(projectPath)}/${adr}`)
              .then((res) => (res.ok ? res.json() : null))
              .then((run) => {
                if (!run) return
                const lastReason = lastEscalationRef.current.get(key) ?? null
                const currentReason = run.isPaused ? run.escalationReason || 'paused' : null
                lastEscalationRef.current.set(key, currentReason)
                // Fire only on transition from running/different-reason to paused
                if (currentReason && currentReason !== lastReason) {
                  if (getNotificationPrefs().sound) {
                    soundEngine.play('conductorEscalation', {
                      projectLabel: run.projectLabel,
                      adr: run.adr,
                      escalationReason: run.escalationReason || 'paused',
                    })
                  }
                  if (
                    typeof Notification !== 'undefined' &&
                    Notification.permission === 'granted'
                  ) {
                    new Notification('Conductor paused', {
                      body: `${run.projectLabel} ADR ${run.adr}: ${run.escalationReason || 'awaiting your decision'}`,
                      tag: `conductor-${key}`,
                    })
                  }
                }
              })
              .catch(() => {
                /* network errors swallowed — next event will retry */
              })
          }
        }
        if (evt.type === 'harness_update') {
          setHarnessVersion((v) => v + 1)
        }
        if (evt.type === 'fleet_update') {
          setFleetVersion((v) => v + 1)
        }
        if (evt.type === 'workflows_update') {
          refetchWorkflows?.()
        }
        if (evt.type === 'skills_update') {
          refetchSkills?.()
        }

        // Play sound for non-session events (needsInput is handled by useNotifications)
        const soundEvent = SSE_SOUND_MAP[evt.type]
        if (soundEvent && getNotificationPrefs().sound) {
          // Throttle session_update sounds to avoid noise
          if (evt.type === 'session_update') {
            const now = Date.now()
            if (now - lastSessionSoundRef.current < SESSION_UPDATE_SOUND_COOLDOWN) return
            lastSessionSoundRef.current = now
          }
          soundEngine.play(
            soundEvent,
            evt.sessionId ? { projectLabel: evt.projectLabel || 'session' } : undefined,
          )
        }
      },
      [soundEngine, streaming.handleSdkEvent],
    ),
  )

  const activeSessions = sessions?.filter((s) => s.isActive) || []
  const { requestPermission, muteSession, mutedIds } = useNotifications(sessions, soundEngine)
  const needsInputSessions =
    sessions?.filter((s) => s.needsInput && !mutedIds.current.has(s.sessionId)) || []

  // Keyboard shortcuts — use refs so handler identity is stable and keydown listener
  // doesn't churn on every session update
  const sessionsRef = useRef(sessions)
  const selectedSessionIdRef = useRef(selectedSessionId)
  const selectedSessionRef = useRef(selectedSession)
  const showSettingsRef = useRef(showSettings)
  const showLegendRef = useRef(showLegend)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])
  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId
  }, [selectedSessionId])
  useEffect(() => {
    selectedSessionRef.current = selectedSession
  }, [selectedSession])
  useEffect(() => {
    showSettingsRef.current = showSettings
  }, [showSettings])
  useEffect(() => {
    showLegendRef.current = showLegend
  }, [showLegend])

  const shortcutHandlers = useMemo(
    () => ({
      nextSession: () => {
        const s = sessionsRef.current
        if (!s?.length) return
        const idx = s.findIndex((x) => x.sessionId === selectedSessionIdRef.current)
        const next = s[(idx + 1) % s.length]
        if (next) setSelectedSessionId(next.sessionId)
      },
      prevSession: () => {
        const s = sessionsRef.current
        if (!s?.length) return
        const idx = s.findIndex((x) => x.sessionId === selectedSessionIdRef.current)
        const prev = s[(idx - 1 + s.length) % s.length]
        if (prev) setSelectedSessionId(prev.sessionId)
      },
      openDetail: () => setAgentView('detail'),
      backToBoard: () => {
        if (showSettingsRef.current) setShowSettings(false)
        else if (showLegendRef.current) setShowLegend(false)
        else setAgentView('board')
      },
      tabAgents: () => selectTab('agents'),
      tabTasks: () => selectTab('tasks'),
      tabWorkflows: () => selectTab('workflows'),
      tabSkills: () => selectTab('skills'),
      tabMissionControl: () => selectTab('runs'),
      quickApprove: () => {
        const session = selectedSessionRef.current
        if (session?.needsInput) {
          sendQuickReply(session.sessionId, 'yes')
        }
      },
      quickContinue: () => {
        const session = selectedSessionRef.current
        if (session?.needsInput) {
          sendQuickReply(session.sessionId, 'continue')
        }
      },
      focusInput: () => {
        const input = document.querySelector('[data-shortcut-focus="message-input"]')
        if (input) input.focus()
      },
      showHelp: () => setShowShortcutHelp((prev) => !prev),
      toggleSettings: () => setShowSettings((prev) => !prev),
      toggleMute: () => {
        const id = selectedSessionIdRef.current
        if (id) muteSession(id)
      },
      toggleDispatch: () => setShowDispatch((prev) => !prev),
    }),
    [muteSession],
  ) // stable — only depends on muteSession which is a useCallback

  const {
    shortcuts,
    updateShortcut,
    resetDefaults: resetShortcuts,
  } = useKeyboardShortcuts(shortcutHandlers)

  const [showNewSession, setShowNewSession] = useState(false)

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center px-4 py-2 border-b border-gray-800 shrink-0 gap-y-1">
        <span className="text-sm font-bold text-gray-200 tracking-tight">Oversight</span>
        <span className="ml-2 text-xs text-gray-600 tracking-tight hidden sm:inline">
          behind the agent curtain
        </span>
        {!connected && (
          <span
            className="ml-3 flex items-center gap-1.5 text-xs text-red-400"
            title="Live connection lost — reconnecting..."
          >
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
        <button
          onClick={() => setShowNewSession((s) => !s)}
          className={`md:hidden ml-auto flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
            showNewSession
              ? 'bg-indigo-600/20 text-indigo-200'
              : 'text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30'
          }`}
          title="New session"
          aria-label="New session"
        >
          <Plus size={12} />
          <span>New</span>
        </button>
        <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar w-full md:w-auto md:ml-auto order-last md:order-none">
          {visibleTabs.map((tab) => {
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
            onClick={toggleAdvanced}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs transition-colors ${
              showAdvanced ? 'bg-gray-800 text-gray-300' : 'text-gray-600 hover:text-gray-400'
            }`}
            title={showAdvanced ? 'Hide advanced tabs' : 'Show advanced tabs'}
            aria-pressed={showAdvanced}
          >
            <SlidersHorizontal size={12} />
            <span className="hidden md:inline">Advanced</span>
          </button>
          <button
            onClick={() => setShowDispatch(true)}
            className="ml-2 flex items-center gap-1 px-2 py-1 rounded text-xs text-indigo-300 hover:text-indigo-200 hover:bg-indigo-900/30 transition-colors"
            title="Dispatch Manager (d)"
          >
            <Layers size={12} />
            <span className="hidden md:inline">Dispatch</span>
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="ml-1 text-gray-600 hover:text-gray-400 transition-colors p-1 rounded"
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
      {showNewSession && (
        <div className="md:hidden border-b border-gray-800 bg-gray-950/95">
          <NewSessionForm
            sessions={sessions}
            onCreated={(arg) => {
              setShowNewSession(false)
              if (arg?.pendingSessionId) {
                setSelectedSessionId(arg.pendingSessionId)
                setAgentView('detail')
              }
            }}
          />
        </div>
      )}

      {/* Body — reserve 36px at the bottom for the DispatchDrawerHandle,
          which is fixed at bottom-0 center. Without this clearance the
          handle sits directly on top of the ConversationView's message
          input + send button, intercepting clicks and making the input
          effectively unusable. */}
      <div className="flex-1 flex overflow-hidden pb-9 bg-gray-950 isolate">
        {/* Left: Sessions list */}
        <aside className="hidden md:flex w-64 shrink-0 border-r border-gray-800 overflow-hidden flex-col relative z-10 bg-gray-950">
          <div className="h-10 shrink-0 px-3 border-b border-gray-800 flex items-center">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
              Sessions
            </span>
            {sessions && <span className="ml-2 text-xs text-gray-500">{sessions.length}</span>}
            <button
              onClick={() => setShowNewSession((s) => !s)}
              className="ml-auto text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
              title="New session"
            >
              <Plus size={14} />
            </button>
          </div>
          {showNewSession && (
            <NewSessionForm
              sessions={sessions}
              onCreated={(arg) => {
                setShowNewSession(false)
                if (arg?.pendingSessionId) {
                  setSelectedSessionId(arg.pendingSessionId)
                  setAgentView('detail')
                }
              }}
            />
          )}
          <SessionsList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onMuteSession={muteSession}
            onReplySession={(id) => {
              setSelectedSessionId(id)
              setAgentView('detail')
            }}
          />
        </aside>

        {/* Center: Main panel */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col relative z-0 bg-gray-950">
          {activeTab === 'agents' && (
            <>
              {/* Board / Detail toggle bar */}
              <div className="h-10 shrink-0 flex items-center gap-2 px-3 border-b border-gray-800">
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
              {agentView === 'board' ? (
                <KanbanBoard
                  sessions={sessions || []}
                  selectedId={selectedSessionId}
                  onSelect={(id) => {
                    setSelectedSessionId(id)
                    setAgentView('detail')
                  }}
                />
              ) : (
                <AgentTree
                  session={selectedSession}
                  sessionUpdateVersion={sessionsVersion}
                  intelligenceVersion={intelligenceVersion}
                  configVersion={configVersion}
                  memoryVersion={memoryVersion}
                  hooksVersion={hooksVersion}
                  skills={skills}
                  streaming={streaming}
                />
              )}
            </>
          )}
          {activeTab === 'tasks' && (
            <TaskBoard
              tasks={tasks}
              loading={tasksLoading}
              sessionId={selectedSessionId}
              refetch={refetchTasks}
            />
          )}
          {activeTab === 'workflows' && (
            <WorkflowsPanel
              workflows={workflows}
              loading={workflowsLoading}
              refetch={refetchWorkflows}
              skills={skills}
            />
          )}
          {activeTab === 'skills' && (
            <SkillsPanel skills={skills} loading={skillsLoading} refetch={refetchSkills} />
          )}
          {activeTab === 'teams' && (
            <ErrorBoundary>
              <TeamsPanel teams={teams} refetch={refetchTeams} />
            </ErrorBoundary>
          )}
          {activeTab === 'history' && (
            <ErrorBoundary>
              <HistoryTab historyVersion={historyVersion} />
            </ErrorBoundary>
          )}
          {activeTab === 'runs' && (
            <ErrorBoundary>
              <RunsTab
                harnessVersion={harnessVersion}
                conductorVersion={conductorVersion}
                sessions={sessions}
              />
            </ErrorBoundary>
          )}
          {activeTab === 'fleet' && (
            <ErrorBoundary>
              <FleetTab
                fleetVersion={fleetVersion}
                onOpenSession={(sessionId) => {
                  // A child card's "open session" link jumps into the
                  // Agents/Inspect detail view for that child session.
                  setActiveTab('agents')
                  setSelectedSessionId(sessionId)
                  setAgentView('detail')
                }}
              />
            </ErrorBoundary>
          )}
        </main>

        {/* Right: Live Feed */}
        <aside className="hidden lg:block w-64 shrink-0 border-l border-gray-800 overflow-hidden">
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
        onToggle={() => setShowShortcutHelp((prev) => !prev)}
      />
      <DispatchDrawerHandle open={showDispatch} onToggle={() => setShowDispatch((prev) => !prev)} />
      <DispatchDrawer
        open={showDispatch}
        onClose={() => setShowDispatch(false)}
        onSingleDispatchSuccess={(sessionId, fromRect) => {
          // Compute target = where the session card lives in the sidebar
          // (or center of the main panel if no card found). Fire the
          // electrical-signal animation, close the drawer, and after the
          // animation arrives at the target, jump to that session's
          // detail view.
          const card = document.querySelector(`[data-session-card-id="${sessionId}"]`)
          const cardRect = card?.getBoundingClientRect()
          const main = document.querySelector('main')?.getBoundingClientRect()
          const to = cardRect
            ? { x: cardRect.left + cardRect.width / 2, y: cardRect.top + cardRect.height / 2 }
            : main
              ? { x: main.left + main.width / 2, y: main.top + main.height / 2 }
              : { x: window.innerWidth / 2, y: window.innerHeight / 2 }
          const from = fromRect
            ? { x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 }
            : { x: window.innerWidth / 2, y: window.innerHeight - 100 }
          setShowDispatch(false)
          setDispatchSignal({ from, to, sessionId })
        }}
      />
      {dispatchSignal && (
        <DispatchSignal
          from={dispatchSignal.from}
          to={dispatchSignal.to}
          onComplete={() => {
            // Switch to the target session's detail view, then clear the
            // overlay so it doesn't linger as an empty SVG layer.
            setActiveTab('agents')
            setSelectedSessionId(dispatchSignal.sessionId)
            setAgentView('detail')
            setDispatchSignal(null)
          }}
        />
      )}
    </div>
  )
}
