import { Users, Bot } from 'lucide-react'

function timeAgo(ms) {
  const diff = Date.now() - ms
  const days = Math.floor(diff / 86400000)
  if (days > 0) return `${days}d ago`
  const hrs = Math.floor(diff / 3600000)
  return hrs > 0 ? `${hrs}h ago` : 'recently'
}

export function TeamsPanel({ teams }) {
  if (!teams || teams.length === 0) return (
    <div className="p-4 text-gray-700 text-xs">No teams found</div>
  )

  return (
    <div className="p-3 overflow-y-auto h-full space-y-4">
      {teams.map(team => (
        <div key={team.name} className="bg-gray-900 rounded-lg border border-gray-800 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Users size={13} className="text-purple-400" />
            <span className="text-sm font-semibold text-purple-300">{team.name}</span>
            <span className="ml-auto text-xs text-gray-600">{timeAgo(team.createdAt)}</span>
          </div>
          {team.description && (
            <p className="text-xs text-gray-500 mb-3">{team.description}</p>
          )}
          <div className="space-y-1.5">
            {(team.members || []).map(m => (
              <div key={m.agentId} className="flex items-center gap-2 text-xs">
                <Bot size={11} className="text-gray-600" />
                <span className="text-gray-400">{m.name}</span>
                <span className="text-gray-700">{m.agentType}</span>
                <span className="ml-auto text-gray-700">{m.model?.split('-').slice(-2).join('-')}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
