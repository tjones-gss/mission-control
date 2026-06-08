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

## Track S — Runtime security hardening (Phase 1)

This track is the cockpit **server runtime** security posture, not the eval framework.
It records the Phase-1 hardening that closed the council HIGH gaps around how the
cockpit spawns Claude and reads `~/.claude` state. The rails remain **best-effort
accident-prevention, not a sandbox** — the real control for destructive operations
is still OS-level sandboxing (per the project guide). These changes shrink the
accidental-foot-gun surface; they do not make the cockpit adversary-proof.

**Risks:** Shell-injection via spawned Claude CLI on Windows; an over-permissive
default front-door spawn; an LLM in a deterministic approval-write path; a parse
failure silently misreporting "no guardrails."

**Checkboxes:**

- [x] **1a — Windows `.cmd`/`.ps1` command-injection closed.** `claude-cli.js`
      `buildSpawn()` spawns with `shell:false` **always**. A `.cmd`/`.bat` bin is invoked
      via `cmd.exe /d /s /c <bin> <args…>` and a `.ps1` via
      `powershell.exe -NoProfile -NonInteractive -File <bin> <args…>`, with the prompt /
      `--name` / PRD/spec fields passed as **discrete literal argv** — never spliced into a
      command line a shell re-parses. This removes the `shell:true`+raw-args path where
      metacharacters (`; & | > $()` backticks `%VAR%`) in user fields became host command
      execution (CVE-2024-27980 surface). `lib/claude-bin.js` `isShellScript()` is the
      `.cmd/.bat/.ps1` discriminator; a resolved `.exe` is spawned directly (always safe).
- [x] **1b — Front-door PTY no longer defaults to `--dangerously-skip-permissions`.**
      `pty-session.js` `resolvePermissionArgs()` is now default-DENY: an explicit valid
      `permissionMode` is honored; otherwise the new interactive session runs **guarded**
      (`--permission-mode acceptEdits`) and only escalates to `--dangerously-skip-permissions`
      when the operator has a **persisted per-cwd trust grant** in `lib/trust-store.js`
      (default-deny: unknown cwd, missing/corrupt store, or any read failure all resolve to
      "not trusted"; Windows paths case-folded so `C:\Foo` and `c:\foo\` are one entry).
      Honest gap: **there is no UI/route to GRANT trust yet** — `trustCwd()` exists but is
      unreachable from the dashboard, so in practice the front door currently runs guarded.
- [x] **1c — LLM removed from the harness-approval trust path.** `fleet-runner.js`
      `decideFleetEscalation()` (source `'harness'`) calls `runHarnessApprove()`
      (`parsers/harness.js`) as a **direct `python` child_process subprocess** — no Claude
      session in the deterministic approval-write path. The child cwd is whitelisted against
      `getKnownHarnessRoots()` (`isKnownHarnessRoot`) before any shell-out, and the harness
      CLI remains the **single writer** of the decided file (the cockpit never writes it).
- [x] **1e — Parser degrade-guards: a parse failure can no longer misreport the safety
      posture as "no hooks/guardrails."** `lib/claude-format.js` draws the load-bearing
      distinction between ABSENT/EMPTY (normal — return the natural `[]`/`{}`) and
      PRESENT-BUT-UNPARSEABLE (degraded — return a distinguishable `DEGRADED_MARKER` and emit
      a deduped persistent `parser_degraded` SSE event). Every `~/.claude` reader is now
      degrade-guarded (sessions, config, hooks, session-discovery, mcp, memory, skills, plans,
      history, tasks, teams, conductor, messages), so a corrupt `settings.json` reads as
      "we could not read your guardrails," never the dangerous silent "no guardrails active."
      Client surfaces it via `ParserDegradedBanner` / a `parser_degraded` SSE channel.

**Residual gaps (honest):** the trust-GRANT UI/route is deferred (1b above); the rails are
accident-prevention, not an adversary-proof boundary; sandboxing is still the real control.

**Key files:** [claude-cli.js](../../server/claude-cli.js),
[lib/claude-bin.js](../../server/lib/claude-bin.js),
[pty-session.js](../../server/pty-session.js),
[lib/trust-store.js](../../server/lib/trust-store.js),
[fleet/fleet-runner.js](../../server/fleet/fleet-runner.js),
[parsers/harness.js](../../server/parsers/harness.js),
[lib/claude-format.js](../../server/lib/claude-format.js)

---

## Suggested session order (single maintainer)

1. A + G — parser + YAML inventory.
2. B — evaluators (largest surface).
3. C + D — score + loop.
4. E + F — worktrees + promotion safety.
5. H — docs + CI.

Parallel teams: **B, F, G** can run concurrently; **D and E** should coordinate on `run_job_loop.py` / `run_parallel.py` edits.
