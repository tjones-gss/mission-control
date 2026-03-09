import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi.js'

const STORAGE_KEY = 'intel_enabled'

export function IntelView({ sessionId, intelligenceVersion, active }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === 'true')

  const url = enabled && active && sessionId ? `/api/sessions/${sessionId}/intelligence` : null
  const { data, loading, error, refetch } = useApi(url, [intelligenceVersion])

  const [ageLabel, setAgeLabel] = useState('')

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

  function enable() {
    localStorage.setItem(STORAGE_KEY, 'true')
    setEnabled(true)
  }

  function disable() {
    localStorage.setItem(STORAGE_KEY, 'false')
    setEnabled(false)
  }

  // Disabled state — opt-in gate
  if (!enabled) {
    return (
      <div className="h-full overflow-y-auto p-4 space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">INTEL</span>
        </div>
        <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4 space-y-3">
          <div className="text-[10px] font-semibold text-amber-500 uppercase tracking-wider">Costs tokens</div>
          <p className="text-xs text-gray-400 leading-relaxed">
            Intel uses the Claude API (~$0.04 per analysis) to summarize the session.
            It is off by default to avoid unexpected usage.
          </p>
          <button
            onClick={enable}
            className="text-[11px] px-3 py-1.5 rounded border border-amber-800/60 text-amber-400 hover:bg-amber-900/30 transition-colors"
          >
            Enable Intel analysis
          </button>
        </div>
      </div>
    )
  }

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
          <button onClick={disable} className="ml-auto text-[10px] text-gray-700 hover:text-gray-500 transition-colors">disable</button>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-3">
          <p className="text-xs text-gray-500 leading-relaxed">
            Intel analysis failed
            {error && error !== 'analysis_failed'
              ? `: ${error}`
              : ' — make sure the claude CLI is installed and authenticated'}
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
        <button onClick={disable} className="text-[10px] text-gray-700 hover:text-gray-500 transition-colors">disable</button>
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
