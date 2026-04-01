import { useState } from 'react'
import { FileText, ChevronDown, ChevronRight, Clock } from 'lucide-react'
import { useApi } from '../hooks/useApi.js'
import { Markdown } from './Markdown.jsx'

function timeAgo(ms) {
  const diff = Date.now() - ms
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function PlanCard({ plan, planVersion }) {
  const [expanded, setExpanded] = useState(false)
  const { data: detail } = useApi(
    expanded ? `/api/plans/${encodeURIComponent(plan.filename)}` : null,
    [planVersion]
  )
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="border border-gray-800 rounded-lg bg-gray-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-800/50 transition-colors"
      >
        <Chevron size={12} className="text-gray-500 shrink-0" />
        <FileText size={13} className="text-purple-400 shrink-0" />
        <span className="text-sm text-gray-200 truncate flex-1">{plan.name}</span>
        <span className="flex items-center gap-1 text-xs text-gray-500 shrink-0">
          <Clock size={10} />
          {timeAgo(plan.lastModified)}
        </span>
      </button>
      {expanded && detail && (
        <div className="px-4 py-3 border-t border-gray-800 max-h-[500px] overflow-y-auto">
          <Markdown>{detail.content}</Markdown>
        </div>
      )}
      {expanded && !detail && (
        <div className="px-4 py-3 border-t border-gray-800 text-xs text-gray-500">Loading...</div>
      )}
    </div>
  )
}

export function PlanViewer({ planVersion = 0 }) {
  const { data, loading } = useApi('/api/plans', [planVersion])
  const plans = data || []

  if (loading) {
    return <div className="p-4 text-xs text-gray-500">Loading plans...</div>
  }

  if (plans.length === 0) {
    return (
      <div className="p-4 text-center text-gray-500 text-xs">
        No plans found in ~/.claude/plans/
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto h-full">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Plans</span>
        <span className="text-xs text-gray-500">{plans.length}</span>
      </div>
      {plans.map(plan => (
        <PlanCard key={plan.filename} plan={plan} planVersion={planVersion} />
      ))}
    </div>
  )
}
