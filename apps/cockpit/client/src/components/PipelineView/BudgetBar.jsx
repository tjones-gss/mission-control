import { formatCost } from '../../utils/cost.js'

// Run budget from the v10 `budget` field (cost-policy ceiling + run-ledger
// spend). Rendered only when the harness actually tracks cost for this run —
// no policy/ledger, no bar. The exceeded latch is the harness's stop-the-line
// signal, styled accordingly.
export function BudgetBar({ budget }) {
  const ceiling = typeof budget?.ceiling_usd === 'number' ? budget.ceiling_usd : null
  const spent = typeof budget?.spent_usd === 'number' ? budget.spent_usd : null
  if (ceiling == null && spent == null) return null

  const pct = ceiling && spent != null ? Math.min(100, (spent / ceiling) * 100) : null
  const exceeded = Boolean(budget.exceeded)
  const tone = exceeded
    ? 'var(--mc-danger)'
    : pct != null && pct >= 80
      ? 'var(--mc-warn)'
      : 'var(--mc-accent)'

  return (
    <section aria-label="Run budget" data-testid="budget-bar">
      <div className="mb-1 flex items-center justify-between text-[10px] text-[var(--mc-fg-4)]">
        <span className="mc-eyebrow">Budget</span>
        <span className={exceeded ? 'font-semibold text-[var(--mc-danger)]' : ''}>
          {spent != null ? formatCost(spent) : '—'}
          {ceiling != null && <> / {formatCost(ceiling)}</>}
          {exceeded && ' · ceiling exceeded'}
        </span>
      </div>
      {pct != null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-[var(--mc-surface-2)]">
          <div
            className="h-full rounded-full"
            style={{ width: `${pct}%`, backgroundColor: tone }}
          />
        </div>
      )}
    </section>
  )
}
