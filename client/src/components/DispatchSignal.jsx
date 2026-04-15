import { useEffect, useState } from 'react'

/**
 * Full-viewport SVG overlay that animates an "electrical signal" — a
 * curved beam with a glowing head — from `from` to `to`. Used after a
 * successful single-target dispatch: drawer closes, signal flies from
 * the drawer to the session card, and on arrival the detail view opens.
 *
 * Both `from` and `to` are { x, y } in viewport coordinates. The
 * component renders nothing when `from` or `to` is null.
 *
 * onComplete fires after the animation finishes (default ~700ms) so
 * the parent can swap views.
 */
export function DispatchSignal({ from, to, onComplete, durationMs = 700 }) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (!from || !to) return
    let raf
    const start = performance.now()
    const tick = (now) => {
      const t = Math.min(1, (now - start) / durationMs)
      // Ease-out cubic — fast at start, slows into the target
      const eased = 1 - Math.pow(1 - t, 3)
      setProgress(eased)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        onComplete?.()
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [from, to, durationMs, onComplete])

  if (!from || !to) return null

  // Curved cubic Bezier from `from` to `to`. Bend the curve "outward"
  // by lifting the control points perpendicular to the line so the
  // beam arcs gracefully.
  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.hypot(dx, dy) || 1
  // Perpendicular unit vector, scaled by 25% of the distance for the bow
  const px = -dy / dist
  const py = dx / dist
  const bow = Math.min(180, dist * 0.25)
  const c1x = from.x + dx * 0.33 + px * bow
  const c1y = from.y + dy * 0.33 + py * bow
  const c2x = from.x + dx * 0.66 + px * bow
  const c2y = from.y + dy * 0.66 + py * bow

  // Sample the bezier at the current progress to position the head
  const t = progress
  const mt = 1 - t
  const headX =
    mt * mt * mt * from.x + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * to.x
  const headY =
    mt * mt * mt * from.y + 3 * mt * mt * t * c1y + 3 * mt * t * t * c2y + t * t * t * to.y

  // Trail length grows with progress; fades out as we arrive
  const dashLength = Math.max(40, dist * t * 0.45)
  const fade = 1 - Math.pow(progress, 3)

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[60]"
      style={{ width: '100vw', height: '100vh' }}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="dispatch-signal-head" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a5b4fc" stopOpacity="1" />
          <stop offset="40%" stopColor="#818cf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
        </radialGradient>
        <filter id="dispatch-signal-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* The full path, dimmed */}
      <path
        d={`M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`}
        stroke="rgba(99, 102, 241, 0.18)"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      {/* The animated trail — a dashed segment that follows the head */}
      <path
        d={`M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`}
        stroke="#818cf8"
        strokeWidth="3"
        fill="none"
        strokeLinecap="round"
        filter="url(#dispatch-signal-glow)"
        style={{
          strokeDasharray: `${dashLength} 10000`,
          strokeDashoffset: `${dist * (1 - t)}`,
          opacity: fade,
        }}
      />
      {/* The glowing head circle */}
      <circle
        cx={headX}
        cy={headY}
        r="14"
        fill="url(#dispatch-signal-head)"
        filter="url(#dispatch-signal-glow)"
        opacity={fade}
      />
      <circle cx={headX} cy={headY} r="4" fill="#e0e7ff" opacity={fade} />
    </svg>
  )
}
