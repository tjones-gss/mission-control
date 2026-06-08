export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
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
