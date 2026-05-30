import { useState } from 'react'
import { Users, Bot, Inbox } from 'lucide-react'
import { TeamInboxFeed } from './TeamInboxFeed.jsx'
import { TeamComposeInput } from './TeamComposeInput.jsx'

function flattenInbox(inboxes) {
  return Object.values(inboxes || {}).flat()
}

function countUnread(inboxes) {
  return flattenInbox(inboxes).filter((m) => !m.read && !m.archived).length
}

export function TeamsPanel({ teams, refetch }) {
  const [selectedName, setSelectedName] = useState(null)

  if (!teams || teams.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
        No teams configured. Teams are set up via Claude Code's team configuration.
      </div>
    )
  }

  const selected = teams.find((t) => t.name === selectedName)
  const allMessages = selected ? flattenInbox(selected.inboxes) : []

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Team list */}
      <div className="w-48 shrink-0 border-r border-gray-800 overflow-y-auto">
        <div className="px-3 py-2 border-b border-gray-800">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wider">
            Teams
          </span>
        </div>
        {teams.map((team) => {
          const unread = countUnread(team.inboxes)
          return (
            <button
              key={team.name}
              onClick={() => setSelectedName(team.name)}
              className={`w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs transition-colors ${
                selectedName === team.name
                  ? 'bg-gray-800 text-gray-100'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-gray-900'
              }`}
            >
              <Users size={11} className="text-purple-400 shrink-0" />
              <span className="truncate flex-1">{team.name}</span>
              {unread > 0 && (
                <span className="shrink-0 bg-blue-500 text-white text-xs rounded-full px-1.5 py-0.5 leading-none">
                  {unread}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Team detail */}
      {selected ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Config card */}
          <div className="shrink-0 border-b border-gray-800 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <Users size={13} className="text-purple-400" />
              <span className="text-sm font-semibold text-purple-300">{selected.name}</span>
            </div>
            {selected.description && (
              <p className="text-xs text-gray-500">{selected.description}</p>
            )}
            {(selected.members || []).length > 0 && (
              <div className="space-y-1">
                {selected.members.map((m) => (
                  <div key={m.agentId} className="flex items-center gap-2 text-xs">
                    <Bot size={11} className="text-gray-600" />
                    <span className="text-gray-400">{m.name}</span>
                    <span className="text-gray-700">{m.agentType}</span>
                    <span className="ml-auto text-gray-700">
                      {m.model?.split('-').slice(-2).join('-')}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Inbox */}
          <div className="px-3 py-1.5 border-b border-gray-800 shrink-0">
            <div className="flex items-center gap-1.5">
              <Inbox size={11} className="text-gray-600" />
              <span className="text-xs text-gray-600 uppercase tracking-wider font-semibold">
                Inbox
              </span>
            </div>
          </div>
          <TeamInboxFeed teamName={selected.name} messages={allMessages} onUpdate={refetch} />
          <TeamComposeInput teamName={selected.name} onSent={refetch} />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
          Select a team to view its inbox
        </div>
      )}
    </div>
  )
}
