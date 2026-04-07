import { useState, useEffect, useCallback } from 'react'
import { LayoutList, List } from 'lucide-react'
import { HistoryStatsBar } from './HistoryStatsBar.jsx'
import { HistoryFeed } from './HistoryFeed.jsx'

const PAGE_SIZE = 100

export function HistoryTab({ historyVersion }) {
  const [stats, setStats] = useState(null)
  const [entries, setEntries] = useState([])
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [search, setSearch] = useState('')
  const [projectFilter, setProjectFilter] = useState('')
  const [grouped, setGrouped] = useState(false)
  const [fetchError, setFetchError] = useState(null)

  const fetchStats = useCallback(async (signal) => {
    try {
      const res = await fetch('/api/history/stats', { signal })
      if (res.ok) setStats(await res.json())
    } catch (err) {
      if (err.name === 'AbortError') return
      console.error('Failed to fetch stats:', err)
    }
  }, [])

  const fetchPage = useCallback(
    async (newOffset = 0, replace = true, signal) => {
      const params = new URLSearchParams({ limit: PAGE_SIZE, offset: newOffset })
      if (projectFilter) params.set('project', projectFilter)
      try {
        const res = await fetch(`/api/history?${params}`, { signal })
        if (!res.ok) return
        const data = await res.json()
        setEntries((prev) => (replace ? data : [...prev, ...data]))
        setHasMore(data.length === PAGE_SIZE)
        setOffset(newOffset + data.length)
      } catch (err) {
        if (err.name === 'AbortError') return
        setFetchError('Failed to load history')
        console.error('Failed to fetch history:', err)
      }
    },
    [projectFilter],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetchStats(controller.signal)
    fetchPage(0, true, controller.signal)
    return () => controller.abort()
  }, [fetchStats, fetchPage, historyVersion])

  const allProjects = [...new Set(entries.map((e) => e.project).filter(Boolean))]

  const filtered = search
    ? entries.filter((e) => e.display?.toLowerCase().includes(search.toLowerCase()))
    : entries

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <HistoryStatsBar stats={stats} />
      {fetchError && <div className="px-3 py-1.5 text-xs text-red-400">{fetchError}</div>}

      {/* Controls */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-800">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search history\u2026"
          className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-300 placeholder-gray-700 focus:outline-none focus:border-gray-600"
        />
        <select
          value={projectFilter}
          onChange={(e) => {
            setProjectFilter(e.target.value)
            fetchPage(0, true)
          }}
          className="bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-400 focus:outline-none"
        >
          <option value="">All projects</option>
          {allProjects.map((p) => (
            <option key={p} value={p}>
              {p.split(/[\\/]/).pop()}
            </option>
          ))}
        </select>
        <button
          onClick={() => setGrouped((g) => !g)}
          aria-label={grouped ? 'Flat view' : 'Group by project'}
          title={grouped ? 'Flat view' : 'Group by project'}
          className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${grouped ? 'bg-gray-800 text-gray-200' : 'text-gray-600 hover:text-gray-400'}`}
        >
          {grouped ? <List size={11} /> : <LayoutList size={11} />}
          Group
        </button>
      </div>

      <HistoryFeed
        entries={filtered}
        grouped={grouped}
        hasMore={hasMore && !search}
        onLoadMore={() => fetchPage(offset, false)}
      />
    </div>
  )
}
