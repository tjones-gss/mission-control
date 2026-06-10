import { useState, useEffect } from 'react'
import { DollarSign, Database, Zap } from 'lucide-react'
import { formatCost } from '../../utils/cost.js'
import { TokenBreakdownCompact } from '../TokenBreakdown.jsx'

const GROUP_BYS = ['day', 'project', 'model']

function formatTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function projectBasename(p) {
  return (p || '').split(/[\\/]/).pop() || p || '(unknown)'
}

function totalTokensOf(t) {
  return (t.input || 0) + (t.output || 0) + (t.cacheRead || 0) + (t.cacheWrite || 0)
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
      <Icon size={11} className="text-gray-600 shrink-0" />
      <div>
        <div className="text-xs text-gray-600 leading-none mb-0.5">{label}</div>
        <div className="text-sm font-semibold text-gray-200">{value}</div>
      </div>
    </div>
  )
}

// Daily cost trend, mirroring the HistoryStatsBar sparkline pattern (bars,
// not the per-turn CostSparkline — that one needs raw message records).
function DailyTrend({ rows }) {
  const max = Math.max(...rows.map((r) => r.cost), 0.000001)
  return (
    <div data-testid="usage-trend" className="flex gap-1 items-end h-16" title="daily cost">
      {rows.map((r) => (
        <div
          key={r.key}
          data-day={r.key}
          title={`${r.key}: ${formatCost(r.cost)} · ${formatTokens(r.totalTokens)} tokens`}
          className="w-4 bg-emerald-500 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          style={{ height: `${Math.max(3, (r.cost / max) * 60)}px` }}
        />
      ))}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  )
}

function GroupRows({ rows, labelOf }) {
  const maxTokens = Math.max(...rows.map((r) => r.totalTokens), 1)
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div key={r.key} className="flex items-center gap-2 text-xs" title={r.key}>
          <span className="w-36 truncate text-gray-300">{labelOf(r.key)}</span>
          <span className="flex-1 min-w-0">
            <TokenBreakdownCompact tokenUsage={r} model={null} />
          </span>
          <span className="text-gray-600 text-[10px] shrink-0 w-20 text-right">
            {formatTokens(r.totalTokens)} (
            {(r.totalTokens / maxTokens) * 100 >= 1
              ? `${((r.totalTokens / maxTokens) * 100).toFixed(0)}%`
              : '<1%'}
            )
          </span>
          <span className="text-emerald-500 shrink-0 w-16 text-right">{formatCost(r.cost)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Usage analytics mode INSIDE the History tab (ADR-0008 Phase 5 — no new
 * top-level tab per ADR-0007): per-project totals, per-day cost trend, and
 * model mix from GET /api/stats/usage, priced server-side.
 */
export function HistoryUsageStats() {
  const [data, setData] = useState(null) // { day, project, model }
  const [status, setStatus] = useState('loading') // loading | done | error
  const [errorHint, setErrorHint] = useState(null)

  useEffect(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        const responses = await Promise.all(
          GROUP_BYS.map((g) =>
            fetch(`/api/stats/usage?groupBy=${g}`, { signal: controller.signal }),
          ),
        )
        const failed = responses.find((r) => !r.ok)
        if (failed) {
          let hint = 'Failed to load usage stats'
          try {
            const body = await failed.json()
            hint = body.hint || body.error || hint
          } catch {
            /* non-JSON error body — keep the generic hint */
          }
          setErrorHint(hint)
          setStatus('error')
          return
        }
        const [day, project, model] = await Promise.all(responses.map((r) => r.json()))
        setData({ day, project, model })
        setStatus('done')
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Failed to fetch usage stats:', err)
        setErrorHint('Failed to load usage stats')
        setStatus('error')
      }
    })()
    return () => controller.abort()
  }, [])

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-700">
        Loading usage stats…
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="flex-1 flex items-center justify-center px-6 text-center text-xs text-red-400">
        {errorHint}
      </div>
    )
  }

  const totals = data.day.totals
  if (data.day.rows.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-gray-700">
        No token usage indexed yet — usage appears as sessions are indexed
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* Totals */}
      <div className="flex items-center gap-2 overflow-x-auto">
        <StatCard icon={DollarSign} label="Total cost" value={formatCost(totals.cost)} />
        <StatCard
          icon={Database}
          label="Total tokens"
          value={formatTokens(totalTokensOf(totals))}
        />
        <StatCard icon={Zap} label="Cache hit rate" value={`${totals.cacheHitRate.toFixed(1)}%`} />
      </div>

      <Section title="Daily cost">
        <DailyTrend rows={data.day.rows} />
      </Section>

      <Section title="By project">
        <GroupRows rows={data.project.rows} labelOf={projectBasename} />
      </Section>

      <Section title="Model mix">
        <GroupRows rows={data.model.rows} labelOf={(k) => k} />
      </Section>
    </div>
  )
}
