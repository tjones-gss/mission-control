import { useState } from 'react'

function formatTs(ts) {
  return new Date(ts).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function projectBasename(p) {
  return (p || '').split(/[\\/]/).pop() || p
}

function EntryRow({ entry }) {
  const [expanded, setExpanded] = useState(false)
  const truncated = entry.display.length > 80
  const preview = truncated ? entry.display.slice(0, 80) + '\u2026' : entry.display

  return (
    <div
      onClick={() => truncated && setExpanded((e) => !e)}
      className={`px-3 py-2 border-b border-gray-900 hover:bg-gray-900 transition-colors ${truncated ? 'cursor-pointer' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="text-gray-700 text-xs shrink-0 mt-0.5">{formatTs(entry.timestamp)}</span>
        <span className="text-gray-400 text-xs flex-1 font-mono leading-relaxed break-all">
          {expanded ? entry.display : preview}
        </span>
        <span className="text-gray-700 text-xs shrink-0">{projectBasename(entry.project)}</span>
      </div>
    </div>
  )
}

function GroupedView({ entries }) {
  const groups = {}
  for (const e of entries) {
    const key = e.project || '(unknown)'
    if (!groups[key]) groups[key] = []
    groups[key].push(e)
  }
  return (
    <div className="overflow-y-auto flex-1">
      {Object.entries(groups).map(([project, items]) => (
        <details key={project} open className="mb-1">
          <summary className="px-3 py-1.5 text-xs text-gray-500 font-semibold cursor-pointer hover:text-gray-300 bg-gray-950 sticky top-0">
            {projectBasename(project)} <span className="text-gray-700">({items.length})</span>
          </summary>
          {items.map((e) => (
            <EntryRow key={`${e.sessionId}-${e.timestamp}`} entry={e} />
          ))}
        </details>
      ))}
    </div>
  )
}

export function HistoryFeed({ entries, grouped, onLoadMore, hasMore }) {
  if (!entries.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-700">
        No command history found
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {grouped ? (
        <GroupedView entries={entries} />
      ) : (
        <div className="overflow-y-auto flex-1">
          {entries.map((e) => (
            <EntryRow key={`${e.sessionId}-${e.timestamp}`} entry={e} />
          ))}
        </div>
      )}
      {hasMore && (
        <div className="shrink-0 flex justify-center py-2 border-t border-gray-900">
          <button
            onClick={onLoadMore}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors px-4 py-1.5"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  )
}
