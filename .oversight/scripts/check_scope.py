"""Verify that the current working-tree changes fall inside a job/domain scope.

Usage:
  python .oversight/scripts/check_scope.py --job .oversight/jobs/active/<file>.yaml
  python .oversight/scripts/check_scope.py --domain frontend

Exit codes:
  0 = every changed file is inside editable_paths AND none are forbidden
  1 = scope violation (prints the offending files)
  2 = invalid invocation
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _common import (  # type: ignore
    git_changed_files,
    is_forbidden,
    load_domain,
    load_job,
    load_manifest,
    path_matches_glob,
)


def _in_any(path: str, patterns: list[str]) -> bool:
    return any(path_matches_glob(path, p) for p in patterns)


def main() -> int:
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--domain")
    g.add_argument("--job")
    args = parser.parse_args()

    manifest = load_manifest()
    forbidden = manifest.get("forbidden_paths", []) or []

    editable: list[str]
    job_allowed_extras: list[str] = []
    if args.domain:
        dom = load_domain(args.domain)
        editable = dom.get("editable_paths", []) or []
    else:
        job = load_job(Path(args.job))
        if not job.get("editable_paths"):
            dom = load_domain(job["domain"])
            editable = dom.get("editable_paths", []) or []
        else:
            editable = job["editable_paths"]
        job_allowed_extras = job.get("allow_protected", []) or []

    changed = git_changed_files()
    if not changed:
        print("No working-tree changes.")
        return 0

    out_of_scope: list[str] = []
    forbidden_hits: list[str] = []
    for f in changed:
        # Jobs may explicitly whitelist a normally-protected path.
        if is_forbidden(f, forbidden) and not _in_any(f, job_allowed_extras):
            forbidden_hits.append(f)
            continue
        if not _in_any(f, editable):
            out_of_scope.append(f)

    ok = not out_of_scope and not forbidden_hits
    print(f"Changed files:      {len(changed)}")
    print(f"Out-of-scope:       {len(out_of_scope)}")
    for f in out_of_scope:
        print(f"  - {f}")
    print(f"Forbidden-path hits: {len(forbidden_hits)}")
    for f in forbidden_hits:
        print(f"  - {f}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
