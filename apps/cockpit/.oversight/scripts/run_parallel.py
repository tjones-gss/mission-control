"""Parallel improvement loop runner.

Reads every `.oversight/jobs/active/*.yaml` and runs each one inside its
own git worktree on its own branch, in parallel via a ProcessPoolExecutor.
Each job's node_modules directories are junction/symlink-linked to the
main tree's copies (unless `parallelizable: false`, e.g. dependency jobs).

Writes a `.oversight/state/leaderboard.json` summarizing every job's
baseline and final score.

Usage:
  python .oversight/scripts/run_parallel.py              # run all active jobs
  python .oversight/scripts/run_parallel.py --job 003    # run a single active job id
  python .oversight/scripts/run_parallel.py --dry-run    # print the plan, no execution
  python .oversight/scripts/run_parallel.py --cleanup    # remove all oversight worktrees
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # type: ignore
    OVERSIGHT,
    REPO_ROOT,
    list_jobs,
    load_job,
    load_manifest,
    now_stamp,
    read_json,
    write_json,
)
from _worktree import (  # type: ignore
    destroy_worktree,
    ensure_worktree,
    link_node_modules,
    list_worktrees,
    sync_framework,
)


def _plan_jobs(selected_ids: list[str] | None) -> list[dict]:
    """Return a list of job plan dicts for all active jobs (optionally filtered)."""
    manifest = load_manifest()
    git_cfg = manifest.get("git", {}) or {}
    branch_prefix = git_cfg.get("branch_prefix", "oversight/")
    worktree_prefix = git_cfg.get("worktree_prefix", ".worktrees/oversight-")

    plans: list[dict] = []
    seen_scope: dict[str, str] = {}  # editable_path -> job_id (for collision detection)

    for job_path in list_jobs("active"):
        job = load_job(job_path)
        job_id = job.get("id") or job_path.stem
        if selected_ids and job_id not in selected_ids:
            continue

        parallelizable = job.get("parallelizable", True)
        editable = job.get("editable_paths") or []
        collisions = []
        for ep in editable:
            prior = seen_scope.get(ep)
            if prior and prior != job_id:
                collisions.append((ep, prior))
            seen_scope[ep] = job_id

        plans.append(
            {
                "id": job_id,
                "title": job.get("title") or job_id,
                "domain": job.get("domain"),
                "job_path": str(job_path),
                "change_command": job.get("change_command"),
                "parallelizable": bool(parallelizable),
                "branch": f"{branch_prefix}{job_id}",
                "worktree": str(REPO_ROOT / f"{worktree_prefix}{job_id}"),
                "collisions": collisions,
            }
        )
    return plans


def _worker(plan: dict, layer: str, link_node_mods: bool) -> dict:
    """Runs in a subprocess; no shared state with other workers."""
    from _worktree import (  # re-import in child
        ensure_worktree,
        link_node_modules,
        sync_framework,
    )
    from _common import run as _run  # type: ignore

    out: dict = {
        "id": plan["id"],
        "branch": plan["branch"],
        "worktree": plan["worktree"],
        "started_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }
    try:
        created = ensure_worktree(Path(plan["worktree"]), plan["branch"])
        out["worktree_created"] = created
        # Mirror the main tree's (uncommitted) oversight framework into the worktree.
        out["sync_report"] = sync_framework(Path(plan["worktree"]))
        if link_node_mods and plan["parallelizable"]:
            out["link_report"] = link_node_modules(Path(plan["worktree"]))
        else:
            out["link_report"] = {"skipped": "parallelizable=false or link-disabled"}

        # Invoke run_job_loop.py in the worktree directory.
        # We always pass --allow-dirty because the synced framework files and
        # linked node_modules make the worktree technically "dirty" relative
        # to its branch. Scope/forbidden-path checks still apply.
        # NOTE: we do NOT pass --command here. run_job_loop.py reads
        # `change_command` directly from the job YAML. This avoids brittle
        # cross-shell quoting for multi-line change commands.
        loop = str(OVERSIGHT / "scripts" / "run_job_loop.py")
        cmd = (
            f'python "{loop}" --job "{plan["job_path"]}" --cwd "{plan["worktree"]}" '
            f'--layer {layer} --allow-dirty'
        )
        if not plan["change_command"]:
            cmd += " --oneshot"
        out["cmd"] = cmd
        r = _run(cmd, cwd=REPO_ROOT, timeout=3600)
        out["exit_code"] = r["exit_code"]
        out["duration_s"] = r["duration_s"]
        out["stdout_tail"] = (r.get("stdout") or "")[-3000:]
        out["stderr_tail"] = (r.get("stderr") or "")[-3000:]
    except Exception as e:  # noqa: BLE001
        out["exit_code"] = 99
        out["error"] = f"{type(e).__name__}: {e}"
    out["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    # Pick up the most recent attempt for this job to extract scores.
    attempts_dir = OVERSIGHT / "logs" / "attempts" / plan["id"]
    baseline_score = None
    final_score = None
    accepted_any = False
    if attempts_dir.exists():
        attempts = sorted(attempts_dir.glob("*.json"))
        if attempts:
            first = read_json(attempts[0]) or {}
            last = read_json(attempts[-1]) or {}

            def _pick(d: dict) -> float | None:
                for k in ("after_score", "score"):
                    v = d.get(k)
                    if v is not None:
                        return v
                return None

            baseline_score = _pick(first)
            final_score = _pick(last)
            accepted_any = any(
                (read_json(a) or {}).get("accepted") is True for a in attempts[1:]
            )
    out["score_before"] = baseline_score
    out["score_after"] = final_score
    out["accepted_any_change"] = accepted_any
    return out


def _cleanup_all(plans: list[dict]) -> None:
    for plan in plans:
        print(f"  removing worktree {plan['worktree']}")
        try:
            destroy_worktree(Path(plan["worktree"]))
        except Exception as e:  # noqa: BLE001
            print(f"    warn: {e}")
    subprocess.run(["git", "worktree", "prune"], cwd=REPO_ROOT)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job", action="append", default=None, help="Specific job id(s) to run.")
    parser.add_argument("--layer", default="fast", choices=["fast", "medium", "full", "all"])
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--cleanup", action="store_true", help="Remove all oversight worktrees and exit.")
    parser.add_argument(
        "--force-overlap",
        action="store_true",
        help="Run even when two active jobs share the same editable_paths (unsafe; serial fix recommended).",
    )
    args = parser.parse_args()

    manifest = load_manifest()
    par = manifest.get("parallel") or {}
    max_workers = int(par.get("max_workers", 4))
    stagger = int(par.get("stagger_seconds", 2))
    link_node_mods = bool(par.get("link_node_modules", True))

    selected = args.job
    plans = _plan_jobs(selected)
    if not plans:
        print("No active jobs to run. Drop YAMLs into .oversight/jobs/active/.", file=sys.stderr)
        return 1

    print(f"Planned {len(plans)} job(s):")
    for p in plans:
        print(
            f"  {p['id']:<28} domain={p['domain'] or '-':<12} "
            f"parallelizable={p['parallelizable']} branch={p['branch']}"
        )
        for ep, prior in p["collisions"]:
            print(f"    WARN: scope overlap with {prior} on {ep}")

    has_collision = any(p["collisions"] for p in plans)
    if has_collision and not args.force_overlap and not args.cleanup and not args.dry_run:
        print(
            "\nAborting: active jobs have overlapping editable_paths. "
            "Resolve job YAML scopes, run jobs serially, or pass --force-overlap if you accept the risk.",
            file=sys.stderr,
        )
        return 2

    if args.cleanup:
        _cleanup_all(plans)
        print("Cleanup done.")
        return 0

    if args.dry_run:
        return 0

    # Serialize non-parallelizable jobs (run them first, one by one).
    serial = [p for p in plans if not p["parallelizable"]]
    parallel = [p for p in plans if p["parallelizable"]]

    results: list[dict] = []

    print(f"\nSerial jobs ({len(serial)}):")
    for plan in serial:
        print(f"  -> {plan['id']}")
        results.append(_worker(plan, args.layer, link_node_mods))

    workers = min(max_workers, max(1, len(parallel)))
    print(f"\nParallel jobs ({len(parallel)}) with max_workers={workers}, stagger={stagger}s:")

    if parallel:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            futures = {}
            for i, plan in enumerate(parallel):
                if i > 0 and stagger > 0:
                    time.sleep(stagger)
                futures[ex.submit(_worker, plan, args.layer, link_node_mods)] = plan["id"]
                print(f"  submitted: {plan['id']}")
            for fut in as_completed(futures):
                pid = futures[fut]
                try:
                    res = fut.result()
                except Exception as e:  # noqa: BLE001
                    res = {"id": pid, "error": f"{type(e).__name__}: {e}", "exit_code": 99}
                results.append(res)
                print(
                    f"  done: {res['id']:<28} exit={res.get('exit_code')} "
                    f"score {res.get('score_before')}->{res.get('score_after')}"
                )

    # Leaderboard
    leaderboard = {
        "timestamp": now_stamp(),
        "layer": args.layer,
        "max_workers": workers,
        "jobs": [
            {
                "id": r["id"],
                "branch": r.get("branch"),
                "worktree": r.get("worktree"),
                "exit_code": r.get("exit_code"),
                "score_before": r.get("score_before"),
                "score_after": r.get("score_after"),
                "accepted": r.get("accepted_any_change"),
                "duration_s": r.get("duration_s"),
                "error": r.get("error"),
            }
            for r in results
        ],
    }
    out_path = OVERSIGHT / "state" / "leaderboard.json"
    write_json(out_path, leaderboard)
    print(f"\nWrote leaderboard: {out_path}")

    # Also stash per-worker raw logs
    log_path = OVERSIGHT / "logs" / "parallel" / f"run__{leaderboard['timestamp']}.json"
    write_json(log_path, {"results": results, "summary": leaderboard})
    print(f"Raw run log: {log_path}")

    for r in results:
        before = r.get("score_before")
        after = r.get("score_after")
        symbol = "="
        if isinstance(before, (int, float)) and isinstance(after, (int, float)):
            if after < before:
                symbol = "v"  # score went down => improvement (lower is better)
            elif after > before:
                symbol = "^"
        print(
            f"  {symbol} {r['id']:<28} exit={r.get('exit_code')} "
            f"before={before} after={after} accepted={r.get('accepted_any_change')}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
