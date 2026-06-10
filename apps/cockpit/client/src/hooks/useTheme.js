import { useState, useCallback, useEffect } from 'react'

// The cockpit's visual themes. `classic` is the historical cold-gray/indigo
// look and is the default, so an existing user sees no change until they opt in.
// `calm`, `tron`, and `warm` come from the Oversight design handoff and are
// applied purely as a `data-theme` attribute on <html>; the token values live in
// index.css. Adding a theme here is the only code change needed — the CSS layer
// keys off the id. (ADR-0005: this rides the rails-backed redesign slice; on its
// own a theme switch is window-only polish.)
export const THEMES = [
  { id: 'classic', label: 'Classic', blurb: 'Cold gray-950 + indigo (the original).' },
  { id: 'calm', label: 'Calm', blurb: 'Vibrant-but-soft periwinkle on blue-slate.' },
  { id: 'tron', label: 'Tron', blurb: 'Deep blue-black + electric cyan.' },
  { id: 'warm', label: 'Warm gold', blurb: 'Cream-on-charcoal with a gold accent.' },
]

export const THEME_IDS = THEMES.map((t) => t.id)

const STORAGE_KEY = 'oversight.theme'
const DEFAULT_THEME = 'classic'

// Read the persisted theme. Guarded so a missing key, a throwing localStorage
// (private mode / tests), or a stale/unknown value all degrade to the default
// rather than leaving the app on an undefined theme.
export function getTheme() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw && THEME_IDS.includes(raw)) return raw
  } catch {
    /* ignore — fall through to default */
  }
  return DEFAULT_THEME
}

// Apply a theme to the document root. Unknown ids are ignored so a bad caller
// can never strand the UI on an undefined theme. Persisting is best-effort.
export function setTheme(theme) {
  if (!THEME_IDS.includes(theme)) return getTheme()
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* ignore — still apply for this session */
  }
  applyTheme(theme)
  return theme
}

function applyTheme(theme) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = theme
  }
}

// Hook owning the active theme. Applies it on mount (so the persisted choice
// takes effect on boot) and exposes a setter that persists + re-applies.
export function useTheme() {
  const [theme, setThemeState] = useState(getTheme)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const update = useCallback((next) => {
    if (!THEME_IDS.includes(next)) return
    setTheme(next)
    setThemeState(next)
  }, [])

  return { theme, setTheme: update, themes: THEMES }
}
