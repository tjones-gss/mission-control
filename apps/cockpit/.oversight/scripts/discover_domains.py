"""Discover which declared domains are actually present in the repo.

Walks each domain's editable_paths and prints a count of files that exist,
which helps confirm whether the framework is still wired to reality.

Usage:
  python .oversight/scripts/discover_domains.py
"""

from __future__ import annotations

from pathlib import Path

from _common import REPO_ROOT, is_forbidden, list_domain_names, load_domain, load_manifest, path_matches_glob  # type: ignore


_CACHED_FILES: list[str] | None = None


def _all_repo_files() -> list[str]:
    """Walk the repo once, excluding obvious dep/build folders, and return
    forward-slash relative paths. Python's Path.glob skips hidden directories
    like .github/ and .husky/ by default, so we roll our own traversal."""
    global _CACHED_FILES
    if _CACHED_FILES is not None:
        return _CACHED_FILES
    import os

    skip_dirs = {"node_modules", ".git", "dist", "build", "coverage", ".worktrees"}
    out: list[str] = []
    for root, dirs, files in os.walk(REPO_ROOT):
        dirs[:] = [d for d in dirs if d not in skip_dirs]
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), REPO_ROOT).replace("\\", "/")
            out.append(rel)
    _CACHED_FILES = out
    return out


def _glob_count(pattern: str) -> int:
    files = _all_repo_files()
    return sum(1 for f in files if path_matches_glob(f, pattern))


def main() -> int:
    print(f"Scanning repo: {REPO_ROOT}")
    print()
    for name in list_domain_names():
        dom = load_domain(name)
        editable = dom.get("editable_paths", []) or []
        total = 0
        details: list[str] = []
        for pat in editable:
            c = _glob_count(pat)
            total += c
            details.append(f"  {pat:<40} {c}")
        status = "OK" if total > 0 else "EMPTY"
        print(f"[{status}] {name}  -> {total} file(s) matched")
        for d in details:
            print(d)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
