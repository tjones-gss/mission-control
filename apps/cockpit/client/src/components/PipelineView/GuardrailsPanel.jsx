import { Ban, ClipboardCheck, ShieldAlert, UserCheck } from 'lucide-react'
import { Card } from '../ui/Card.jsx'
import { Chip } from '../ui/Chip.jsx'

// Guardrails as first-class visual objects (the Oversight design's thesis:
// surface the safety machinery instead of burying it in config). Every card
// maps 1:1 to REAL v10 status data — an absent config renders no card, and a
// harness without the v10 fields renders nothing at all.

function RailCard({ icon: Icon, title, children }) {
  return (
    <Card className="flex-1 min-w-44 p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--mc-fg-2)]">
        <Icon size={12} className="shrink-0 text-[var(--mc-accent)]" />
        {title}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-[var(--mc-fg-4)]">
        {children}
      </div>
    </Card>
  )
}

export function GuardrailsPanel({ guardrails, blockedTransitions }) {
  const dz = guardrails?.danger_zone
  const qg = guardrails?.quality_gates
  const ha = guardrails?.human_approval
  // blocked_transitions may be a map (name → bool) or an array of names.
  const blocks = Array.isArray(blockedTransitions)
    ? blockedTransitions
    : Object.entries(blockedTransitions || {})
        .filter(([, v]) => v)
        .map(([k]) => k)

  const hasAny = dz?.present || qg?.present || ha?.present || blocks.length > 0
  if (!hasAny) return null

  return (
    <section aria-label="Guardrails">
      <div className="mc-eyebrow mb-2">Guardrails</div>
      <div className="flex flex-wrap gap-2">
        {dz?.present && (
          <RailCard icon={ShieldAlert} title="Danger zone">
            {typeof dz.approval_required_count === 'number' && (
              <Chip tone="warn" caps={false}>
                {dz.approval_required_count} ops need approval
              </Chip>
            )}
            {typeof dz.blocked_pattern_count === 'number' && (
              <Chip tone="danger" caps={false}>
                {dz.blocked_pattern_count} command patterns blocked
              </Chip>
            )}
          </RailCard>
        )}
        {qg?.present && qg.stages && (
          <RailCard icon={ClipboardCheck} title="Quality gates">
            {Object.entries(qg.stages).map(([stage, checks]) => (
              <Chip key={stage} caps={false} title={(checks || []).join(', ')}>
                {stage.replace(/_/g, ' ')} · {(checks || []).length}
              </Chip>
            ))}
          </RailCard>
        )}
        {ha?.present && (
          <RailCard icon={UserCheck} title="Human approval">
            {(ha.categories || []).map((c) => (
              <Chip key={c} tone="info" caps={false}>
                {c}
              </Chip>
            ))}
          </RailCard>
        )}
        {blocks.length > 0 && (
          <RailCard icon={Ban} title="Hard blocks">
            {blocks.map((b) => (
              <Chip key={b} tone="danger" caps={false} className="max-w-full">
                <span className="truncate">{b.replace(/_/g, ' ')}</span>
              </Chip>
            ))}
          </RailCard>
        )}
      </div>
    </section>
  )
}
