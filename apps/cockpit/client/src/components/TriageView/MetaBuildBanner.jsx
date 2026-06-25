import { Settings } from 'lucide-react'

// Phase S1 — Oversight watches its own build. When a session's cwd is the
// Oversight repo (server tags it `meta: true`), this banner surfaces that
// Oversight is monitoring its own construction with tighter anomaly thresholds.
// Presentational: the optional `onSteer` handler wires the "Steer build" action
// (it POSTs STEER_BUILD_MESSAGE to the session) at the call site. --mc-* only.

// The pre-composed self-correction nudge. Mirrors the server-side constant in
// intelligence/meta-session-detector.js (the client is what actually sends it).
export const STEER_BUILD_MESSAGE =
  'Review your last 3 commits, run `npm run test:cockpit`, and report what is failing.'

export function MetaBuildBanner({ count = 0, onSteer }) {
  return (
    <div
      className="mb-5 flex items-center gap-3 rounded-xl border px-4 py-3"
      style={{
        borderColor: 'var(--mc-accent-line)',
        backgroundColor: 'var(--mc-surface)',
      }}
    >
      <Settings size={18} className="shrink-0 text-[var(--mc-accent)]" aria-hidden="true" />
      <div className="flex-1">
        <div className="text-sm font-semibold text-[var(--mc-fg)]">⚙ Building Oversight</div>
        <p className="mt-0.5 text-xs text-[var(--mc-fg-3)]">
          {count} session{count === 1 ? '' : 's'} working in this repo — monitored with tighter
          stall/loop thresholds so a wandering build agent is caught sooner.
        </p>
      </div>
      {onSteer && (
        <button
          onClick={onSteer}
          className="shrink-0 rounded-lg border border-[var(--mc-accent-line)] bg-[var(--mc-surface-2)] px-3 py-1.5 text-xs font-semibold text-[var(--mc-accent)] transition-colors hover:bg-[var(--mc-surface)]"
        >
          Steer build
        </button>
      )}
    </div>
  )
}
