import { useState } from 'react'
import { Shield, ChevronDown, ChevronRight, Terminal } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'

const EVENT_COLORS = {
  PreToolUse: 'bg-blue-900/40 text-blue-400 border-blue-800',
  PostToolUse: 'bg-green-900/40 text-green-400 border-green-800',
}

function ScriptCard({ script }) {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/50 transition-colors"
      >
        <Chevron size={12} className="text-gray-500 shrink-0" />
        <Terminal size={12} className="text-amber-400 shrink-0" />
        <span className="text-xs text-gray-200 truncate flex-1 font-mono">{script.filename}</span>
        <span className="text-[10px] text-gray-500 shrink-0">{script.size}B</span>
      </button>
      {expanded && (
        <div className="border-t border-gray-800">
          <pre className="px-3 py-2 text-xs text-gray-300 font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap">
            {script.content}
          </pre>
        </div>
      )}
    </div>
  )
}

export function HooksPanel({ hooksVersion = 0 }) {
  const { data, loading } = useApi('/api/hooks', [hooksVersion])

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading hooks...</div>
  }

  if (!data) {
    return <div className="p-4 text-xs text-gray-500">No hooks data available</div>
  }

  const { matrix, scripts } = data

  return (
    <div className="flex flex-col gap-4 p-3 overflow-y-auto h-full">
      {/* Hook Matrix */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <Shield size={13} className="text-indigo-400" />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Hook Bindings</span>
          <span className="text-xs text-gray-500">{matrix?.length || 0}</span>
        </div>
        {matrix?.length > 0 ? (
          <div className="bg-gray-900 rounded-lg border border-gray-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">Event</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">Matcher</th>
                  <th className="px-3 py-2 text-left text-gray-500 font-medium">Command</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row, i) => (
                  <tr key={i} className="border-b border-gray-800/50 last:border-0">
                    <td className="px-3 py-1.5">
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] border ${EVENT_COLORS[row.event] || 'bg-gray-800 text-gray-400 border-gray-700'}`}>
                        {row.event}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-gray-300 font-mono">{row.matcher}</td>
                    <td className="px-3 py-1.5 text-gray-400 font-mono truncate max-w-[300px]">{row.command}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-xs text-gray-500 italic">No hooks configured</div>
        )}
      </div>

      {/* Hook Scripts */}
      {scripts?.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Terminal size={13} className="text-amber-400" />
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Hook Scripts</span>
            <span className="text-xs text-gray-500">{scripts.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {scripts.map(s => (
              <ScriptCard key={s.filename} script={s} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
