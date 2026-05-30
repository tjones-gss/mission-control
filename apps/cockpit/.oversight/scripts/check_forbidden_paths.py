"""Confirm that no working-tree change touches a globally forbidden path.

Patterns are loaded from `manifest.yaml` -> `forbidden_paths` (same source as
`run_job_loop.py`). Unlike `check_scope.py`, this ignores domain/job editable
paths; it is a *safety net* you can run any time, including as a git pre-commit helper.

Exit codes:
  0 = clean
  1 = at least one forbidden path changed
"""

from __future__ import annotations

from _common import git_changed_files, is_forbidden, load_manifest  # type: ignore


def main() -> int:
    manifest = load_manifest()
    forbidden = manifest.get("forbidden_paths", []) or []
    changed = git_changed_files()
    bad = [f for f in changed if is_forbidden(f, forbidden)]
    if not bad:
        print(f"OK - none of the {len(changed)} changed file(s) hit a forbidden pattern.")
        return 0
    print(f"FORBIDDEN: {len(bad)} / {len(changed)} changed file(s):")
    for f in bad:
        print(f"  - {f}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
