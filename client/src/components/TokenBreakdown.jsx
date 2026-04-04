import {
  calculateCost,
  formatCost,
  calculateCacheHitRate,
  estimateContextUsage,
  checkBudget,
} from '../utils/cost.js'

const CATEGORIES = [
  { key: 'input', label: 'Input', color: 'bg-blue-500', textColor: 'text-blue-400' },
  { key: 'output', label: 'Output', color: 'bg-purple-500', textColor: 'text-purple-400' },
  { key: 'cacheRead', label: 'Cache Read', color: 'bg-green-500', textColor: 'text-green-400' },
  { key: 'cacheWrite', label: 'Cache Write', color: 'bg-amber-500', textColor: 'text-amber-400' },
]

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function TokenBreakdownCompact({ tokenUsage, model }) {
  if (!tokenUsage) return null
  const total =
    (tokenUsage.input || 0) +
    (tokenUsage.output || 0) +
    (tokenUsage.cacheRead || 0) +
    (tokenUsage.cacheWrite || 0)
  if (total === 0) return null

  const cost = calculateCost(tokenUsage, model)

  return (
    <span className="inline-flex items-center gap-1.5">
      {/* Mini stacked bar */}
      <span className="inline-flex h-1.5 w-12 rounded-full overflow-hidden bg-gray-800">
        {CATEGORIES.map((cat) => {
          const val = tokenUsage[cat.key] || 0
          if (val === 0) return null
          const pct = (val / total) * 100
          return (
            <span
              key={cat.key}
              className={`${cat.color} opacity-80`}
              style={{ width: `${pct}%` }}
            />
          )
        })}
      </span>
      <span className="text-[10px] text-gray-500">{formatTokens(total)}</span>
      {cost && <span className="text-[10px] text-emerald-500">{formatCost(cost.totalCost)}</span>}
    </span>
  )
}

export function TokenBreakdownFull({
  tokenUsage,
  model,
  className = '',
  budgetMax = 0,
  budgetWarningThreshold = 0.8,
}) {
  if (!tokenUsage) return null
  const total =
    (tokenUsage.input || 0) +
    (tokenUsage.output || 0) +
    (tokenUsage.cacheRead || 0) +
    (tokenUsage.cacheWrite || 0)
  if (total === 0) return null

  const cost = calculateCost(tokenUsage, model)
  const cacheHitRate = calculateCacheHitRate(tokenUsage)
  const contextUsage = estimateContextUsage(tokenUsage, model)

  // Budget status (only relevant when a max budget is configured)
  const budgetStatus =
    cost && budgetMax > 0 ? checkBudget(cost.totalCost, budgetMax, budgetWarningThreshold) : null

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          Tokens
        </span>
        {cost && (
          <span className="text-xs font-medium text-emerald-400">
            {formatCost(cost.totalCost)}
            <span className="text-[9px] text-gray-600 ml-1">(est. API rate)</span>
          </span>
        )}
      </div>

      {CATEGORIES.map((cat) => {
        const tokens = tokenUsage[cat.key] || 0
        if (tokens === 0) return null
        const pct = total > 0 ? (tokens / total) * 100 : 0
        const dollars = cost?.breakdown?.[cat.key]

        return (
          <div key={cat.key} className="space-y-0.5">
            <div className="flex items-center justify-between text-[10px]">
              <span className={cat.textColor}>{cat.label}</span>
              <span className="text-gray-500">
                {formatTokens(tokens)}
                {dollars != null && dollars > 0 && (
                  <span className="text-emerald-600 ml-1">{formatCost(dollars)}</span>
                )}
              </span>
            </div>
            <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${cat.color} opacity-70`}
                style={{ width: `${Math.max(pct, 1)}%` }}
              />
            </div>
          </div>
        )
      })}

      {/* Cache hit rate */}
      <div className="space-y-0.5">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-cyan-400">Cache hit rate</span>
          <span className="text-gray-500">{cacheHitRate.toFixed(1)}%</span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-cyan-500 opacity-70"
            style={{ width: `${Math.max(cacheHitRate, 1)}%` }}
          />
        </div>
      </div>

      {/* Context window usage */}
      {contextUsage && (
        <div className="space-y-0.5">
          <div className="flex items-center justify-between text-[10px]">
            <span
              className={
                contextUsage.status === 'critical'
                  ? 'text-red-400'
                  : contextUsage.status === 'warning'
                    ? 'text-amber-400'
                    : 'text-teal-400'
              }
            >
              Context
            </span>
            <span className="text-gray-500">{(contextUsage.ratio * 100).toFixed(1)}% used</span>
          </div>
          <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
            <div
              className={`h-full rounded-full opacity-70 ${
                contextUsage.status === 'critical'
                  ? 'bg-red-500'
                  : contextUsage.status === 'warning'
                    ? 'bg-amber-500'
                    : 'bg-teal-500'
              }`}
              style={{ width: `${Math.min(Math.max(contextUsage.ratio * 100, 1), 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Budget status indicator */}
      {budgetStatus && budgetStatus !== 'ok' && (
        <div className="flex items-center gap-1.5 text-[10px] mt-1">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              budgetStatus === 'exceeded' ? 'bg-red-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className={budgetStatus === 'exceeded' ? 'text-red-400' : 'text-amber-400'}>
            {budgetStatus === 'exceeded' ? 'Budget exceeded' : 'Approaching budget limit'}
          </span>
          <span className="text-gray-600">
            {formatCost(cost.totalCost)} / {formatCost(budgetMax)}
          </span>
        </div>
      )}
    </div>
  )
}
