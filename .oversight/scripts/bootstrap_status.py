"""Print a summary of the current oversight framework state.

Usage:
  python .oversight/scripts/bootstrap_status.py
"""

from __future__ import annotations

from _common import (  # type: ignore
    OVERSIGHT,
    git_changed_files,
    list_domain_names,
    list_jobs,
    load_manifest,
)


def main() -> int:
    m = load_manifest()
    print("=== Oversight framework status ===")
    print(f"Repo:          {m.get('repo', {}).get('name')}")
    print(f"Kind:          {m.get('repo', {}).get('kind')}")
    print(f"Node (CI):     {m.get('repo', {}).get('node_version_ci')}")
    print()

    domains = list_domain_names()
    print(f"Domains ({len(domains)}):")
    for d in domains:
        print(f"  - {d}")
    print()

    active = list_jobs("active")
    backlog = list_jobs("backlog")
    templates = list_jobs("templates")
    print(f"Jobs: active={len(active)}  backlog={len(backlog)}  templates={len(templates)}")
    for bucket, items in (("active", active), ("backlog", backlog)):
        for p in items:
            print(f"  [{bucket}] {p.name}")
    print()

    print("Forbidden path patterns:")
    for pat in m.get("forbidden_paths", [])[:10]:
        print(f"  - {pat}")
    if len(m.get("forbidden_paths", [])) > 10:
        print(f"  ... ({len(m['forbidden_paths']) - 10} more)")
    print()

    changed = git_changed_files()
    print(f"Working tree changes: {len(changed)} file(s)")
    for f in changed[:10]:
        print(f"  * {f}")
    if len(changed) > 10:
        print(f"  ... ({len(changed) - 10} more)")
    print()

    print(f"Paths:")
    print(f"  state: {OVERSIGHT / 'state'}")
    print(f"  logs:  {OVERSIGHT / 'logs'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
