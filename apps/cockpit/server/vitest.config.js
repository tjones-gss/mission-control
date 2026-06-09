import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'text'],
      // Scope coverage to the load-bearing server modules. e2e-only helpers, the
      // test tree, and config files are excluded so the global % reflects unit-
      // tested code, not untested scaffolding.
      include: ['routes/**', 'lib/**', 'utils/**', 'parsers/**'],
      exclude: ['tests/**', 'e2e-server/**', '**/*.config.js'],
      // Measure-then-floor (Phase 3 / L2): floors set a few points below the
      // measured baseline (lines 84.7 / branches 73.2 / funcs 87.3 / stmts 83.6),
      // so CI reds on a real coverage regression without flaking on noise. Ratchet
      // these UP over time — never down.
      thresholds: {
        lines: 80,
        functions: 82,
        branches: 68,
        statements: 80,
      },
    },
  },
})
