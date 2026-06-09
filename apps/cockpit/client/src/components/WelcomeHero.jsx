import { Rocket, ShieldCheck } from 'lucide-react'

// First-run hero shown in the Agents main panel when there are zero sessions, so
// the empty front door is a guided start instead of a blank board (L2 "adoptable":
// empty ~/.claude/projects shows a Welcome + one-click first agent).
//
// Two steps on purpose (ADR-0005 — the window must advance the rails, not just be
// polish): (1) start your first agent, and (2) adopt the defensible half by
// trusting a folder / installing the rails. Presentational + props-driven so it
// is trivially testable.
export function WelcomeHero({ onStartFirstAgent, onOpenTrust }) {
  return (
    <div className="flex-1 overflow-auto flex items-center justify-center p-6">
      <div className="max-w-md w-full text-center space-y-5">
        <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center">
          <Rocket size={22} className="text-indigo-300" />
        </div>

        <div className="space-y-1.5">
          <h1 className="text-lg font-semibold text-gray-100">Welcome to Mission Control</h1>
          <p className="text-sm text-gray-400">
            No agents yet. Start your first Claude Code agent and it will show up here live — across
            every project you run.
          </p>
        </div>

        <button
          onClick={onStartFirstAgent}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 transition-colors"
        >
          <Rocket size={15} />
          Start your first agent
        </button>

        <div className="pt-4 mt-2 border-t border-gray-800 text-left">
          <div className="flex items-start gap-2.5">
            <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-gray-300">
                Add the guardrails (optional, recommended)
              </div>
              <p className="mt-0.5 text-[11px] text-gray-500">
                The cockpit is the window; the rails are the accident-prevention. Trust a folder to
                control how agents run there, or add the opt-in hooks from a project&apos;s Mission
                Control view.
              </p>
              <button
                onClick={onOpenTrust}
                className="mt-1.5 text-[11px] font-medium text-emerald-400 hover:text-emerald-300 transition-colors"
              >
                Manage trusted folders →
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
