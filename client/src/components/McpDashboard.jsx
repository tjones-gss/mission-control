import { Server, Wifi, Terminal, Globe } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'

const TRANSPORT_BADGE = {
  stdio: { icon: Terminal, cls: 'bg-blue-900/40 text-blue-400 border-blue-800', label: 'stdio' },
  sse: { icon: Wifi, cls: 'bg-green-900/40 text-green-400 border-green-800', label: 'SSE' },
  http: { icon: Globe, cls: 'bg-purple-900/40 text-purple-400 border-purple-800', label: 'HTTP' },
  unknown: { icon: Server, cls: 'bg-gray-800 text-gray-400 border-gray-700', label: 'unknown' },
}

function ServerCard({ server }) {
  const transport = TRANSPORT_BADGE[server.transportType] || TRANSPORT_BADGE.unknown
  const TransportIcon = transport.icon

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 p-3">
      <div className="flex items-center gap-2 mb-2">
        <Server size={14} className="text-indigo-400 shrink-0" />
        <span className="text-sm font-medium text-gray-200 truncate">{server.name}</span>
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border shrink-0 ${transport.cls}`}
        >
          <TransportIcon size={9} />
          {transport.label}
        </span>
      </div>

      <div className="flex flex-col gap-1 text-xs">
        {server.command && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 shrink-0">cmd:</span>
            <span className="text-gray-300 font-mono truncate">
              {server.command} {server.args?.join(' ')}
            </span>
          </div>
        )}
        {server.url && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 shrink-0">url:</span>
            <span className="text-gray-300 font-mono truncate">{server.url}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500 shrink-0">prefix:</span>
          <span className="text-gray-400 font-mono">{server.toolPrefix}*</span>
        </div>
        {server.env?.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-gray-500 shrink-0">env:</span>
            <span className="text-gray-400">{server.env.join(', ')}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-gray-500 shrink-0">scope:</span>
          <span className="text-gray-400">{server.scope}</span>
        </div>
      </div>
    </div>
  )
}

export function McpDashboard({ mcpVersion = 0 }) {
  const { data, loading } = useApi('/api/mcp-servers', [mcpVersion])
  const servers = data?.servers || []

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading MCP servers...</div>
  }

  if (servers.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-xs">
        No MCP servers configured in settings.json
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-1">
        <Server size={13} className="text-indigo-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          MCP Servers
        </span>
        <span className="text-xs text-gray-500">{servers.length}</span>
      </div>
      <div className="grid gap-2 grid-cols-1 lg:grid-cols-2">
        {servers.map((server) => (
          <ServerCard key={server.name} server={server} />
        ))}
      </div>
    </div>
  )
}
