"""The improvement loop (v2).

Because the "change" step requires an intelligent agent, this runner does
*not* author code itself. Instead it orchestrates the evaluate/accept/revert
cycle around whatever change the agent (or a helper command) has made.

Modes:
  1) --oneshot
       Evaluate the current working tree once and write an attempt record.
       Useful as a baseline snapshot.
  2) --command "<shell>"  (or the job's `change_command:` field)
       Run the given command (e.g. "python some_fix.py" or "npm run lint:fix")
       to produce a candidate, then evaluate. If score does not improve,
       revert (`git checkout -- .` + `git clean -fd` within editable paths).
       Repeat up to budget.attempts.

Extras in v2:
  * Scoring uses `aggregate_score.score_verdict` (signal-aware, baseline-aware,
    gate-policy-aware). Any *new* hard_gate_failure triggers a revert even if
    the numeric score improved.
  * Forbidden-path check runs after every change-command.
  * `--cwd` lets the loop run inside a git worktree for parallel execution.
  * If `--command` is omitted, falls back to the job's `change_command:` field.

Usage:
  python .oversight/scripts/run_job_loop.py --job <path-or-id> --oneshot
  python .oversight/scripts/run_job_loop.py --job <f> --command "npm run lint:fix"
  python .oversight/scripts/run_job_loop.py --job <f> --cwd .worktrees/oversight-003
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import json
import re

from _common import (  # type: ignore
    OVERSIGHT,
    REPO_ROOT,
    count_playwright_failures,
    count_prettier_failures,
    count_vitest_failures,
    git_changed_files,
    is_forbidden,
    list_jobs,
    load_baselines,
    load_domain,
    load_job,
    load_manifest,
    run,
)
from aggregate_score import score_verdict  # type: ignore
from summarize_attempt import write_attempt  # type: ignore


def _collect_eval_commands(job: dict, domain: dict | None, layer: str) -> list[tuple[str, str]]:
    cmds: list[tuple[str, str]] = []
    for k, v in (job.get("evaluators") or {}).items():
        cmds.append((f"job.{k}", v))
    if domain is not None:
        if layer in ("fast", "all"):
            for k, v in (domain.get("local_evaluators") or {}).items():
                cmds.append((f"{domain['name']}.local.{k}", v))
        if layer in ("medium", "all"):
            for k, v in (domain.get("cross_checks") or {}).items():
                cmds.append((f"{domain['name']}.cross.{k}", v))
    return cmds


_EVAL_PY_RX = re.compile(r"eval_([A-Za-z0-9_]+)\.py")


def _fold_eval_json(cmd: str, cwd: Path, signals: dict) -> None:
    """If the evaluator command was one of our `eval_*.py` scripts, pick up the
    freshest payload it wrote to `<cwd>/.oversight/state/scores/` and fold its
    `signals` map into `signals`.

    This is how we propagate richer metrics (coverage, console_leak, etc.) from
    the evaluator script into the run_job_loop's verdict.
    """
    m = _EVAL_PY_RX.search(cmd)
    if not m:
        return
    stem_prefix = f"eval_{m.group(1)}"
    scores_dir = cwd / ".oversight" / "state" / "scores"
    if not scores_dir.exists():
        return
    latest = None
    latest_mtime = -1.0
    for p in scores_dir.glob(f"{stem_prefix}__*.json"):
        try:
            mt = p.stat().st_mtime
        except OSError:
            continue
        if mt > latest_mtime:
            latest = p
            latest_mtime = mt
    if latest is None:
        return
    try:
        payload = json.loads(latest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    sigs = payload.get("signals")
    if isinstance(sigs, dict):
        for k, v in sigs.items():
            signals[k] = v
    if payload.get("ok") is False:
        signals["ok"] = False


def _run_evaluators(cmds: list[tuple[str, str]], cwd: Path) -> dict:
    results = []
    for name, cmd in cmds:
        print(f"  [eval] {name}  $ {cmd}")
        r = run(cmd, cwd=cwd, timeout=1800)
        combined = (r.get("stdout") or "") + "\n" + (r.get("stderr") or "")
        signals = {"exit_code": r["exit_code"], "duration_s": r["duration_s"]}
        if "vitest" in cmd or "test:server" in cmd or "test:client" in cmd:
            signals["vitest_failures"] = count_vitest_failures(combined)
        if "playwright" in cmd or "test:e2e" in cmd:
            signals["playwright_failures"] = count_playwright_failures(combined)
        if "prettier" in cmd or "lint" in cmd:
            signals["prettier_failures"] = count_prettier_failures(combined)
        # Pull rich signals from any eval_*.py payload the command just wrote.
        _fold_eval_json(cmd, cwd, signals)
        print(f"         exit={r['exit_code']} signals={signals}")
        results.append(
            {
                "name": name,
                "cmd": cmd,
                "exit_code": r["exit_code"],
                "duration_s": r["duration_s"],
                "signals": signals,
                "stdout_tail": (r.get("stdout") or "")[-1500:],
                "stderr_tail": (r.get("stderr") or "")[-1500:],
            }
        )
    doc = {
        "ok": all(x["exit_code"] == 0 for x in results),
        "results": results,
        "aggregate": {
            "failed_commands": sum(1 for r in results if r["exit_code"] != 0),
            "total_commands": len(results),
            "vitest_failures_total": sum(r["signals"].get("vitest_failures", 0) for r in results),
            "playwright_failures_total": sum(r["signals"].get("playwright_failures", 0) for r in results),
            "prettier_failures_total": sum(r["signals"].get("prettier_failures", 0) for r in results),
        },
    }
    return doc


def _capture_diff(cwd: Path) -> str:
    r = run("git diff --stat", cwd=cwd, timeout=30)
    stat = r.get("stdout", "")
    r2 = run("git diff", cwd=cwd, timeout=60)
    return stat + "\n---\n" + (r2.get("stdout", "") or "")[:40000]


def _revert_working_tree(cwd: Path) -> None:
    run("git checkout -- .", cwd=cwd, timeout=60)
    # Preserve the framework files we synced into the worktree (.oversight/
    # and .prettierignore) so subsequent attempts still have eval scripts.
    run(
        'git clean -fd -e .oversight -e .prettierignore -e .oversight/state -e .oversight/logs',
        cwd=cwd,
        timeout=60,
    )


def _ensure_clean_start(cwd: Path) -> bool:
    r = run("git status --porcelain", cwd=cwd, timeout=15)
    return not r["stdout"].strip()


def _safe(s: str) -> str:
    # Windows cp1252 console can't print UTF arrows; normalize early.
    return (s or "").replace("\u2192", "->").replace("\u0394", "d")


def _summarize_verdict(label: str, verdict: dict) -> None:
    print(f"  {label} score={verdict['score']} hard={len(verdict['hard_gate_failures'])} soft={len(verdict['soft_gate_regressions'])}")
    for f in verdict["hard_gate_failures"]:
        print(f"    HARD: {_safe(str(f))}")
    for f in verdict["soft_gate_regressions"]:
        print(f"    soft: {_safe(str(f))}")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--job", required=True, help="Path to a job YAML file OR a job id.")
    p.add_argument("--oneshot", action="store_true", help="Only evaluate, don't attempt changes.")
    p.add_argument(
        "--command",
        default=None,
        help="Shell command that produces a candidate change. Overrides job.change_command.",
    )
    p.add_argument("--layer", default="fast", choices=["fast", "medium", "full", "all"])
    p.add_argument("--allow-dirty", action="store_true", help="Skip clean-worktree check.")
    p.add_argument(
        "--cwd",
        default=None,
        help="Run the loop inside this directory (e.g. a git worktree).",
    )
    args = p.parse_args()

    loop_cwd = Path(args.cwd).resolve() if args.cwd else REPO_ROOT

    job_path = Path(args.job)
    if not job_path.exists():
        # try resolving as id
        matches = [p_ for p_ in list_jobs("active") + list_jobs("backlog") if load_job(p_).get("id") == args.job]
        if matches:
            job_path = matches[0]
        else:
            print(f"Could not find job: {args.job}", file=sys.stderr)
            return 2
    job = load_job(job_path)
    job_id = job.get("id", job_path.stem)
    change_command = args.command or job.get("change_command")
    print(f"=== Loop: {job_id} ({job.get('title', '')}) ===")
    print(f"    cwd: {loop_cwd}")
    if change_command:
        print(f"    change_command: {change_command}")

    manifest = load_manifest()
    forbidden = manifest.get("forbidden_paths", []) or []
    baselines = load_baselines()

    domain_obj: dict | None = None
    if job.get("domain"):
        domain_obj = load_domain(job["domain"])

    cmds = _collect_eval_commands(job, domain_obj, args.layer)
    if not cmds:
        print("No evaluator commands resolved for this job.", file=sys.stderr)
        return 2

    budget = job.get("budget") or {}
    max_attempts = int(budget.get("attempts", 1)) if not args.oneshot else 1

    # ---- baseline ----
    if not args.allow_dirty and not _ensure_clean_start(loop_cwd):
        print(
            "Working tree is dirty. Either commit/stash first or pass --allow-dirty.\n"
            "Tip: run this loop from a fresh branch or worktree so revert works cleanly.",
            file=sys.stderr,
        )
        return 2

    print("\n[baseline]")
    base_doc = _run_evaluators(cmds, cwd=loop_cwd)
    base_verdict = score_verdict([base_doc], baselines=baselines)
    base_score = base_verdict["score"]
    _summarize_verdict("baseline", base_verdict)
    write_attempt(
        job_id=job_id,
        iteration=0,
        before_score=None,
        after_score=base_score,
        accepted=True,
        reason="baseline",
        eval_results=base_doc["results"],
        notes=(
            f"Baseline evaluation before any changes. "
            f"hard_gate_failures={len(base_verdict['hard_gate_failures'])}"
        ),
    )
    if args.oneshot:
        print("\nOneshot mode: baseline captured. Exiting.")
        return 0 if base_doc["ok"] else 1

    if not change_command:
        print("\nNo --command supplied and job has no `change_command`. Pass one, or use --oneshot.", file=sys.stderr)
        return 2

    best_score = base_score
    best_hard = len(base_verdict["hard_gate_failures"])
    for i in range(1, max_attempts + 1):
        # Snapshot which files were already touched before this attempt; the
        # baseline eval run may have produced untracked artifacts under
        # .oversight/state/ which are on the forbidden list by design — but
        # those aren't the *candidate's* doing, so exclude them.
        pre_changed = set(git_changed_files(cwd=loop_cwd))

        print(f"\n[attempt {i}/{max_attempts}] $ {change_command}")
        r = run(change_command, cwd=loop_cwd, timeout=1800)
        print(f"  change-command exit={r['exit_code']} duration={r['duration_s']}s")

        # Guard: forbidden paths (must query the worktree's working tree, not
        # the main repo, because each worktree has its own index). Only files
        # the change-command *newly* touched count.
        changed_all = git_changed_files(cwd=loop_cwd)
        changed = [f for f in changed_all if f not in pre_changed]
        forbidden_hits = [f for f in changed if is_forbidden(f, forbidden)]
        if forbidden_hits:
            print(f"  REVERT: change-command touched forbidden paths: {forbidden_hits[:10]}")
            _revert_working_tree(loop_cwd)
            write_attempt(
                job_id, i, best_score, best_score, False,
                reason="forbidden-path-hit",
                notes=f"Touched: {forbidden_hits[:20]}",
            )
            continue

        # Evaluate the candidate
        print("  evaluating candidate...")
        cand_doc = _run_evaluators(cmds, cwd=loop_cwd)
        cand_verdict = score_verdict([cand_doc], baselines=baselines)
        cand_score = cand_verdict["score"]
        cand_hard = len(cand_verdict["hard_gate_failures"])
        diff_text = _capture_diff(loop_cwd)
        _summarize_verdict("candidate", cand_verdict)

        # HARD gate: new hard failures → always revert
        if cand_hard > best_hard:
            print(f"  REVERT: new hard gate failures ({best_hard}→{cand_hard}).")
            _revert_working_tree(loop_cwd)
            write_attempt(
                job_id, i, best_score, cand_score, False,
                reason="hard-gate-regressed",
                diff_text=diff_text,
                eval_results=cand_doc["results"],
                notes=f"Hard failures: {cand_verdict['hard_gate_failures']}",
            )
            continue

        if cand_score < best_score:
            print(f"  ACCEPT: {best_score} -> {cand_score} (delta={cand_score - best_score})")
            write_attempt(
                job_id, i, best_score, cand_score, True,
                reason="score-improved",
                diff_text=diff_text,
                eval_results=cand_doc["results"],
                notes=(
                    f"soft_regressions={len(cand_verdict['soft_gate_regressions'])}"
                ),
            )
            best_score = cand_score
            best_hard = cand_hard
            # Keep changes; loop continues so caller can stack more attempts.
        elif cand_score == best_score and cand_doc["ok"] and cand_hard == best_hard:
            # If we've already accepted something this loop, preserve it;
            # a no-op follow-up means the change-command is idempotent.
            if best_score < base_score:
                print(f"  NO-OP (idempotent): score unchanged ({cand_score}); keeping prior accept.")
                write_attempt(
                    job_id, i, best_score, cand_score, False,
                    reason="no-op-idempotent",
                    eval_results=cand_doc["results"],
                )
            else:
                print(f"  NO-OP: score unchanged ({cand_score}). Reverting to keep tree clean.")
                _revert_working_tree(loop_cwd)
                write_attempt(
                    job_id, i, best_score, cand_score, False,
                    reason="no-improvement",
                    eval_results=cand_doc["results"],
                )
        else:
            print(f"  REJECT: {best_score} -> {cand_score}. Reverting.")
            _revert_working_tree(loop_cwd)
            write_attempt(
                job_id, i, best_score, cand_score, False,
                reason="score-regressed",
                diff_text=diff_text,
                eval_results=cand_doc["results"],
            )

    print(f"\nLoop done. Best score: {best_score} (baseline was {base_score}).")
    print(f"Attempts logged under: {OVERSIGHT}/logs/attempts/{job_id}/")
    return 0


if __name__ == "__main__":
    # When called as a subprocess from run_parallel we may get an odd cwd.
    # Ensure our own module dir is importable.
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    raise SystemExit(main())
