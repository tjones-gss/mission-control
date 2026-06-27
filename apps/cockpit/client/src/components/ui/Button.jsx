// The three canonical button variants for the app. Consolidates the ad-hoc
// indigo/gray/ghost button styles scattered across surfaces into one primitive
// so weight, radius, and disabled behavior stay consistent. --mc-* tokens only;
// the global :focus-visible ring (index.css) supplies the focus indicator.
//
//   primary   — the main affirmative action (filled accent)
//   secondary — a bordered, lower-emphasis action
//   ghost     — text-only, lowest emphasis

const VARIANTS = {
  primary:
    'bg-[var(--mc-accent)] text-[var(--mc-on-accent)] hover:bg-[var(--mc-accent-deep)] border border-transparent',
  secondary:
    'bg-[var(--mc-surface)] text-[var(--mc-fg-2)] border border-[var(--mc-border-2)] hover:bg-[var(--mc-surface-2)] hover:text-[var(--mc-fg)]',
  ghost:
    'bg-transparent text-[var(--mc-fg-3)] border border-transparent hover:text-[var(--mc-fg)] hover:bg-[var(--mc-surface)]',
}

export function Button({
  variant = 'secondary',
  type = 'button',
  className = '',
  disabled = false,
  children,
  ...rest
}) {
  const variantCls = VARIANTS[variant] || VARIANTS.secondary
  return (
    <button
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${variantCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
