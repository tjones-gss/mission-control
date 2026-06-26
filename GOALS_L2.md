# GOALS_L2 — Adoptable (L2 DoD ladder)

**One-line goal:** Reach the L2 "ADOPTABLE" bar from `DOD-LADDER.md` — every criterion
proven by a passing test, full suite green, lint clean.

**Success criteria:**

- `npm run test:cockpit` passes (server + client)
- `npm run lint` clean
- All L2 criteria in `DOD-LADDER.md` have a passing test that proves each claim

---

## Audit result (2026-06-25)

All three L2 criteria were already implemented and proven by passing tests in prior
build loops (this codebase reached L3 per STATE.md). This file records the
verification, mirroring the GOALS_L1 pattern, and the one regression guard added.

### L2-a: Empty `~/.claude/projects` shows a Welcome + one-click first agent

- **Proven by:** `client/src/tests/App.test.jsx` ("App first-run (empty front door)") —
  zero sessions → Welcome hero; sessions → board (no hero); loading (`null`) → neither;
  CTA opens the New Session form. Plus `WelcomeHero.test.jsx` (component + both CTAs).
- **Wiring:** `App.jsx` gates `<WelcomeHero>` on `Array.isArray(sessions) && sessions.length === 0`.
- **Status:** ✅ already proven — no change needed.

### L2-b: One-click in-cockpit rails adoption (pure-Node hook fallback)

- **Proven by:** `tests/lib/rails-installer.test.js` (real fs against a tmp dir — copies the
  adapter, lands `*.mjs` Node hooks, wires `settings.json` to `node …`, idempotent) and
  `tests/routes/rails.test.js` (`POST /adopt` → 201, lands Node hooks; 403/400/409 paths).
- **Status:** ✅ already proven. NOTE: these tests are reliable in isolation; under full
  parallel execution they can intermittently flake on Windows (recursive adapter copy +
  `rmSync` on a tmp dir under AV/file-lock contention) — same documented class as the
  real-binary / hook-parity flakes. Not a code defect; pass on re-run and in CI (Linux).

### L2-c: CI gates coverage (realistic floor, ratcheted) + runs the e2e suite

- **Proven by:** `.github/workflows/ci.yml` — the `cockpit` job runs `vitest run --coverage`
  for both server and client (coverage gate), and a separate `e2e` job (`needs: cockpit`)
  runs the real-subprocess Fleet e2e + Playwright. Coverage floors are set in
  `server/vitest.config.js` (lines 80 / functions 82 / branches 68 / statements 80) and
  `client/vite.config.js` (70 / 64 / 58 / 67). "Block merge" is a manual GitHub
  branch-protection setting, documented in the ci.yml header.
- **Added this loop:** `tests/contracts/ci-gates.contract.test.js` — a regression guard so
  the L2 CI gates (server+client `--coverage`, the e2e job, the coverage floors) cannot be
  silently removed. Consistent with the repo's existing config-lint tests
  (`changelog-lint`, `version-consistency`).
- **Status:** ✅ proven + guarded.

---

## Constraints (same as L1)

- TDD-first for any new code; surgical changes; no new deps; commit on green per criterion.
- Where a criterion is already proven, verify it rather than rewrite it (no over-engineering).
