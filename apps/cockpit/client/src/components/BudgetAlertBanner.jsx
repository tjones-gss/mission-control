import { useState } from 'react'
import { formatCost } from '../utils/cost.js'

/**
 * Banner displayed when session spend approaches or exceeds a budget limit.
 *
 * @param {{ status: 'ok'|'warning'|'exceeded', currentCost: number, maxCost: number }} props
 */
export function BudgetAlertBanner({ status, currentCost, maxCost }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !status || status === 'ok' || !maxCost || maxCost <= 0) {
    return null
  }

  const pct = Math.min((currentCost / maxCost) * 100, 100)
  const isExceeded = status === 'exceeded'

  const bgClass = isExceeded ? 'bg-red-900/80 border-red-500' : 'bg-amber-900/60 border-amber-500'

  const textClass = isExceeded ? 'text-red-200' : 'text-amber-200'
  const barColor = isExceeded ? 'bg-red-500' : 'bg-amber-500'
  const pulseClass = isExceeded ? 'animate-pulse' : ''

  return (
    <div className={`${bgClass} ${pulseClass} border rounded-md px-3 py-2 mb-2`}>
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${textClass}`}>
          {isExceeded
            ? `BUDGET EXCEEDED: ${formatCost(currentCost)} / ${formatCost(maxCost)}`
            : `Session approaching budget limit: ${formatCost(currentCost)} / ${formatCost(maxCost)}`}
        </span>
        <button
          onClick={() => setDismissed(true)}
          className="text-gray-400 hover:text-gray-200 text-xs ml-2 leading-none"
          aria-label="Dismiss budget alert"
        >
          x
        </button>
      </div>
      {/* Progress bar */}
      <div className="mt-1.5 h-1.5 rounded-full bg-gray-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor} transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
