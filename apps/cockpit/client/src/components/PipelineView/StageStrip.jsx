import { ArrowRight, CheckCircle2, CircleDashed, Lock } from 'lucide-react'

// Honest three-slot pipeline strip. `harness status --json` only emits
// last_completed_phase / phase / next_phase (never the full ordered phase
// graph — see packages/contracts/schemas/harness-status.schema.json), so we
// render exactly that window: done → current → next. Null slots are simply
// absent; nothing is ever mocked (the Rewrite Brief's no-fake-canvas rule).
// The single gate pin between current and next is the real `pipeline.gate`.

function StageChip({ name, state }) {
  const styles = {
    done: 'text-[color:var(--mc-ok)] border-[color:var(--mc-border-2)]',
    running:
      'text-[color:var(--mc-accent-2)] border-[color:var(--mc-accent-line)] bg-[color:var(--mc-accent-soft)]',
    blocked:
      'text-[color:var(--mc-warn)] border-[color:var(--mc-warn)] bg-[color:var(--mc-warn-soft)]',
    pending: 'text-[color:var(--mc-fg-4)] border-[color:var(--mc-border)] border-dashed',
  }
  return (
    <span
      data-stage-state={state}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${styles[state]}`}
    >
      {state === 'done' && <CheckCircle2 size={12} />}
      {state === 'running' && (
        <span className="relative flex h-2 w-2" aria-hidden="true">
          <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--mc-accent)] opacity-60" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--mc-accent)]" />
        </span>
      )}
      {state === 'blocked' && <Lock size={12} />}
      {state === 'pending' && <CircleDashed size={12} />}
      {name}
    </span>
  )
}

function GatePin({ gate, blocked, blocker }) {
  return (
    <span className="inline-flex flex-col items-center gap-0.5 px-1" data-testid="gate-pin">
      <span
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${
          blocked
            ? 'text-[color:var(--mc-warn)] bg-[color:var(--mc-warn-soft)]'
            : 'text-[color:var(--mc-fg-4)] bg-[color:var(--mc-surface-2)]'
        }`}
        title={blocked && blocker ? blocker : `gate: ${gate}`}
      >
        <Lock size={9} />
        {gate}
      </span>
      <ArrowRight size={10} className="text-[color:var(--mc-fg-5)]" aria-hidden="true" />
    </span>
  )
}

export function StageStrip({ pipeline, blocked, blocker }) {
  const last = pipeline?.last_completed_phase
  const current = pipeline?.phase
  const next = pipeline?.next_phase
  if (!last && !current && !next) return null

  return (
    <div
      className="flex items-center flex-wrap gap-1.5"
      role="list"
      aria-label="Pipeline phases (completed, current, next)"
    >
      {last && (
        <span role="listitem" className="flex items-center gap-1.5">
          <StageChip name={last} state="done" />
          <ArrowRight size={11} className="text-[color:var(--mc-fg-5)]" aria-hidden="true" />
        </span>
      )}
      {current && (
        <span role="listitem">
          <StageChip name={current} state={blocked ? 'blocked' : 'running'} />
        </span>
      )}
      {current && next && pipeline?.gate && (
        <GatePin gate={pipeline.gate} blocked={blocked} blocker={blocker} />
      )}
      {current && next && !pipeline?.gate && (
        <ArrowRight size={11} className="text-[color:var(--mc-fg-5)]" aria-hidden="true" />
      )}
      {next && (
        <span role="listitem">
          <StageChip name={next} state="pending" />
        </span>
      )}
    </div>
  )
}
