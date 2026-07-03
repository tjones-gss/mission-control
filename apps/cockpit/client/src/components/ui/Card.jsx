// The canonical surface container. Consolidates the ad-hoc
// rounded-lg/border/bg-surface wrappers into one primitive so radius, border
// weight, and surface tone stay consistent. --mc-* tokens only.
//
//   variant: surface (default) | raised (surface-2) | glass (blurred, for
//            overlays/drawers)
//   interactive: hover affordance + acts as a <button> when onClick is given

const VARIANTS = {
  surface: 'bg-[var(--mc-surface)] border-[var(--mc-border)]',
  raised: 'bg-[var(--mc-surface-2)] border-[var(--mc-border-2)]',
  glass: 'bg-[var(--mc-glass)] border-[var(--mc-glass-brd)] backdrop-blur-lg',
}

export function Card({
  variant = 'surface',
  interactive = false,
  className = '',
  onClick,
  children,
  ...rest
}) {
  const cls = `rounded-lg border ${VARIANTS[variant] || VARIANTS.surface} ${
    interactive ? 'transition-colors hover:border-[var(--mc-border-3)] text-left' : ''
  } ${className}`
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`block w-full ${cls}`} {...rest}>
        {children}
      </button>
    )
  }
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  )
}
