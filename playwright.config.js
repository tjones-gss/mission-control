import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local runs pick up one retry to absorb transient socket hiccups
  // (ECONNRESET / socket hang up) from the single-threaded dev server
  // when the full 78-test suite is running under 2 workers. CI keeps
  // its higher budget of 2. A genuinely failing test still fails on
  // both attempts; only true infra flake is hidden by retries: 1.
  retries: process.env.CI ? 2 : 1,
  // Cap to 2 workers locally too: the dashboard's first-paint fires
  // ~6 useApi calls in parallel against a single-threaded Node server,
  // and 4+ headless browsers all hammering it at once produces head-of-
  // line blocking that exceeds even the bumped 15s expect timeout.
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  // The dashboard mounts ~6 useApi calls on first paint (sessions,
  // skills, workflows, teams, history-stats, plans). Node serializes
  // them and /api/sessions in particular can take >1s when there are
  // 60+ session JSONLs to scan. The default 5s expect + 30s test
  // timeouts were too tight under that load, especially with parallel
  // workers all hitting the same backend at once.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: 'cd server && npm run dev',
      // Probe /api/health (returns 200) instead of root (returns 404).
      // Playwright's reuseExistingServer probe needs a 2xx/3xx response
      // to consider the server ready; root returning 404 made it think
      // the server wasn't up and try to spawn its own → EADDRINUSE.
      url: 'http://localhost:3001/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      // Disable the per-IP rate limit under e2e. The e2e suite fires
      // thousands of requests in a few minutes (API CRUD tests plus
      // the dashboard's 6+ concurrent useApi calls per test) and the
      // dev-default 2000/15min cap starts returning 429 ~halfway
      // through the suite. OVERSIGHT_RATE_LIMIT=0 is the documented
      // opt-out in middleware/security.js.
      env: { OVERSIGHT_RATE_LIMIT: '0' },
    },
    {
      command: 'cd client && npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
})
