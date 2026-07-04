// The canonical text input. Consolidates the ad-hoc input styling (bg/border/
// placeholder/focus colors re-derived per form) into one primitive. --mc-*
// tokens only; the border brightens on focus (outline stays with the global
// :focus-visible ring for keyboard users).

export function Input({ className = '', ...rest }) {
  return (
    <input
      className={`w-full rounded border border-[var(--mc-border-2)] bg-[var(--mc-surface)] px-2 py-1.5 text-xs text-[var(--mc-fg-2)] placeholder-[var(--mc-fg-4)] focus:outline-none focus:border-[var(--mc-accent)] disabled:opacity-40 ${className}`}
      {...rest}
    />
  )
}
