# AGENT_START — hand-off for future automation

Short, dense, actionable. Read `README.md` for the full tour.

## What this repo is

Fullstack Node.js monorepo: React 18 + Vite client (`client/`), Express 4 +
chokidar + node-pty server (`server/`), Playwright e2e (`e2e/`), Prettier lint
(`npm run lint`), GitHub Actions CI (`lint → test → e2e`).

Node 22 locally; CI also tests on Node 20.

## Domains registered

`frontend`, `backend`, `e2e`, `docs`, `infra`, `scripts`, `dependencies`.

Each has its own YAML in `.oversight/domains/`. Inspect with:

```bash
python .oversight/scripts/discover_domains.py
```

## Evaluator families (15 evaluators, 6 families)

| Family        | Evaluators (all repo-verified)                                                          |
| ------------- | --------------------------------------------------------------------------------------- |
| Correctness   | `npm run test:server`, `npm run test:client`, `node --check`, `vite build`              |
| Test health   | `eval_test_markers.py`, `eval_coverage.py`                                              |
| Code health   | `eval_code_health.py`                                                                   |
| Style         | `npm run lint` (Prettier)                                                               |
| Security      | `eval_security.py` + `_secretscan.mjs`                                                  |
| API contract  | `eval_route_parity.py`                                                                  |
| E2E stability | `eval_e2e_flake.py`, `npm run test:e2e`                                                 |
| Docs          | `check_docs_sanity.py`                                                                  |

Fast layer: prettier + node --check + every Python evaluator.
Medium layer: + `npm run test:*` + `vite build`.
Full layer: + Playwright + `vitest --coverage`.

## Gate policy (manifest.yaml > gate_policy)

- **hard**: `secret_findings`, `env_leak_count`, `test_only_count`,
  `dangerous_api_count`, `vitest_failures_total`, `playwright_failures_total`
  — any *new* hard failure reverts the candidate, regardless of numeric score.
- **soft (ratchet)**: `console_leak_count`, `test_skip_count`,
  `uncovered_routes`, `e2e_flake_signals`, `coverage_line_pct`,
  `coverage_branch_pct`, `prettier_failures_total` — contribute to the
  numeric score, symmetric (regression penalized, improvement rewarded).
- **advisory**: `todo_density_kloc`, `loc_outlier_count` — report-only.

Baselines for every ratchet live in `.oversight/state/baselines.json`.
Refresh before a wave:

```bash
python .oversight/scripts/establish_baselines.py
```

## Parallel execution

`run_parallel.py` runs every job in `jobs/active/` in its own git worktree
(branch `oversight/<job-id>`, worktree `.worktrees/oversight-<job-id>`). It
syncs `.oversight/` into each worktree, junction-links `node_modules`, and
spawns `ProcessPoolExecutor(max_workers=4)`.

Typical cycle:

```bash
python .oversight/scripts/establish_baselines.py
python .oversight/scripts/run_parallel.py --layer fast
cat .oversight/state/leaderboard.json
```

Cleanup:

```bash
python .oversight/scripts/run_parallel.py --cleanup
```

## Active jobs

| Job                              | Domain     | What it does                                       |
| -------------------------------- | ---------- | -------------------------------------------------- |
| `003-console-leak`               | backend    | Strips `console.log/debug` in `server/watcher.js`. |
| `004-e2e-flake-layout`           | e2e        | Removes `page.waitForTimeout(...)` in `e2e/layout.spec.js`. |
| `005-docs-screenshot-parity`     | docs       | Audit-only: docs vs screenshots.                   |
| `006-route-parity-baseline`      | backend    | Writes `uncovered_routes` baseline.                |
| `007-coverage-baseline`          | frontend   | Writes vitest coverage baseline. Flags missing dep. |

## First wave results (2026-04-17)

| Job                           | Before  | After   | Verdict | Signal                                           |
| ----------------------------- | ------- | ------- | ------- | ------------------------------------------------ |
| `003-console-leak`            | 0.0     | -5.0    | kept    | `console_leak_count` 1 -> 0                       |
| `004-e2e-flake-layout`        | 0.0     | -1.0    | kept    | `e2e_waitForTimeout_count` 4 -> 3                 |
| `005-docs-screenshot-parity`  | 0.0     | 0.0     | audit   | no drift                                         |
| `006-route-parity-baseline`   | 0.0     | 0.0     | audit   | baseline written                                 |
| `007-coverage-baseline`       | 10000.0 | 10000.0 | audit   | `ok:false` — `@vitest/coverage-v8` not installed |

The `10000.0` on the coverage job is the framework doing its job: a hard gate
(`eval_coverage.ok=false`) short-circuits the score. Install
`@vitest/coverage-v8` to unblock it; the other four jobs are already ratcheting.

## Backlog jobs ready to run

1. **`001-format-drift`** — `.oversight/jobs/backlog/001-format-drift.yaml`
   - 216 files flagged by Prettier. Change command is `npm run lint:fix`.
   - Low risk; all evaluators gate acceptance. Read the CRLF note below first.
2. **`002-docs-sync-baseline`** — `.oversight/jobs/backlog/002-docs-sync-baseline.yaml`
   - Establish current state of `check_docs_sanity.py`; fix anything it flags.

### CRLF drift warning for `001-format-drift`

On Windows with `core.autocrlf=true`, `prettier --check` reports ~200 failures
that are purely line-ending drift. `lint:fix` cannot actually fix them on disk
because git rewrites CRLF back on read. Run it in WSL/Linux, or set
`git config core.autocrlf false` first, then re-checkout to get LF on disk.

## Safest next command to run

Establish the current ratchet baselines, then run a parallel wave:

```bash
python .oversight/scripts/establish_baselines.py
python .oversight/scripts/run_parallel.py --layer fast
```

Inspect the outcome:

```bash
cat .oversight/state/leaderboard.json
```

If a job accepted a candidate you want to merge into main, promote it:

```bash
python .oversight/scripts/promote_candidate.py --job 003-console-leak \
    --message "chore: remove console log leak in server/watcher.js"
```

## Key assumptions (challenge these if something breaks)

- **`npm ci` is already installed** in root, `client/`, and `server/`.
  If not, run all three first — the framework does not do dependency install.
- **E2E is expensive** and only runs in the `full` layer. Fast/medium loops
  never invoke Playwright.
- **`node-pty` is a native module**. Never try to reinstall or rebuild it
  from an improvement loop.
- **Lockfiles belong to the `dependencies` domain only.** Every other job
  treats them as forbidden.
- **`@vitest/coverage-v8` is not installed.** `eval_coverage.py` returns
  `ok:false` until it is, which trips the `eval_coverage_ok` hard gate. That
  is deliberate — it ensures coverage data can't silently disappear from
  scoring. Install it and the gate clears.
- **Parallel workers share `node_modules`** via symlink/junction. Never let a
  worker run `npm install` against its own worktree; it will clobber the
  real store. Jobs that genuinely need their own install must set
  `parallelizable: false`.

## Forbidden paths (see manifest.yaml for the full list)

`node_modules/`, `dist/`, `build/`, `coverage/`, `playwright-report/`,
`test-results/`, `test_screenshots/`, `docs/screenshots/`, `client/*.png`,
`qa-*.png`, `snapshot-*.md`, `.env`, `.env.*`, `package-lock.json`,
`client/package-lock.json`, `server/package-lock.json`, `.claude/`,
`.worktrees/`, `.playwright-mcp/`, and the framework's own source files
(`.oversight/scripts/**`, `.oversight/jobs/**`, `.oversight/domains/**`,
`.oversight/manifest.yaml`). Note: `.oversight/state/**` and
`.oversight/logs/**` are **not** forbidden — evaluators need to write there.

## How to start improving safely

1. Always start from a clean working tree on `main`.
2. `python .oversight/scripts/establish_baselines.py` to refresh ratchets.
3. `python .oversight/scripts/run_parallel.py --layer fast` to run every
   active job in isolation.
4. Read `.oversight/state/leaderboard.json`. For each kept improvement,
   check out `oversight/<job-id>` (the worktree branch) and run the medium
   or full layer before promoting.
5. `promote_candidate.py` to commit; hand off the branch for human review.
6. Never push, never merge, never `git reset --hard` outside a worktree.
