import { CheckCircle2, CircleDashed, Cog, Lock } from 'lucide-react'
import { Chip } from '../ui/Chip.jsx'

// The full pipeline canvas — rendered ONLY when the harness emits the v10
// `phases` array (the active pipeline definition's ordered stage graph).
// Older harnesses without it fall back to the honest 3-slot StageStrip.
//
// Phase state is DERIVED client-side from position: everything before the
// current phase is done, the current phase is running (or blocked when
// next.blocked), everything after is pending. Gate pins sit on each phase's
// exit boundary and are styled by the emitter's auto/manual classification
// (`gates` map) — auto gates are machine-evaluated, manual ones wait on you.

function phaseState(idx, currentIdx, blocked) {
  if (currentIdx < 0) return 'pending'
  if (idx < currentIdx) return 'done'
  if (idx === currentIdx) return blocked ? 'blocked' : 'running'
  return 'pending'
}

const STAGE_STYLES = {
  done: 'border-[color:var(--mc-border-2)]',
  running: 'border-[color:var(--mc-accent-line)] bg-[color:var(--mc-accent-soft)]',
  blocked: 'border-[color:var(--mc-warn)] bg-[color:var(--mc-warn-soft)]',
  pending: 'border-dashed border-[color:var(--mc-border)]',
}

const TITLE_STYLES = {
  done: 'text-[color:var(--mc-ok)]',
  running: 'text-[color:var(--mc-accent-2)]',
  blocked: 'text-[color:var(--mc-warn)]',
  pending: 'text-[color:var(--mc-fg-4)]',
}

function StageCard({ phase, state }) {
  return (
    <div
      role="listitem"
      data-stage-state={state}
      className={`w-40 shrink-0 rounded-lg border p-2.5 ${STAGE_STYLES[state]}`}
      title={phase.description || phase.goal || phase.id}
    >
      <div className={`flex items-center gap-1.5 text-xs font-medium ${TITLE_STYLES[state]}`}>
        {state === 'done' && <CheckCircle2 size={12} className="shrink-0" />}
        {state === 'running' && (
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--mc-accent)] opacity-60" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--mc-accent)]" />
          </span>
        )}
        {state === 'blocked' && <Lock size={12} className="shrink-0" />}
        {state === 'pending' && <CircleDashed size={12} className="shrink-0" />}
        <span className="truncate">{phase.id}</span>
      </div>
      {phase.agent && (
        <div className="mt-1.5">
          <Chip caps={false} className="max-w-full">
            <span className="truncate">{phase.agent}</span>
          </Chip>
        </div>
      )}
    </div>
  )
}

// The gate pin on a phase's exit boundary. Auto gates render as quiet gears;
// manual (human) gates as locks. The current phase's pin heats up: accented
// while running, warn while blocked.
function GatePin({ names, gateKinds, isCurrent, blocked }) {
  if (!names || names.length === 0) {
    return (
      <div className="w-4 shrink-0 border-t border-[color:var(--mc-border)]" aria-hidden="true" />
    )
  }
  const manual = names.some((n) => gateKinds?.[n]?.auto === false)
  const tone = isCurrent
    ? blocked
      ? 'text-[color:var(--mc-warn)]'
      : 'text-[color:var(--mc-accent-2)]'
    : 'text-[color:var(--mc-fg-5)]'
  return (
    <div
      data-testid="canvas-gate-pin"
      data-gate-kind={manual ? 'manual' : 'auto'}
      className="flex w-8 shrink-0 flex-col items-center justify-center gap-0.5"
      title={`${manual ? 'Manual gate' : 'Auto gate'}: ${names.join(', ')}`}
    >
      <span className={tone}>{manual ? <Lock size={12} /> : <Cog size={12} />}</span>
      <span className="h-px w-full bg-[color:var(--mc-border)]" aria-hidden="true" />
    </div>
  )
}

export function StageCanvas({ phases, currentPhase, blocked, gateKinds }) {
  if (!Array.isArray(phases) || phases.length === 0) return null
  const currentIdx = phases.findIndex((p) => p.id === currentPhase)

  return (
    <div
      role="list"
      aria-label="Pipeline stages"
      className="flex items-stretch gap-0 overflow-x-auto pb-1"
    >
      {phases.map((phase, idx) => (
        <div key={phase.id} className="flex items-center">
          <StageCard phase={phase} state={phaseState(idx, currentIdx, blocked)} />
          {idx < phases.length - 1 && (
            <GatePin
              names={phase.gate?.required}
              gateKinds={gateKinds}
              isCurrent={idx === currentIdx}
              blocked={blocked}
            />
          )}
        </div>
      ))}
    </div>
  )
}
