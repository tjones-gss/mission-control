import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        // New-session startup can legitimately take longer than default proxy limits.
        // Keep the dev proxy alive long enough for the backend's 300s session creation window.
        timeout: 330000,
        proxyTimeout: 330000,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.js'],
    include: ['src/tests/**/*.test.{js,jsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Scope to the load-bearing UI: components + hooks. Tests, entry/bootstrap,
      // and config are excluded so the global % reflects tested UI code.
      include: ['src/components/**', 'src/hooks/**'],
      exclude: ['src/tests/**', '**/*.config.js'],
      // Measure-then-floor (Phase 3 / L2): floors a few points below the measured
      // baseline (lines 74.6 / branches 63.4 / funcs 69.7 / stmts 71.6). Ratchet
      // UP over time — never down.
      thresholds: {
        lines: 70,
        functions: 64,
        branches: 58,
        statements: 67,
      },
    },
    server: {
      deps: {
        inline: [
          '@asamuzakjp/css-color',
          '@csstools/css-calc',
          '@csstools/css-color-4',
          '@csstools/css-parser-algorithms',
          '@csstools/css-tokenizer',
          '@csstools/color-helpers',
        ],
      },
    },
  },
})
