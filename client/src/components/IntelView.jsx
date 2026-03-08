import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi.js'

export function IntelView({ sessionId, intelligenceVersion, active }) {
  const url = active && sessionId ? `/api/sessions/${sessionId}/intelligence` : null
  const { data, loading, error, refetch } = useApi(url, [intelligenceVersion])

  const [ageLabel, setAgeLabel] = useState('')

  // 30s polling while active
  useEffect(() => {
    if (!active) return
    const id = setInterval(refetch, 30_000)
    return () => clearInterval(id)
  }, [active, refetch])

  // "Analyzed X ago" counter
  useEffect(() => {
    if (!data?.analyzedAt) return
    const update = () => {
      const s = Math.round((Date.now() - data.analyzedAt) / 1000)
      setAgeLabel(s < 60 ? `${s}s` : `${Math.round(s / 60)}m`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [data?.analyzedAt])

  if (loading && !data) {
    return (
      <div className="h-full overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">INTEL</span>
          <span className="text-[10px] text-gray-700">Analyzing...</span>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-3 bg-gray-800 rounded w-3/4" />
          <div className="h-3 bg-gray-800 rounded w-1/2" />
          <div className="h-3 bg-gray-800 rounded w-2/3" />
          <div className="h-3 bg-gray-800 rounded w-5/6" />
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full overflow-y-auto p-4">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">INTEL</span>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Intelligence unavailable — make sure the claude CLI is installed and authenticated
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">INTEL</span>
        {ageLabel && (
          <>
            <span className="text-gray-700 text-[10px]">·</span>
            <span className="text-[10px] text-gray-600">analyzed {ageLabel} ago</span>
          </>
        )}
        <button
          onClick={refetch}
          className="ml-auto text-gray-600 hover:text-gray-400 transition-colors text-sm leading-none"
          title="Refresh intelligence"
        >
          ↻
        </button>
      </div>

      {data && (
        <>
          {/* Goal */}
          {data.goal && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">GOAL</div>
              <div className="text-xs text-gray-300 leading-relaxed">{data.goal}</div>
            </div>
          )}

          {/* Progress */}
          {data.progress && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">PROGRESS</div>
              <div className="text-xs text-gray-300 leading-relaxed">{data.progress}</div>
            </div>
          )}

          {/* Flags — hidden if empty */}
          {data.flags && data.flags.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">FLAGS</div>
              <div className="space-y-0.5">
                {data.flags.map((flag, i) => (
                  <div key={i} className="text-xs text-amber-400 leading-relaxed">
                    ⚠ {flag}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Subagents */}
          {data.subagents && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">SUBAGENTS</div>
              <div className="text-xs text-gray-300 leading-relaxed">{data.subagents}</div>
            </div>
          )}

          {/* Recommendation — hidden if null */}
          {data.recommendation && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">RECOMMENDATION</div>
              <div className="text-xs text-cyan-400 leading-relaxed">{data.recommendation}</div>
            </div>
          )}
        </>
      )}

      {/* Empty state when data loaded but all fields are empty */}
      {data && !data.goal && !data.progress && !data.subagents && (
        <div className="text-xs text-gray-700">No intelligence data available.</div>
      )}
    </div>
  )
}
