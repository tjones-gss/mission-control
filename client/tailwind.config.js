export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      boxShadow: {
        'glow-green': '0 0 8px rgba(74, 222, 128, 0.25)',
        'glow-yellow': '0 0 8px rgba(234, 179, 8, 0.25)',
        'glow-cyan': '0 0 8px rgba(34, 211, 238, 0.2)',
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
