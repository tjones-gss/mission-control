import { useId, useState } from 'react'
import { Info, ChevronDown, ChevronUp, X } from 'lucide-react'
import { BRIEFS } from './briefs.js'

// A slim, dismissible, expandable explainer shown at the top of a surface.
// Driven entirely by the central registry (briefs.js) keyed on `surfaceId`.
// Renders nothing for an unknown or empty id (defensive — tab files can pass
// any active id without guarding).
//
// Three states:
//   1. Default     — ⓘ + one-line summary + expand (▾) + dismiss (✕)
//   2. Expanded    — same bar plus the multi-line body; ▴ collapses (ephemeral)
//   3. Dismissed   — the bar is replaced, in the same slot, by a thin right-
//                    aligned row with only the ⓘ re-opener
//
// Only the dismissed flag is persisted (per surface), wrapped in try/catch so a
// missing/throwing localStorage (private mode, tests) degrades gracefully —
// mirroring the readShowAdvanced pattern in App.jsx.

const dismissedKey = (surfaceId) => `mc.brief.${surfaceId}.dismissed`

// Read the persisted dismissed flag for a surface. Guarded so a missing or
// throwing localStorage defaults to "not dismissed" (the brief shows).
function readDismissed(surfaceId) {
  try {
    return localStorage.getItem(dismissedKey(surfaceId)) === 'true'
  } catch {
    return false
  }
}

export function FeatureBrief({ surfaceId }) {
  const brief = surfaceId ? BRIEFS[surfaceId] : null
  const [dismissed, setDismissed] = useState(() => readDismissed(surfaceId))
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  // Unknown or empty id → render nothing.
  if (!brief) return null

  const dismiss = () => {
    setExpanded(false)
    setDismissed(true)
    try {
      localStorage.setItem(dismissedKey(surfaceId), 'true')
    } catch {
      /* ignore persistence failures (private mode, etc.) */
    }
  }

  const reopen = () => {
    setDismissed(false)
    try {
      localStorage.removeItem(dismissedKey(surfaceId))
    } catch {
      /* ignore persistence failures */
    }
  }

  // State 3 — dismissed: a thin, right-aligned row with only the re-opener.
  if (dismissed) {
    return (
      <div className="shrink-0 flex justify-end border-b border-gray-800 bg-gray-900/40 px-3 py-1">
        <button
          onClick={reopen}
          className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
          aria-label="Show brief"
        >
          <Info size={13} />
        </button>
      </div>
    )
  }

  // States 1 + 2 — the slim bar, optionally with the body below.
  return (
    <div className="shrink-0 border-b border-gray-800 bg-gray-900/40">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <Info size={13} className="shrink-0 text-indigo-400" />
        <span className="min-w-0 truncate text-xs text-gray-300">{brief.summary}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={() => setExpanded((prev) => !prev)}
            className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
            aria-expanded={expanded}
            aria-controls={bodyId}
          >
            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          <button
            onClick={dismiss}
            className="text-gray-600 hover:text-gray-300 transition-colors p-0.5 rounded"
            aria-label="Dismiss brief"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      {expanded && (
        <div id={bodyId} className="px-3 pb-2 pl-8 text-xs leading-relaxed text-gray-400">
          {brief.body}
        </div>
      )}
    </div>
  )
}
