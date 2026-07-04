// The canonical status/label chip. Consolidates the ad-hoc pill spans
// (permission modes, run statuses, strategy tags, count badges) into one
// primitive so tone, radius, and type treatment stay consistent. --mc-* tokens
// only. Chips are informative by default (a <span>); pass onClick to render an
// interactive <button> with the same look.
//
//   tone: neutral | accent | ok | warn | danger | info
//   caps: uppercase-eyebrow treatment (default true — the console voice)

const TONES = {
  neutral: 'bg-[var(--mc-surface-2)] text-[var(--mc-fg-3)]',
  accent: 'bg-[var(--mc-accent-soft)] text-[var(--mc-accent-2)]',
  ok: 'bg-[var(--mc-ok-soft)] text-[var(--mc-ok)]',
  warn: 'bg-[var(--mc-warn-soft)] text-[var(--mc-warn)]',
  danger: 'bg-[var(--mc-danger-soft)] text-[var(--mc-danger)]',
  info: 'bg-[var(--mc-info-soft)] text-[var(--mc-info)]',
}

export function Chip({
  tone = 'neutral',
  caps = true,
  className = '',
  onClick,
  children,
  ...rest
}) {
  const cls = `inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${
    caps ? 'uppercase tracking-wide' : ''
  } ${TONES[tone] || TONES.neutral} ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`${cls} transition-colors`} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <span className={cls} {...rest}>
      {children}
    </span>
  )
}
