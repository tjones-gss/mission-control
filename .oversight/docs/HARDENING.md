# Oversight framework — hardening program

This document breaks the `.oversight/` system into **tracks A–H** so multiple people or agent sessions can work in parallel without one giant context. Each track has checkboxes and exit criteria.

## Global definition of done

After any substantive change to the framework:

- [ ] `python .oversight/scripts/establish_baselines.py` completes without traceback (optional: refresh baselines when ratchet semantics change).
- [ ] `python .oversight/scripts/check_gate_policy.py` exits **0** (manifest `gate_policy` aligns with the scorer).
- [ ] `python .oversight/scripts/run_selftest.py` exits **0** (YAML golden cases + aggregate score table tests).
- [ ] `python .oversight/scripts/run_parallel.py --dry-run` prints the active job plan.
- [ ] `python .oversight/scripts/run_eval.py --shared fast --dry-run` lists resolved commands without executing.
- [ ] On a clean tree with deps installed: `python .oversight/scripts/run_parallel.py --layer fast` completes (or document why CI skips it).

Optional on developer machines:

- [ ] `python .oversight/scripts/run_parallel.py --layer medium` when you need cross-checks.

---

## Session template (copy per chat / PR)

**Session ID / date:**  
**Track(s):** (e.g. B — evaluators)  
**Goal (one sentence):**  

**Files touched:**

- 

**Commands run:**

```bash

```

**Exit criteria (this session):**

- [ ] 

**Risks / follow-ups:**

- 

---

## Track A — Foundation (`_yaml.py`, `_common.py`, `manifest.yaml`)

**Risks:** Parser edge cases; baseline JSON shape; gate policy drift from scorer.

**Checkboxes:**

- [ ] Run `python .oversight/scripts/run_selftest.py` (includes YAML golden snippets).
- [ ] Run `python .oversight/scripts/check_gate_policy.py` after editing `manifest.yaml` or `aggregate_score.py`.
- [ ] Document unsupported YAML features in `_yaml.py` module docstring (already present — extend if you add syntax).

**Key files:** [.oversight/scripts/_yaml.py](../scripts/_yaml.py), [.oversight/scripts/_common.py](../scripts/_common.py), [.oversight/manifest.yaml](../manifest.yaml)

---

## Track B — Evaluators (`eval_*.py`, `_secretscan.mjs`)

**Risks:** Regex false positives/negatives; subprocess failures; coverage reporter missing.

**Checkboxes:**

- [ ] `eval_coverage.py`: optional devDependency `@vitest/coverage-v8` documented in script header and [README.md](../README.md) troubleshooting.
- [ ] `eval_security.py` / `_secretscan.mjs`: large/binary paths skipped; `git` unavailable handled gracefully.
- [ ] Static evaluators (code_health, test_markers, route_parity, e2e_flake): run on repo without traceback.

**Key files:** [.oversight/scripts/eval_*.py](../scripts/), [.oversight/scripts/_secretscan.mjs](../scripts/_secretscan.mjs)

---

## Track C — Scoring (`aggregate_score.py`, baselines)

**Risks:** Formula drift; missing-signal semantics; hard gate dominance.

**Checkboxes:**

- [ ] `python .oversight/scripts/test_aggregate_score.py` (or `run_selftest.py`) passes.
- [ ] Any new signal used in `score_verdict` has a matching `gate_policy` entry (enforced by `check_gate_policy.py`).

**Key files:** [.oversight/scripts/aggregate_score.py](../scripts/aggregate_score.py), [.oversight/state/baselines.json](../state/baselines.json)

---

## Track D — Orchestration (`run_eval.py`, `run_job_loop.py`)

**Risks:** Shell-injected `change_command`; wrong `cwd` (not a git checkout); eval JSON fold picks wrong file.

**Checkboxes:**

- [ ] `--cwd` must point at a directory containing a `.git` file or directory (validated at startup).
- [ ] Document that `change_command` is passed to the shell — only trusted commands (see README security note).
- [ ] Evaluator timeout: 1800s for full loops; adjust in one place if needed.

**Key files:** [.oversight/scripts/run_eval.py](../scripts/run_eval.py), [.oversight/scripts/run_job_loop.py](../scripts/run_job_loop.py)

---

## Track E — Parallelism (`_worktree.py`, `run_parallel.py`)

**Risks:** Stale worktrees; scope overlap between jobs; junction failure on Windows.

**Checkboxes:**

- [ ] Overlapping `editable_paths` between active jobs: runner warns; use `--force-overlap` only if intentional.
- [ ] `python .oversight/scripts/run_parallel.py --cleanup` removes oversight worktrees when finished.
- [ ] Document failure modes: branch exists, worktree exists, link fails (in this file or README “Parallel execution”).

**Key files:** [.oversight/scripts/_worktree.py](../scripts/_worktree.py), [.oversight/scripts/run_parallel.py](../scripts/run_parallel.py)

---

## Track F — Safety + promotion (`check_*.py`, `promote_candidate.py`)

**Risks:** Promoting unrelated changes; wrong branch.

**Checkboxes:**

- [ ] `check_forbidden_paths.py` / `check_scope.py` stay aligned with `manifest.yaml` forbidden list.
- [ ] `promote_candidate.py` runs `git` from repo root; refuses detached HEAD / ambiguous branch when possible.

**Key files:** [.oversight/scripts/check_*.py](../scripts/), [.oversight/scripts/promote_candidate.py](../scripts/promote_candidate.py)

---

## Track G — Config surface (`domains/*.yaml`, `jobs/**/*.yaml`)

**Risks:** Invalid commands; duplicate job IDs; schema drift.

**Checkboxes:**

- [ ] `python .oversight/scripts/check_yaml_parse.py` passes on all YAML under `.oversight/`.
- [ ] Active jobs have unique `id` and non-overlapping `editable_paths` (see Track E).

**Key files:** [.oversight/domains/](../domains/), [.oversight/jobs/](../jobs/)

---

## Track H — Documentation + CI

**Risks:** Contributors do not discover the harness; CI does not catch syntax errors.

**Checkboxes:**

- [ ] [.oversight/README.md](../README.md) links to this document.
- [ ] [.oversight/AGENT_START.md](../AGENT_START.md) points to HARDENING for multi-session work.
- [ ] CI job `oversight-smoke` (if present): Python compileall + `check_gate_policy` + `run_selftest`.

**Key files:** [.github/workflows/ci.yml](../../.github/workflows/ci.yml)

---

## Suggested session order (single maintainer)

1. A + G — parser + YAML inventory.
2. B — evaluators (largest surface).
3. C + D — score + loop.
4. E + F — worktrees + promotion safety.
5. H — docs + CI.

Parallel teams: **B, F, G** can run concurrently; **D and E** should coordinate on `run_job_loop.py` / `run_parallel.py` edits.
