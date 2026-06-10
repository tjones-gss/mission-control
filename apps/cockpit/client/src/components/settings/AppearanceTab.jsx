import { useTheme } from '../../hooks/useTheme.js'

// Static preview swatches (background + accent) per theme id, so the picker can
// show each option's palette without mounting four themed subtrees. Mirrors the
// token values in index.css.
const PREVIEW = {
  classic: { bg: '#030712', accent: '#6366f1' },
  calm: { bg: '#14161f', accent: '#7f8dff' },
  tron: { bg: '#070a12', accent: '#2de2ff' },
  warm: { bg: '#13110d', accent: '#d6a45f' },
}

export function AppearanceTab() {
  const { theme, setTheme, themes } = useTheme()

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Theme</h3>
        <div className="space-y-2" role="radiogroup" aria-label="Theme">
          {themes.map((t) => {
            const selected = theme === t.id
            const swatch = PREVIEW[t.id] || PREVIEW.classic
            return (
              <button
                key={t.id}
                role="radio"
                aria-checked={selected}
                onClick={() => setTheme(t.id)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? 'border-indigo-500 bg-gray-800'
                    : 'border-gray-700 hover:border-gray-500 hover:bg-gray-800/50'
                }`}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-black/30"
                  style={{ backgroundColor: swatch.bg }}
                  aria-hidden="true"
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full"
                    style={{ backgroundColor: swatch.accent }}
                  />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium text-gray-200">{t.label}</span>
                  {t.blurb && <span className="block text-xs text-gray-600 mt-0.5">{t.blurb}</span>}
                </span>
                {selected && <span className="text-xs text-indigo-400">Active</span>}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-gray-600 mt-3 leading-relaxed">
          Themes recolor the cockpit via a single token layer. Classic is the original look; Calm,
          Tron, and Warm gold come from the Oversight redesign.
        </p>
      </section>
    </div>
  )
}
