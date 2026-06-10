// The gray + indigo palettes resolve through the --mc-* theme-cascade channel
// variables (defined in src/index.css), so every existing `bg-gray-*` /
// `indigo-*` utility — including /50 alpha-modifier forms — follows the active
// data-theme without touching any component. `:root` pins the exact default
// Tailwind channels, so the classic theme is pixel-identical to the
// pre-cascade build. Guarded by src/tests/theme-cascade.test.js.
const RUNGS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const themed = (palette) =>
  Object.fromEntries(RUNGS.map((r) => [r, `rgb(var(--mc-${palette}-${r}) / <alpha-value>)`]))

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        gray: themed('gray'),
        indigo: themed('indigo'),
      },
      boxShadow: {
        'glow-green': '0 0 8px rgba(74, 222, 128, 0.25)',
        'glow-yellow': '0 0 8px rgba(234, 179, 8, 0.25)',
        'glow-cyan': '0 0 8px rgba(34, 211, 238, 0.2)',
      },
      // Named overlay stacking scale. App-shell layout layers (sidebar z-10,
      // main z-0) stay as Tailwind defaults; these tokens are for chrome that
      // floats ABOVE the layout (dropdowns, drawers, modals, toasts, signals)
      // so precedence is explicit and collisions are impossible. Ordered.
      zIndex: {
        dropdown: '1000',
        drawerBackdrop: '1090',
        drawer: '1100',
        modalBackdrop: '1200',
        modal: '1300',
        toast: '1400',
        signal: '1500',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}
