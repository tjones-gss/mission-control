import { useState } from 'react'
import { BookOpen, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { Markdown } from './Markdown.jsx'

function MemoryFile({ memory }) {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight
  const fm = memory.frontmatter

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-800/50 transition-colors"
      >
        <Chevron size={12} className="text-gray-500 shrink-0" />
        <FileText size={12} className="text-cyan-400 shrink-0" />
        <span className="text-xs text-gray-200 truncate flex-1">
          {fm?.name || memory.filename}
        </span>
        {fm?.type && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700 shrink-0">
            {fm.type}
          </span>
        )}
      </button>
      {expanded && (
        <div className="px-3 py-2 border-t border-gray-800">
          {fm?.description && (
            <p className="text-xs text-gray-400 mb-2 italic">{fm.description}</p>
          )}
          <div className="max-h-[300px] overflow-y-auto">
            <Markdown>{memory.body}</Markdown>
          </div>
        </div>
      )}
    </div>
  )
}

function ContentSection({ title, icon: Icon, content, defaultOpen = false }) {
  const [expanded, setExpanded] = useState(defaultOpen)
  if (!content) return null
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800/50 transition-colors"
      >
        <Chevron size={12} className="text-gray-500 shrink-0" />
        <Icon size={13} className="text-indigo-400 shrink-0" />
        <span className="text-sm text-gray-200">{title}</span>
      </button>
      {expanded && (
        <div className="px-4 py-3 border-t border-gray-800 max-h-[400px] overflow-y-auto">
          <Markdown>{content}</Markdown>
        </div>
      )}
    </div>
  )
}

export function MemoryViewer({ sessionId, memoryVersion = 0 }) {
  const { data, loading } = useApi(
    sessionId ? `/api/sessions/${sessionId}/memory` : null,
    [memoryVersion]
  )

  if (!sessionId) {
    return <div className="p-4 text-xs text-gray-500">Select a session to view memory</div>
  }

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading memory...</div>
  }

  if (!data) {
    return <div className="p-4 text-xs text-gray-500">No memory data available</div>
  }

  const { global: globalMd, project, memories, memoryIndex } = data

  return (
    <div className="flex flex-col gap-3 p-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-1">
        <BookOpen size={13} className="text-indigo-400" />
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Memory & Instructions</span>
      </div>

      {/* Global CLAUDE.md */}
      <ContentSection
        title="Global CLAUDE.md"
        icon={FileText}
        content={globalMd?.content}
      />

      {/* Project CLAUDE.md files */}
      {project?.map((p, i) => (
        <ContentSection
          key={i}
          title={`Project: ${p.path || 'CLAUDE.md'}`}
          icon={FileText}
          content={p.content}
        />
      ))}

      {/* Memory Index */}
      {memoryIndex && (
        <ContentSection
          title="Memory Index (MEMORY.md)"
          icon={BookOpen}
          content={memoryIndex.content}
        />
      )}

      {/* Memory Files */}
      {memories?.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-1">
            Memory Files ({memories.length})
          </span>
          {memories.map((m, i) => (
            <MemoryFile key={i} memory={m} />
          ))}
        </div>
      )}

      {!globalMd && !project?.length && !memories?.length && (
        <div className="text-xs text-gray-500 text-center py-4">
          No CLAUDE.md or memory files found for this session.
        </div>
      )}
    </div>
  )
}
