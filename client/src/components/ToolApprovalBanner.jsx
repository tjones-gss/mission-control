import { useState } from 'react'
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Zap,
  ChevronDown,
  ChevronUp,
  Check,
  X,
} from 'lucide-react'
import { TOOL_COLORS } from './AgentTree.jsx'

const RISK_CONFIG = {
  SAFE_READONLY: {
    border: 'border-green-600/60',
    bg: 'bg-green-950/30',
    badge: 'bg-green-800 text-green-200',
    badgeText: 'Read-only',
    icon: ShieldCheck,
    iconColor: 'text-green-400',
    glow: '',
    requiresConfirmation: false,
  },
  CODE_EXECUTION: {
    border: 'border-amber-500/60',
    bg: 'bg-amber-950/30',
    badge: 'bg-amber-800 text-amber-200',
    badgeText: 'Runs code',
    icon: Zap,
    iconColor: 'text-amber-400',
    glow: '',
    requiresConfirmation: false,
  },
  DESTRUCTIVE: {
    border: 'border-red-600/80',
    bg: 'bg-red-950/40',
    badge: 'bg-red-700 text-red-100',
    badgeText: 'DESTRUCTIVE',
    icon: ShieldAlert,
    iconColor: 'text-red-400',
    glow: 'shadow-[0_0_12px_rgba(220,38,38,0.25)]',
    requiresConfirmation: true,
  },
  REQUIRES_REVIEW: {
    border: 'border-yellow-500/60',
    bg: 'bg-yellow-950/30',
    badge: 'bg-yellow-800 text-yellow-200',
    badgeText: 'Review carefully',
    icon: AlertTriangle,
    iconColor: 'text-yellow-400',
    glow: '',
    requiresConfirmation: false,
  },
  UNKNOWN: {
    border: 'border-yellow-500/60',
    bg: 'bg-yellow-950/30',
    badge: 'bg-yellow-800 text-yellow-200',
    badgeText: 'Review carefully',
    icon: AlertTriangle,
    iconColor: 'text-yellow-400',
    glow: '',
    requiresConfirmation: false,
  },
}

const DEFAULT_RISK = {
  border: 'border-amber-800/50',
  bg: 'bg-amber-950/30',
  badge: null,
  badgeText: null,
  icon: ShieldAlert,
  iconColor: 'text-amber-400',
  glow: '',
  requiresConfirmation: false,
}

export function ToolApprovalBanner({ approval, onApprove, onDeny }) {
  const [showInput, setShowInput] = useState(false)
  const [confirmStep, setConfirmStep] = useState(false)
  const color = TOOL_COLORS[approval.toolName] || 'bg-gray-800 text-gray-400'

  const riskLevel = approval.riskLevel
  const riskDescription = approval.riskDescription
  const risk = (riskLevel && RISK_CONFIG[riskLevel]) || DEFAULT_RISK
  const RiskIcon = risk.icon

  const handleApprove = () => {
    if (risk.requiresConfirmation && !confirmStep) {
      setConfirmStep(true)
      return
    }
    setConfirmStep(false)
    onApprove(approval.approvalId)
  }

  const handleCancelConfirm = () => {
    setConfirmStep(false)
  }

  return (
    <div className={`mx-3 mb-2 rounded-lg border ${risk.border} ${risk.bg} ${risk.glow} p-3`}>
      <div className="flex items-center gap-2 flex-wrap">
        <RiskIcon size={14} className={`${risk.iconColor} shrink-0`} />
        <span className="text-xs text-amber-200">Tool approval:</span>
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${color}`}>
          {approval.toolName}
        </span>
        {risk.badgeText && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${risk.badge}`}>
            {risk.badgeText}
          </span>
        )}
        {riskDescription && (
          <span
            className="text-[10px] text-gray-400 italic truncate max-w-[200px]"
            title={riskDescription}
          >
            {riskDescription}
          </span>
        )}
        <button
          onClick={() => setShowInput((s) => !s)}
          className="text-gray-500 hover:text-gray-300"
        >
          {showInput ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        <div className="ml-auto flex gap-1.5">
          {confirmStep ? (
            <>
              <span className="text-[10px] text-red-300 font-semibold self-center mr-1">
                Confirm destructive action?
              </span>
              <button
                onClick={handleApprove}
                className="px-2.5 py-1 rounded bg-red-600 text-white text-[11px] font-medium hover:bg-red-500 transition-colors flex items-center gap-1 animate-pulse"
              >
                <Check size={10} /> Yes, Allow
              </button>
              <button
                onClick={handleCancelConfirm}
                className="px-2.5 py-1 rounded bg-gray-700 text-white text-[11px] font-medium hover:bg-gray-600 transition-colors flex items-center gap-1"
              >
                <X size={10} /> Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={handleApprove}
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
            </>
          )}
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
