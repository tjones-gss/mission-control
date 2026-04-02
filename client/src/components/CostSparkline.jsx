import { useState, useMemo } from 'react'
import { buildCostTimeline } from '../utils/sparkline.js'
import { formatCost } from '../utils/cost.js'

export function CostSparkline({ messages, model, width = 200, height = 40, className = '' }) {
  const [hoveredIndex, setHoveredIndex] = useState(null)

  const timeline = useMemo(() => buildCostTimeline(messages, model), [messages, model])

  if (timeline.length < 2) return null

  const maxCost = timeline[timeline.length - 1].cumulativeCost
  if (maxCost === 0) return null

  const padding = 2
  const innerW = width - padding * 2
  const innerH = height - padding * 2

  const points = timeline.map((point, i) => {
    const x = padding + (i / (timeline.length - 1)) * innerW
    const y = padding + innerH - (point.cumulativeCost / maxCost) * innerH
    return { x, y, ...point }
  })

  const polyline = points.map(p => `${p.x},${p.y}`).join(' ')

  // Area fill path
  const areaPath = [
    `M ${points[0].x},${padding + innerH}`,
    ...points.map(p => `L ${p.x},${p.y}`),
    `L ${points[points.length - 1].x},${padding + innerH}`,
    'Z',
  ].join(' ')

  const hovered = hoveredIndex != null ? points[hoveredIndex] : null

  return (
    <div className={`relative ${className}`}>
      <svg
        width={width}
        height={height}
        className="block"
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {/* Area fill */}
        <path d={areaPath} fill="url(#sparkGradient)" opacity={0.3} />

        {/* Gradient definition */}
        <defs>
          <linearGradient id="sparkGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#10b981"
          strokeWidth={1.5}
          strokeLinejoin="round"
        />

        {/* Hover targets (invisible wide rects) */}
        {points.map((p, i) => (
          <rect
            key={i}
            x={p.x - innerW / timeline.length / 2}
            y={0}
            width={innerW / timeline.length}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHoveredIndex(i)}
          />
        ))}

        {/* Hover dot */}
        {hovered && (
          <circle cx={hovered.x} cy={hovered.y} r={3} fill="#10b981" stroke="#1f2937" strokeWidth={1.5} />
        )}
      </svg>

      {/* Tooltip */}
      {hovered && (
        <div
          className="absolute -top-8 px-1.5 py-0.5 rounded bg-gray-800 border border-gray-700 text-[10px] text-gray-200 whitespace-nowrap pointer-events-none z-10"
          style={{ left: Math.min(hovered.x, width - 80) }}
        >
          {formatCost(hovered.cumulativeCost)} total ({formatCost(hovered.turnCost)} this turn)
        </div>
      )}

      {/* Label */}
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[9px] text-gray-600">cost over time</span>
        <span className="text-[9px] text-emerald-600">{formatCost(maxCost)}</span>
      </div>
    </div>
  )
}
