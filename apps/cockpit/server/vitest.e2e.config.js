import { defineConfig } from 'vitest/config'

// GATED e2e lane — kept OFF the fast unit lane (vitest.config.js) on purpose.
// These specs spawn a real (stub) `claude` subprocess and drive a Fleet through a
// full verify→reject→retry→synthesis cycle, so they are slower and run as their
// own CI job. Isolation is structural: the unit lane includes only tests/**, this
// lane lives under the sibling e2e-server/** and is the ONLY config that includes
// it — so the 884+ unit suite stays fast and untouched.
//
// Additionally env-flagged: without RUN_E2E=1 the include set is empty (a clean
// no-op), so an accidental run can't spawn subprocesses. The CI e2e job sets it.
//
// Run locally:  RUN_E2E=1 npx vitest run --config vitest.e2e.config.js
const gated = process.env.RUN_E2E === '1'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: gated ? ['e2e-server/**/*.e2e.test.js'] : [],
    // Without RUN_E2E=1 the include set is empty; exit 0 rather than erroring so a
    // bare `npm run test:e2e` (or a misconfigured invocation) is a clean no-op.
    passWithNoTests: true,
    // No watcher runs in this lane, so the per-child session-ack (which resolves
    // off SSE new_session events) would otherwise burn its full 15s as a dangling
    // timer. A child still settles on CLI exit independent of the ack, so
    // collapsing the ack to a few ms only trims dead time — it changes no outcome.
    env: { OVERSIGHT_FLEET_ACK_TIMEOUT_MS: '150' },
    // A full real-subprocess Fleet cycle (worker→verifier→retry→verifier→synth)
    // needs more headroom than the unit default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
