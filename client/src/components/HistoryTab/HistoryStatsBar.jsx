import { Clock, Hash, FolderOpen, Calendar } from 'lucide-react'

function Sparkline({ data }) {
  if (!data?.length) return <div data-testid="sparkline" className="flex gap-0.5 items-end h-6" />
  const max = Math.max(...data.map((d) => d.count), 1)
  return (
    <div data-testid="sparkline" className="flex gap-0.5 items-end h-6" title="7-day activity">
      {data.map((d) => (
        <div
          key={d.date}
          title={`${d.date}: ${d.count}`}
          className="w-3 bg-blue-500 rounded-sm opacity-70 hover:opacity-100 transition-opacity"
          style={{ height: `${Math.max(2, (d.count / max) * 24)}px` }}
        />
      ))}
    </div>
  )
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="flex items-center gap-2 bg-gray-900 rounded px-3 py-2">
      <Icon size={11} className="text-gray-600 shrink-0" />
      <div>
        <div className="text-xs text-gray-600 leading-none mb-0.5">{label}</div>
        <div
          className="text-sm font-semibold text-gray-200 truncate max-w-32"
          title={String(value)}
        >
          {value ?? '—'}
        </div>
      </div>
    </div>
  )
}

export function HistoryStatsBar({ stats }) {
  if (!stats) return null
  const projectBasename = stats.topProject ? stats.topProject.split(/[\\/]/).pop() : null
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800 overflow-x-auto">
      <StatCard icon={Hash} label="Total" value={stats.total} />
      <StatCard icon={Calendar} label="Today" value={stats.today} />
      <StatCard icon={Clock} label="Top command" value={stats.topCommand} />
      <StatCard icon={FolderOpen} label="Top project" value={projectBasename} />
      <div className="ml-auto shrink-0">
        <Sparkline data={stats.dailyActivity} />
      </div>
    </div>
  )
}
