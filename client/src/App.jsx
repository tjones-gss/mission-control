import { useState, useCallback, useEffect } from 'react'
import { Eye, Users, ListTodo, Command } from 'lucide-react'
import { useApi } from './hooks/useApi.js'
import { useSSE } from './hooks/useSSE.js'
import { SessionsList } from './components/SessionsList.jsx'
import { AgentTree } from './components/AgentTree.jsx'
import { TaskBoard } from './components/TaskBoard.jsx'
import { TeamsPanel } from './components/TeamsPanel.jsx'
import { SkillsPanel } from './components/SkillsPanel.jsx'
import { LiveFeed } from './components/LiveFeed.jsx'

const TABS = [
  { id: 'agents', label: 'Agents', icon: Eye },
  { id: 'tasks', label: 'Tasks', icon: ListTodo },
  { id: 'teams', label: 'Teams', icon: Users },
  { id: 'skills', label: 'Skills', icon: Command },
]

export default function App() {
  const [selectedSessionId, setSelectedSessionId] = useState(null)
  const [activeTab, setActiveTab] = useState('agents')
  const [events, setEvents] = useState([])
  const [sessionsVersion, setSessionsVersion] = useState(0)
  const [tasksVersion, setTasksVersion] = useState(0)

  const { data: sessions, refetch: refetchSessions } = useApi('/api/sessions', [sessionsVersion])
  const { data: tasks, loading: tasksLoading } = useApi(
    selectedSessionId ? `/api/tasks/${selectedSessionId}` : null,
    [selectedSessionId, tasksVersion]
  )
  const { data: teams, refetch: refetchTeams } = useApi('/api/teams')
  const { data: skills, loading: skillsLoading } = useApi('/api/skills')

  // Auto-select first active session
  useEffect(() => {
    if (sessions?.length && !selectedSessionId) {
      const active = sessions.find(s => s.isActive) || sessions[0]
      setSelectedSessionId(active.sessionId)
    }
  }, [sessions, selectedSessionId])

  const selectedSession = sessions?.find(s => s.sessionId === selectedSessionId)

  useSSE(useCallback(evt => {
    setEvents(prev => [...prev.slice(-199), evt])
    if (evt.type === 'session_update' || evt.type === 'new_session') {
      setSessionsVersion(v => v + 1)
    }
    if (evt.type === 'task_update') {
      setTasksVersion(v => v + 1)
    }
    if (evt.type === 'team_update') {
      refetchTeams()
    }
  }, [refetchTeams]))

  const activeSessions = sessions?.filter(s => s.isActive) || []

  return (
    <div className="h-screen flex flex-col bg-gray-950 overflow-hidden">
      {/* Header */}
      <header className="flex items-center px-4 py-3 border-b border-gray-800 shrink-0">
        <span className="text-sm font-bold text-gray-200 tracking-tight">
          behind the agent curtain
        </span>
        {activeSessions.length > 0 && (
          <span className="ml-3 flex items-center gap-1.5 text-xs text-green-400">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            {activeSessions.length} active
          </span>
        )}
        <nav className="ml-auto flex gap-1">
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
        </nav>
      </header>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Sessions list */}
        <aside className="w-56 shrink-0 border-r border-gray-800 overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Sessions</span>
            {sessions && (
              <span className="ml-2 text-xs text-gray-700">{sessions.length}</span>
            )}
          </div>
          <SessionsList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
        </aside>

        {/* Center: Main panel */}
        <main className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'agents' && <AgentTree session={selectedSession} sessionUpdateVersion={sessionsVersion} />}
          {activeTab === 'tasks' && (
            <TaskBoard tasks={tasks} loading={tasksLoading} />
          )}
          {activeTab === 'teams' && <TeamsPanel teams={teams} />}
          {activeTab === 'skills' && <SkillsPanel skills={skills} loading={skillsLoading} />}
        </main>

        {/* Right: Live Feed */}
        <aside className="w-64 shrink-0 border-l border-gray-800 overflow-hidden">
          <LiveFeed events={events} />
        </aside>
      </div>
    </div>
  )
}
