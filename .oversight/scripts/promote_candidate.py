"""Promote an accepted candidate: create a branch + commit the current diff.

This never pushes, never merges, and never runs `git reset --hard`.
The human / outer loop decides whether to merge the branch.

Usage:
  python .oversight/scripts/promote_candidate.py --job <job_id> [--message "short summary"]
"""

from __future__ import annotations

import argparse
import sys

from _common import load_manifest, run  # type: ignore


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--job", required=True)
    p.add_argument("--message", default=None)
    args = p.parse_args()

    m = load_manifest()
    prefix = m.get("git", {}).get("branch_prefix", "oversight/")
    trailer = m.get("git", {}).get("commit_trailer", "Improvement-Loop: ditto")

    status = run("git status --porcelain", timeout=15)
    if not status["stdout"].strip():
        print("Nothing to promote — working tree is clean.")
        return 1

    branch = f"{prefix}{args.job}"
    r_branch = run(f"git checkout -b {branch}", timeout=30)
    if r_branch["exit_code"] != 0:
        # Branch may already exist; try switching.
        r_switch = run(f"git checkout {branch}", timeout=30)
        if r_switch["exit_code"] != 0:
            print("Failed to create or switch to branch:", file=sys.stderr)
            print(r_branch["stderr"], file=sys.stderr)
            return 1

    msg = args.message or f"oversight: improvement loop accepted candidate for {args.job}"
    full = f"{msg}\n\n{trailer}\n"
    r_add = run("git add -A", timeout=30)
    if r_add["exit_code"] != 0:
        print(r_add["stderr"], file=sys.stderr)
        return 1
    # Use -F - via stdin to avoid shell-quoting headaches.
    import subprocess

    cp = subprocess.run(
        ["git", "commit", "-F", "-"],
        input=full,
        text=True,
        capture_output=True,
    )
    print(cp.stdout)
    if cp.returncode != 0:
        print(cp.stderr, file=sys.stderr)
        return cp.returncode
    print(f"Promoted to branch: {branch}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
