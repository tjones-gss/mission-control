import { useState } from 'react'
import { ShieldAlert, ChevronDown, ChevronUp, Check, X } from 'lucide-react'
import { TOOL_COLORS } from './AgentTree.jsx'

export function ToolApprovalBanner({ approval, onApprove, onDeny }) {
  const [showInput, setShowInput] = useState(false)
  const color = TOOL_COLORS[approval.toolName] || 'bg-gray-800 text-gray-400'

  return (
    <div className="mx-3 mb-2 rounded-lg border border-amber-800/50 bg-amber-950/30 p-3">
      <div className="flex items-center gap-2 flex-wrap">
        <ShieldAlert size={14} className="text-amber-400 shrink-0" />
        <span className="text-xs text-amber-200">Tool approval:</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${color}`}>
          {approval.toolName}
        </span>
        <button
          onClick={() => setShowInput(s => !s)}
          className="text-gray-500 hover:text-gray-300"
        >
          {showInput ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <div className="ml-auto flex gap-1.5">
          <button
            onClick={() => onApprove(approval.approvalId)}
            className="px-2.5 py-1 rounded bg-green-700 text-white text-[11px] font-medium hover:bg-green-600 transition-colors flex items-center gap-1"
          >
            <Check size={10} /> Allow
          </button>
          <button
            onClick={() => onDeny(approval.approvalId)}
            className="px-2.5 py-1 rounded bg-red-700 text-white text-[11px] font-medium hover:bg-red-600 transition-colors flex items-center gap-1"
          >
            <X size={10} /> Deny
          </button>
        </div>
      </div>
      {showInput && (
        <pre className="mt-2 bg-gray-900 text-gray-400 text-[11px] font-mono p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
          {JSON.stringify(approval.input, null, 2)}
        </pre>
      )}
    </div>
  )
}
