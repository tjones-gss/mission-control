import { useState } from 'react'
import { ChevronDown, ChevronRight, Settings } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'

const SOURCE_COLORS = {
  user: 'text-blue-400',
  project: 'text-green-400',
  local: 'text-orange-400',
}

const SOURCE_BADGE = {
  user: 'bg-blue-900/40 text-blue-400 border-blue-800',
  project: 'bg-green-900/40 text-green-400 border-green-800',
  local: 'bg-orange-900/40 text-orange-400 border-orange-800',
}

function JsonValue({ value, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 2)

  if (value === null || value === undefined) {
    return <span className="text-gray-500 italic">null</span>
  }
  if (typeof value === 'boolean') {
    return <span className={value ? 'text-green-400' : 'text-red-400'}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="text-amber-400">{value}</span>
  }
  if (typeof value === 'string') {
    return <span className="text-emerald-300">"{value}"</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-gray-500">[]</span>
    const Chevron = expanded ? ChevronDown : ChevronRight
    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-300"
        >
          <Chevron size={10} />
          <span className="text-xs ml-0.5">[{value.length}]</span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-gray-800 pl-2">
            {value.map((item, i) => (
              <div key={i} className="py-0.5">
                <JsonValue value={item} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value)
    if (keys.length === 0) return <span className="text-gray-500">{'{}'}</span>
    const Chevron = expanded ? ChevronDown : ChevronRight
    return (
      <span>
        <button
          onClick={() => setExpanded(!expanded)}
          className="inline-flex items-center text-gray-500 hover:text-gray-300"
        >
          <Chevron size={10} />
          <span className="text-xs ml-0.5">
            {'{'}...{'}'}
          </span>
        </button>
        {expanded && (
          <div className="ml-4 border-l border-gray-800 pl-2">
            {keys.map((key) => (
              <div key={key} className="py-0.5">
                <span className="text-gray-300 text-xs">{key}:</span>{' '}
                <JsonValue value={value[key]} depth={depth + 1} />
              </div>
            ))}
          </div>
        )}
      </span>
    )
  }
  return <span className="text-gray-400">{String(value)}</span>
}

export function ConfigViewer({ sessionId, configVersion = 0 }) {
  const { data, loading } = useApi(sessionId ? `/api/sessions/${sessionId}/config` : null, [
    configVersion,
  ])

  if (!sessionId) {
    return <div className="p-4 text-xs text-gray-500">Select a session to view config</div>
  }

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading config...</div>
  }

  if (!data) {
    return <div className="p-4 text-xs text-gray-500">No config data available</div>
  }

  const { merged, sources, files } = data

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      {/* Config file sources */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
          Config Sources
        </span>
        {files?.map((f) => (
          <div key={f.level} className="flex items-center gap-2 text-xs">
            <span
              className={`px-1.5 py-0.5 rounded border text-[10px] ${SOURCE_BADGE[f.level] || 'bg-gray-800 text-gray-500 border-gray-700'}`}
            >
              {f.level}
            </span>
            <span className="text-gray-400 truncate font-mono text-[11px]">{f.path}</span>
            {f.exists ? (
              <span className="text-green-500 text-[10px]">exists</span>
            ) : (
              <span className="text-gray-600 text-[10px]">missing</span>
            )}
          </div>
        ))}
      </div>

      {/* Merged config tree */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
          <Settings size={11} className="inline mr-1" />
          Merged Config
        </span>
        <div className="bg-gray-900 rounded-lg border border-gray-800 p-3 font-mono text-xs">
          {Object.keys(merged || {}).map((key) => (
            <div key={key} className="py-1">
              <span className={`${SOURCE_COLORS[sources?.[key]] || 'text-gray-300'}`}>{key}</span>
              {sources?.[key] && (
                <span className="text-[9px] text-gray-600 ml-1">({sources[key]})</span>
              )}
              : <JsonValue value={merged[key]} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
