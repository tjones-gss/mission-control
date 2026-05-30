"""Git worktree helpers for parallel improvement loops.

Each improvement job gets its own worktree so multiple loops can run at
once without stepping on each other's working tree. To avoid installing
node_modules N times, we junction/symlink the main tree's node_modules
into each worktree. Jobs with `parallelizable: false` (e.g. the
`dependencies` domain) get a real `npm ci` instead because they mutate
lockfiles.

Functions:
  ensure_branch(branch)                 — create the branch off HEAD if missing
  ensure_worktree(path, branch)          — idempotent `git worktree add`
  link_node_modules(worktree)            — junction/symlink the 3 node_modules dirs
  destroy_worktree(path, branch=None)    — `git worktree remove` + optional branch delete
  list_worktrees()                       — parse `git worktree list --porcelain`

Cross-platform: Windows uses `mklink /J` (directory junction, no admin required),
Unix/macOS uses `os.symlink` to a directory.
"""

from __future__ import annotations

import os
import platform
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT, run  # type: ignore

IS_WINDOWS = platform.system() == "Windows"
LINKED_MODULES = ["node_modules", "client/node_modules", "server/node_modules"]


# ── branches ───────────────────────────────────────────────────────────


def branch_exists(branch: str) -> bool:
    r = run(f"git rev-parse --verify --quiet refs/heads/{branch}", cwd=REPO_ROOT, timeout=15)
    return r["exit_code"] == 0


def ensure_branch(branch: str, base: str = "HEAD") -> None:
    if branch_exists(branch):
        return
    r = run(f"git branch {branch} {base}", cwd=REPO_ROOT, timeout=15)
    if r["exit_code"] != 0:
        raise RuntimeError(f"git branch {branch} failed: {r['stderr'].strip()}")


def delete_branch(branch: str) -> None:
    if not branch_exists(branch):
        return
    run(f"git branch -D {branch}", cwd=REPO_ROOT, timeout=15)


# ── worktrees ──────────────────────────────────────────────────────────


def list_worktrees() -> list[dict]:
    r = run("git worktree list --porcelain", cwd=REPO_ROOT, timeout=15)
    out: list[dict] = []
    current: dict = {}
    for line in r["stdout"].splitlines():
        if not line.strip():
            if current:
                out.append(current)
                current = {}
            continue
        if " " in line:
            k, v = line.split(" ", 1)
            current[k] = v
        else:
            current[line] = True
    if current:
        out.append(current)
    return out


def ensure_worktree(worktree_path: Path, branch: str) -> bool:
    """Create the worktree if missing. Returns True if newly created."""
    worktree_path = worktree_path.resolve()
    if (worktree_path / ".git").exists() or worktree_path.exists():
        # Might be a live worktree or an orphan dir. If live, fine.
        existing = list_worktrees()
        for wt in existing:
            if Path(wt.get("worktree", "")).resolve() == worktree_path:
                return False
        # Orphan directory — git will refuse to overwrite. Prune first.
        run("git worktree prune", cwd=REPO_ROOT, timeout=15)

    ensure_branch(branch)
    rel = worktree_path
    r = run(f'git worktree add "{rel}" {branch}', cwd=REPO_ROOT, timeout=120)
    if r["exit_code"] != 0:
        raise RuntimeError(
            f"git worktree add failed for {worktree_path} @ {branch}:\n{r['stderr']}"
        )
    return True


def destroy_worktree(worktree_path: Path, *, delete_branch_name: str | None = None, force: bool = True) -> None:
    worktree_path = worktree_path.resolve()
    flag = "--force" if force else ""
    run(f'git worktree remove {flag} "{worktree_path}"', cwd=REPO_ROOT, timeout=60)
    run("git worktree prune", cwd=REPO_ROOT, timeout=15)
    if delete_branch_name:
        delete_branch(delete_branch_name)


# ── node_modules linking ───────────────────────────────────────────────


def _junction(link: Path, target: Path) -> bool:
    """Create a directory junction (Windows) or symlink (Unix). Returns True on success."""
    link = Path(link)
    target = Path(target).resolve()
    if not target.exists():
        print(f"  skip link: target missing: {target}", file=sys.stderr)
        return False
    # If link already exists and points somewhere, leave it.
    if link.exists() or link.is_symlink():
        return True
    link.parent.mkdir(parents=True, exist_ok=True)
    try:
        if IS_WINDOWS:
            # mklink /J requires cmd.exe. No admin needed for junctions.
            res = subprocess.run(
                ["cmd", "/c", "mklink", "/J", str(link), str(target)],
                capture_output=True,
                text=True,
            )
            if res.returncode != 0:
                print(f"  mklink /J failed: {res.stderr.strip()}", file=sys.stderr)
                return False
            return True
        else:
            os.symlink(target, link, target_is_directory=True)
            return True
    except OSError as e:
        print(f"  link create failed {link} -> {target}: {e}", file=sys.stderr)
        return False


FRAMEWORK_SYNC_PATHS = [
    ".oversight/manifest.yaml",
    ".oversight/README.md",
    ".oversight/AGENT_START.md",
    ".oversight/scripts",
    ".oversight/jobs",
    ".oversight/domains",
    ".prettierignore",
]

# Relative paths inside .oversight that should NOT be copied over (per-worktree state).
FRAMEWORK_SYNC_EXCLUDE = {
    ".oversight/state",
    ".oversight/logs",
    ".oversight/scripts/__pycache__",
}


def sync_framework(worktree_path: Path) -> dict[str, str]:
    """Copy the main tree's oversight framework into the worktree.

    The worktree's branch likely predates these framework files (they live
    only in the working tree). Without this sync, the worker wouldn't find
    `.oversight/scripts/run_job_loop.py` in its own cwd. Copying is cheap
    because these are tiny YAML/MD/Py files.

    Returns a report {path: "copied" | "skipped" | "error"}.
    """
    import shutil

    report: dict[str, str] = {}
    for rel in FRAMEWORK_SYNC_PATHS:
        src = REPO_ROOT / rel
        dst = worktree_path / rel
        if not src.exists():
            report[rel] = "source-missing"
            continue
        try:
            if src.is_dir():
                dst.mkdir(parents=True, exist_ok=True)
                for child in src.rglob("*"):
                    child_rel = child.relative_to(REPO_ROOT).as_posix()
                    if any(child_rel == ex or child_rel.startswith(ex + "/") for ex in FRAMEWORK_SYNC_EXCLUDE):
                        continue
                    target = worktree_path / child_rel
                    if child.is_dir():
                        target.mkdir(parents=True, exist_ok=True)
                    else:
                        target.parent.mkdir(parents=True, exist_ok=True)
                        shutil.copy2(child, target)
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dst)
            report[rel] = "copied"
        except OSError as e:
            report[rel] = f"error: {e}"
    return report


def link_node_modules(worktree_path: Path) -> dict[str, str]:
    """For each of LINKED_MODULES: if missing in worktree, link it to the main tree's copy.

    Returns a report {path: "linked" | "exists" | "skip"}.
    """
    report: dict[str, str] = {}
    for rel in LINKED_MODULES:
        target = REPO_ROOT / rel
        link = worktree_path / rel
        if link.exists() or link.is_symlink():
            report[rel] = "exists"
            continue
        if not target.exists():
            report[rel] = "target-missing"
            continue
        ok = _junction(link, target)
        report[rel] = "linked" if ok else "link-failed"
    return report


# ── CLI ────────────────────────────────────────────────────────────────


def _cli() -> int:
    import argparse

    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_add = sub.add_parser("add")
    p_add.add_argument("path")
    p_add.add_argument("branch")
    p_add.add_argument("--link-node-modules", action="store_true")

    p_rm = sub.add_parser("remove")
    p_rm.add_argument("path")
    p_rm.add_argument("--delete-branch", default=None)

    sub.add_parser("list")

    p_link = sub.add_parser("link")
    p_link.add_argument("path")

    args = parser.parse_args()

    if args.cmd == "add":
        created = ensure_worktree(Path(args.path), args.branch)
        print(f"{'created' if created else 'exists'}: {args.path} @ {args.branch}")
        if args.link_node_modules:
            for k, v in link_node_modules(Path(args.path)).items():
                print(f"  link {k:<24} {v}")
        return 0
    if args.cmd == "remove":
        destroy_worktree(Path(args.path), delete_branch_name=args.delete_branch)
        return 0
    if args.cmd == "list":
        for wt in list_worktrees():
            print(wt)
        return 0
    if args.cmd == "link":
        for k, v in link_node_modules(Path(args.path)).items():
            print(f"  {k:<24} {v}")
        return 0
    return 2


if __name__ == "__main__":
    raise SystemExit(_cli())
