# `.oversight/` — autonomous improvement framework

This folder is a self-contained, repo-local system for making **small, reversible,
evaluator-gated changes** to the Oversight codebase. It can be driven by a human,
a coding agent, or a scheduled job.

It is **not** a CI system. It's a sandbox for iterative improvement loops that
are paranoid about regressions.

### Security note

Commands in job YAML and `run()` helpers are executed with **`shell=True`**
(Python `subprocess`). Only run the improvement loop with **trusted**
`change_command` strings (your own scripts or reviewed one-liners). Do not pass
untrusted input into those fields.

### Hardening and self-checks

Multi-session hardening checklist (tracks A–H), parallel work boundaries, and
global “definition of done”:

- [.oversight/docs/HARDENING.md](docs/HARDENING.md)

Quick verification (no npm required):

```bash
python .oversight/scripts/check_gate_policy.py   # manifest gate_policy vs scorer
python .oversight/scripts/run_selftest.py        # YAML goldens + score table tests
python .oversight/scripts/run_eval.py --shared fast --dry-run
```

---

## Why it exists

- Oversight is a dual-stack (React + Express) codebase with unit tests, e2e
  tests, lint, and a build step. Those artifacts are the trust surface.
- A "safe" change is one that **passes the evaluator battery that already
  exists in the repo**, touches only paths declared in scope, and can be
  reverted with a single `git checkout -- .`.
- This framework makes that discipline the default.

---

## What was detected

See `manifest.yaml` for the full picture.

| Thing               | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| Kind                | `fullstack-monorepo` (not a real monorepo tool — plain npm)  |
| Node (CI)           | `22` (matrix also tests `20`)                                |
| Frontend            | React 18 + Vite + Tailwind + Vitest (jsdom)                  |
| Backend             | Express 4 + chokidar + node-pty + pino, Vitest (node)        |
| E2E                 | Playwright (chromium only), dev servers auto-started         |
| Lint                | Prettier `--check`                                           |
| CI                  | GitHub Actions, 3 jobs: `lint` → `test` → `e2e`              |
| Docker              | `Dockerfile` + `docker-compose.yml`                          |

---

## Domains

Each domain lives in `domains/<name>.yaml` and declares its own editable paths,
protected paths, evaluators, and success criteria. We created these domains:

- **frontend** — `client/src/**`
- **backend** — `server/**` (routes, lib, parsers, middleware, intelligence, utils)
- **e2e** — `e2e/**`, `playwright.config.js`
- **docs** — `README.md`, `docs/**/*.md`
- **infra** — Dockerfile, docker-compose, `.github/workflows/**`, `.husky/**`
- **scripts** — `scripts/**`
- **dependencies** — package.json + lockfiles (the ONLY domain allowed to touch lockfiles)

---

## How a job works

A **job** is a YAML file in `jobs/` describing one bounded improvement. Fields:

```yaml
id: "001-format-drift"
title: "..."
domain: infra
editable_paths: [...]
evaluators:
  lint: "npm run lint"
  test_server: "npm run test:server"
goal: |
  ...
success_criteria:
  - "..."
rollback_policy: |
  ...
```

Jobs live in one of three buckets:

| Bucket      | Meaning                                                             |
| ----------- | ------------------------------------------------------------------- |
| `templates/`| Copy-me starters. Never run directly.                               |
| `backlog/`  | Ready-to-run but waiting. This is where concrete starter jobs live. |
| `active/`   | Currently being worked on by a loop.                                |

---

## How evaluators work

Evaluators come in three layers (see `manifest.yaml > shared_validation`):

| Layer  | Purpose                          | Example                                 |
| ------ | -------------------------------- | --------------------------------------- |
| fast   | Syntax/parse + py evals — < 5s   | `node --check`, `eval_code_health.py`   |
| medium | Unit tests + build + security    | `npm run test:server`, `vite build`     |
| full   | E2E + coverage                   | `npm run test:e2e`, `eval_coverage.py`  |

Each domain declares a fast/medium split in its YAML. Jobs inherit their
domain's evaluators and may add job-specific ones under `evaluators:`.

### The 15 evaluator families

Six families, 15 concrete evaluators. Each emits a `signals` block consumed
by the scorer. Python evaluators write their payload to
`.oversight/state/scores/eval_<name>__<timestamp>.json`; the loop folds those
signals into the verdict automatically.

| Family          | Evaluator                      | Signals produced                                                        |
| --------------- | ------------------------------ | ----------------------------------------------------------------------- |
| Correctness     | `npm run test:server`          | `vitest_failures_total`                                                 |
| Correctness     | `npm run test:client`          | `vitest_failures_total`                                                 |
| Correctness     | `node --check <file>`          | `exit_code`                                                             |
| Correctness     | `cd client && npx vite build`  | `exit_code`                                                             |
| Test health     | `eval_test_markers.py`         | `test_only_count`, `test_skip_count`, `test_fixme_count`                |
| Test health     | `eval_coverage.py`             | `coverage_line_pct`, `coverage_branch_pct`, `coverage_function_pct`     |
| Code health     | `eval_code_health.py`          | `console_leak_count`, `todo_density_kloc`, `loc_outlier_count`, `dangerous_api_count` |
| Style           | `npm run lint`                 | `prettier_failures_total`                                               |
| Security        | `eval_security.py` (+ bridge)  | `secret_findings`, `env_leak_count`, `dangerous_api_count`              |
| API contract    | `eval_route_parity.py`         | `route_total`, `covered_routes`, `uncovered_routes`, `route_coverage_pct` |
| E2E stability   | `eval_e2e_flake.py`            | `e2e_waitForTimeout_count`, `e2e_setTimeout_count`, `e2e_flake_signals` |
| E2E stability   | `npm run test:e2e`             | `playwright_failures_total`                                             |
| Docs            | `check_docs_sanity.py`         | `exit_code`                                                             |

### Gate policy

Every signal is tagged in `manifest.yaml > gate_policy` as **hard**, **soft**,
or **advisory**. The loop enforces these as follows:

- **hard**  — any *new* hard failure in the candidate triggers an automatic
  revert, regardless of whether the numeric score improved.
- **soft**  — contributes to the numeric score; a regression can be outweighed
  by a bigger improvement elsewhere (aggregation wins).
- **advisory** — printed in attempt records, never blocks.

Hard gates today: `secret_findings`, `env_leak_count`, `test_only_count`,
`dangerous_api_count` (above baseline), `vitest_failures_total`,
`playwright_failures_total`.

Soft (ratchet) gates today: `console_leak_count`, `test_skip_count`,
`uncovered_routes`, `e2e_flake_signals`, `coverage_line_pct`,
`coverage_branch_pct`, `prettier_failures_total`.

### The score formula (lower is better)

```
score =  10000 * hard_gate_failures
      +   1000 * soft_gate_regressions
      +    100 * (vitest_failures_total + playwright_failures_total)
      +     50 * test_only_count
      +  weight * max(0, signal - baseline)     # regression penalties
      -  weight * max(0, baseline - signal)     # improvement rewards (symmetric)
      +      2 * todo_density_kloc
      +      1 * prettier_failures_total
      -     20 * coverage_line_pct
      -     10 * coverage_branch_pct
```

Regression and reward terms are symmetric for every ratchet signal that is
actually *present* in the candidate's signals. Absence of a signal is never
treated as a 100% improvement.

### Baselines

`.oversight/state/baselines.json` captures the current values of every ratchet
signal. Run `python .oversight/scripts/establish_baselines.py` to refresh it
before kicking off a wave. Without a baseline, ratchet signals default to 0,
which would cause the scorer to reward any non-zero signal as "worse".

---

## How looping works

`run_job_loop.py` orchestrates a single job's lifecycle:

1. Load the job YAML and its domain.
2. Verify the working tree is clean (or `--allow-dirty`).
3. **Baseline eval** — record pre-change signals, score, hard-gate count.
4. If `--oneshot`, stop here.
5. Otherwise, up to `budget.attempts` times:
   1. Snapshot pre-change file set (so artifacts from baseline evals don't
      get mis-attributed to the candidate).
   2. Run the change command (`--command`, else the job's `change_command:`).
   3. Check any *new* files touched against `forbidden_paths` → revert + log.
   4. Re-run evaluators.
   5. If **new hard gate failure** appeared → revert + log (hard-gate-regressed).
   6. Else if score improved → **keep**, log accept.
   7. Else if score unchanged *and* we already accepted earlier → keep (idempotent).
   8. Else revert, log.
6. Print summary.

Every attempt writes a JSON record and a `.diff` snapshot into
`.oversight/logs/attempts/<job_id>/`.

### Parallel execution

`run_parallel.py` runs every job in `jobs/active/` concurrently, each in its
own **git worktree**. One worktree = one branch = one isolated working tree.

Because each worktree is a full checkout, a failure or revert in one job can
never corrupt another. The orchestrator:

1. Reads every job under `jobs/active/`.
2. Creates branch `oversight/<job-id>` and worktree `.worktrees/oversight-<job-id>`.
3. **Syncs the framework files** (`.oversight/` + `.prettierignore`) from the
   main tree into the worktree, so even uncommitted framework changes are in
   effect during the run.
4. **Links `node_modules`** (root + `client/` + `server/`) via junctions on
   Windows / symlinks on Unix, so workers don't each run `npm ci`.
5. Submits each worktree to a `ProcessPoolExecutor` (bounded by
   `manifest.yaml > parallel.max_workers`, default 4).
6. Waits for completion, collects each job's baseline and final score, and
   writes a leaderboard to `.oversight/state/leaderboard.json` plus a raw
   per-worker log under `.oversight/logs/parallel/`.

Tuning (all under `manifest.yaml > parallel`):

| Key                 | Default | Meaning                                               |
| ------------------- | ------- | ----------------------------------------------------- |
| `max_workers`       | 4       | Upper bound on concurrent worktrees.                  |
| `stagger_seconds`   | 2       | Sleep between worker startups (smooths npm cache hits). |
| `link_node_modules` | true    | If false, skip junction linking; workers must self-install. |

Jobs may set `parallelizable: false` to opt out of junction linking (e.g.
dependency-maintenance jobs that need their own fresh install).

Usage:

```bash
python .oversight/scripts/run_parallel.py --layer fast              # the default
python .oversight/scripts/run_parallel.py --job 003 --layer medium  # one job, heavier evals
python .oversight/scripts/run_parallel.py --dry-run                 # print the plan
python .oversight/scripts/run_parallel.py --cleanup                 # remove all oversight worktrees
python .oversight/scripts/run_parallel.py --force-overlap           # unsafe: run despite editable_paths collision
```

If two active jobs declare the same `editable_paths` entry, the runner **aborts**
unless you pass `--force-overlap` (see `HARDENING.md`).

**Promotion** to a mergeable branch is a separate, manual step:

```bash
python .oversight/scripts/promote_candidate.py --job <job-id>
```

That creates an `oversight/<job-id>` branch (or reuses the existing worktree
branch) and commits the accepted diff with an `Improvement-Loop: ditto`
trailer. It never pushes.

---

## Quick start

```bash
python .oversight/scripts/bootstrap_status.py              # what's here?
python .oversight/scripts/discover_domains.py              # are domains wired to reality?
python .oversight/scripts/list_jobs.py                     # what can I run?
python .oversight/scripts/run_eval.py --domain backend --layer fast

python .oversight/scripts/establish_baselines.py           # snapshot current ratchet values
python .oversight/scripts/run_parallel.py --layer fast     # run every active job concurrently

python .oversight/scripts/run_job_loop.py \
    --job .oversight/jobs/backlog/001-format-drift.yaml --oneshot
```

### First wave results (2026-04-17)

The first real wave of five jobs, run in parallel on the `fast` layer:

| Job                           | Before  | After   | Verdict | Signal touched                                   |
| ----------------------------- | ------- | ------- | ------- | ------------------------------------------------ |
| `003-console-leak`            | 0.0     | -5.0    | kept    | `console_leak_count` 1 -> 0 in `server/watcher.js` |
| `004-e2e-flake-layout`        | 0.0     | -1.0    | kept    | `e2e_waitForTimeout_count` 4 -> 3 in `e2e/layout.spec.js` |
| `005-docs-screenshot-parity`  | 0.0     | 0.0     | audit   | no drift detected                                |
| `006-route-parity-baseline`   | 0.0     | 0.0     | audit   | baseline written for `uncovered_routes`          |
| `007-coverage-baseline`       | 10000.0 | 10000.0 | audit   | `ok:false` (flags missing `@vitest/coverage-v8`) |

The coverage job intentionally surfaces as a hard-gate failure (10000.0):
it is the system detecting that the v8 coverage reporter is not installed,
which is the *correct* behaviour for a ratchet that wants coverage data.
Installing `@vitest/coverage-v8` and re-running will produce real
percentages and a real score.

---

## Adding a new domain

1. Copy any file in `domains/` and edit:
   - `name`, `editable_paths`, `protected_paths`
   - at least one `local_evaluators.<name>: "<command>"`
2. Add the new domain to `manifest.yaml > domain_registry`.
3. Run `python .oversight/scripts/discover_domains.py` to confirm the globs match.
4. Write a template or backlog job that uses it.

## Adding a new job

1. Copy a template from `jobs/templates/` to `jobs/backlog/<id>.yaml`.
2. Fill in `id`, `title`, `domain`, `editable_paths`, `goal`.
3. Either override `evaluators:` in the job or inherit from the domain.
4. `python .oversight/scripts/list_jobs.py` to confirm it shows up.

---

## Porting this framework to another repo

The framework is intentionally lightweight. To adapt it to a new repo:

1. Copy the entire `.oversight/` folder across.
2. Edit `manifest.yaml`:
   - `repo.name`, `repo.kind`, `stack.*`
   - `shared_validation.*` — point to the new repo's test/build/lint commands.
   - `forbidden_paths` — adjust for the new repo's generated folders.
3. Delete every file in `domains/` and recreate one per real directory.
4. Delete every file in `jobs/backlog/` and write a first concrete job.
5. Run `bootstrap_status.py` → `discover_domains.py` → `run_eval.py --shared fast`
   to verify everything parses and the evaluators actually work.

Nothing in the scripts is Oversight-specific except the baked-in heuristics
for parsing `vitest` / `playwright` / `prettier` output. If you're on a
different test framework, extend `_common.py > count_*_failures`.

---

## Files in this folder

```
.oversight/
├── README.md                 ← this file
├── AGENT_START.md            ← concise handoff for future agents
├── docs/
│   └── HARDENING.md          ← multi-session hardening checklist (tracks A–H)
├── manifest.yaml             ← repo + policy + domain registry + gate policy + parallel config
├── domains/                  ← one YAML per domain
│   ├── frontend.yaml
│   ├── backend.yaml
│   ├── e2e.yaml
│   ├── docs.yaml
│   ├── infra.yaml
│   ├── scripts.yaml
│   └── dependencies.yaml
├── jobs/
│   ├── templates/            ← copy-me starters (8 templates)
│   ├── backlog/              ← concrete, ready-to-run
│   └── active/               ← currently-being-worked by run_parallel.py
├── scripts/                  ← Python orchestration (zero external deps, Py 3.10+)
│   ├── _yaml.py              ← tiny YAML subset parser (incl. block scalars)
│   ├── _common.py            ← shared helpers + signal extraction + baselines
│   ├── _worktree.py          ← git worktree create/destroy + node_modules linking
│   ├── bootstrap_status.py
│   ├── discover_domains.py
│   ├── list_jobs.py
│   ├── run_eval.py
│   ├── run_job_loop.py       ← single-job change/evaluate/accept-or-revert loop
│   ├── run_parallel.py       ← wave runner — one worktree per job
│   ├── aggregate_score.py    ← score_v2 formula + verdict emission
│   ├── establish_baselines.py
│   ├── eval_code_health.py   ← console/TODO/LOC/dangerous-API scan
│   ├── eval_test_markers.py  ← .only / .skip / .fixme counter
│   ├── eval_route_parity.py  ← Express routes vs test coverage
│   ├── eval_e2e_flake.py     ← Playwright flake-signal counter
│   ├── eval_coverage.py      ← vitest --coverage → coverage-summary.json
│   ├── eval_security.py      ← secret + env + dangerous-API scanner
│   ├── _secretscan.mjs       ← Node bridge to server/utils/secretScanner.js
│   ├── fix_watcher_console.py     ← deterministic fixer for job 003
│   ├── fix_e2e_layout_waits.py    ← deterministic fixer for job 004
│   ├── check_scope.py
│   ├── check_forbidden_paths.py
│   ├── check_node_syntax.py
│   ├── check_yaml_parse.py
│   ├── check_docs_sanity.py
│   ├── check_package_manifests.py
│   ├── check_gate_policy.py  ← manifest gate_policy vs aggregate_score
│   ├── run_selftest.py       ← YAML goldens + unittest for scoring
│   ├── test_aggregate_score.py
│   ├── summarize_attempt.py
│   └── promote_candidate.py
├── state/
│   ├── baselines.json        ← current ratchet values (source of truth for scoring)
│   ├── leaderboard.json      ← output of the most recent `run_parallel.py`
│   └── scores/               ← per-run eval JSONs (eval_<name>__<ts>.json)
└── logs/
    ├── parallel/             ← raw per-worker logs from run_parallel.py
    └── attempts/<job_id>/    ← per-attempt JSON + diff snapshots (run_job_loop.py)
```

All Python scripts target Python 3.10+ and have **no third-party dependencies**.
