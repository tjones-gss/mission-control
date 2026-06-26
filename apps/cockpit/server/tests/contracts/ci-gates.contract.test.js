import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { repoRoot } from '../../../../../scripts/release/version-sources.js'

// L2-c regression guard. The "CI gates coverage + runs the e2e suite" criterion is
// proven by .github/workflows/ci.yml — but a config file nothing tests can silently
// rot (someone drops `--coverage`, deletes the e2e job, or zeroes a floor and the
// gate goes hollow while CI still shows green). This lint asserts the load-bearing
// L2 gates stay in the workflow + configs, mirroring the repo's other config-lint
// tests (changelog-lint, version-consistency). It checks presence, not exact prose.
const ROOT = repoRoot()
const CI_YML = path.join(ROOT, '.github', 'workflows', 'ci.yml')

function ci() {
  return readFileSync(CI_YML, 'utf-8')
}

describe('CI L2 gates (ci.yml) — coverage + e2e cannot silently regress', () => {
  it('runs the server suite WITH the coverage gate', () => {
    const text = ci()
    // The cockpit job must run server tests with --coverage (the v8 threshold gate).
    expect(text).toMatch(/working-directory:\s*apps\/cockpit\/server/)
    expect(text).toMatch(/vitest run --coverage/)
  })

  it('runs the client suite WITH the coverage gate', () => {
    const text = ci()
    expect(text).toMatch(/working-directory:\s*apps\/cockpit\/client/)
    // Both server and client steps use `vitest run --coverage`; require at least two.
    const hits = text.match(/vitest run --coverage/g) || []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })

  it('has a gated e2e job that depends on cockpit and runs Playwright', () => {
    const text = ci()
    expect(text).toMatch(/^\s{2}e2e:/m)
    expect(text).toMatch(/needs:\s*cockpit/)
    expect(text).toMatch(/playwright test/)
    // The real-subprocess Fleet e2e (verify→reject lane) also runs in this job.
    expect(text).toMatch(/vitest\.e2e\.config\.js/)
  })

  it('keeps non-zero coverage floors configured for both suites', () => {
    const server = readFileSync(path.join(ROOT, 'apps/cockpit/server/vitest.config.js'), 'utf-8')
    const client = readFileSync(path.join(ROOT, 'apps/cockpit/client/vite.config.js'), 'utf-8')
    for (const cfg of [server, client]) {
      expect(cfg).toMatch(/thresholds\s*:/)
      // Every declared floor must be a positive number — a zeroed floor is a hollow gate.
      const floors = [...cfg.matchAll(/(?:lines|functions|branches|statements)\s*:\s*(\d+)/g)].map(
        (m) => Number(m[1]),
      )
      expect(floors.length).toBeGreaterThanOrEqual(4)
      for (const f of floors) expect(f).toBeGreaterThan(0)
    }
  })
})
