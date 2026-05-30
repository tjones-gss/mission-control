"""Print all jobs (active, backlog, templates) with key metadata.

Usage:
  python .oversight/scripts/list_jobs.py [--bucket active|backlog|templates|all]
"""

from __future__ import annotations

import argparse

from _common import list_jobs, load_job  # type: ignore


def _print_bucket(bucket: str) -> None:
    jobs = list_jobs(bucket)
    print(f"--- {bucket} ({len(jobs)}) ---")
    for p in jobs:
        try:
            data = load_job(p)
        except Exception as e:  # noqa: BLE001
            print(f"  {p.name:<40}  <unparseable: {e}>")
            continue
        jid = data.get("id", "?")
        domain = data.get("domain", "?")
        title = data.get("title", "?")
        priority = data.get("priority", "?")
        print(f"  {p.name:<40}  id={jid}  domain={domain}  prio={priority}")
        print(f"      title: {title}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bucket", default="all", choices=["active", "backlog", "templates", "all"])
    args = parser.parse_args()
    buckets = ["active", "backlog", "templates"] if args.bucket == "all" else [args.bucket]
    for b in buckets:
        _print_bucket(b)
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
