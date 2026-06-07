import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'

const REASON_LABEL = {
  'format-change': 'session format changed',
  'parse-failed': 'file unreadable',
  'read-failed': 'file unreadable',
  'cwd-scan-miss': 'project path not found in scan',
}

/**
 * Persistent banner shown when one or more ~/.claude parsers report a
 * PRESENT-BUT-UNPARSEABLE state — i.e. Mission Control found data but could not
 * read it. This is the visible half of the graceful-degrade layer: the server
 * emits `parser_degraded` SSE events, the App tracks the set, and this renders
 * an honest "we can't read this" instead of a silent blank (which would lie:
 * "no sessions" / "no guardrails active").
 *
 * @param {{ degraded?: Array<{ parser: string, reason?: string }> }} props
 */
export function ParserDegradedBanner({ degraded }) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || !Array.isArray(degraded) || degraded.length === 0) {
    return null
  }

  // De-dupe by parser name for a tidy summary.
  const byParser = new Map()
  for (const d of degraded) {
    if (d && d.parser && !byParser.has(d.parser)) byParser.set(d.parser, d.reason)
  }

  return (
    <div
      role="alert"
      className="bg-amber-900/60 border border-amber-500 rounded-md px-3 py-2 mx-4 mt-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <AlertTriangle size={14} className="text-amber-300 mt-0.5 shrink-0" />
          <div className="text-xs text-amber-100">
            <div className="font-semibold">
              Mission Control can't read your Claude data — likely a Claude Code update changed the
              on-disk format.
            </div>
            <div className="mt-1 text-amber-200/90">
              Affected:{' '}
              {[...byParser.entries()].map(([parser, reason], i) => (
                <span key={parser}>
                  {i > 0 ? ', ' : ''}
                  <span className="font-mono">{parser}</span>
                  {reason ? ` (${REASON_LABEL[reason] || reason})` : ''}
                </span>
              ))}
              . What you see may be incomplete — this is not the same as "nothing configured."
            </div>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-300/70 hover:text-amber-100 text-xs leading-none shrink-0"
          aria-label="Dismiss parser degraded warning"
        >
          x
        </button>
      </div>
    </div>
  )
}
