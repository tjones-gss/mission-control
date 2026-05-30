from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from harness_core.yaml_utils import find_harness_root, get, load_yaml

from harness_orchestrator.cursor_driver import config_from_env
from harness_orchestrator.loop import run_next_mission_loop
from harness_orchestrator.state import harness_cli, harness_json, preflight

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")


def _root_from_args(args) -> Path:
    root = Path(args.cwd).resolve()
    found = find_harness_root(root)
    if found is None:
        print("error: no .harness/ found", file=sys.stderr)
        sys.exit(2)
    return found


def cmd_preflight(args) -> int:
    root = _root_from_args(args)
    preflight(root, strict=args.strict)
    print("preflight ok")
    return 0


def cmd_status(args) -> int:
    root = _root_from_args(args)
    if args.json:
        data = harness_json(root, "status")
        import json

        print(json.dumps(data, indent=2))
    else:
        code, out = harness_cli(root, "status")
        print(out, end="")
        return code
    return 0


def cmd_run_loop(args) -> int:
    root = _root_from_args(args)
    resume_id = None
    if args.resume:
        project = load_yaml(root / ".harness/project-state.yml")
        resume_id = get(project, "current", "agent_id")

    config = config_from_env(
        cwd=str(root),
        runtime=args.runtime,
        repo_url=args.repo_url,
        branch=args.branch,
        auto_create_pr=args.auto_pr,
        skip_reviewer_request=args.skip_reviewer_request,
        resume_agent_id=resume_id,
        dry_run=args.dry_run,
        strict_gates=not args.no_strict_gates,
    )
    return run_next_mission_loop(root, config)


def cmd_run_mission(args) -> int:
    args.runtime = args.runtime or "local"
    return cmd_run_loop(args)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="harness-orchestrator")
    sub = parser.add_subparsers(dest="command", required=True)

    p_pre = sub.add_parser("preflight", help="Run harness check --strict")
    p_pre.add_argument("--cwd", default=".", help="Harness project root")
    p_pre.add_argument("--strict", action="store_true", default=True)
    p_pre.set_defaults(func=cmd_preflight)

    p_status = sub.add_parser("status", help="Harness status")
    p_status.add_argument("--cwd", default=".")
    p_status.add_argument("--json", action="store_true")
    p_status.set_defaults(func=cmd_status)

    for name in ("run-loop", "run-mission"):
        p = sub.add_parser(name, help="Run one next-mission-loop iteration")
        p.add_argument("--cwd", default=".")
        p.add_argument("--runtime", choices=["local", "cloud"], default="local")
        p.add_argument("--repo-url", default=None, help="Git repo URL (cloud)")
        p.add_argument("--branch", default=None, help="Mission branch (cloud)")
        p.add_argument("--auto-pr", action="store_true", help="Cloud: autoCreatePR")
        p.add_argument("--skip-reviewer-request", action="store_true")
        p.add_argument("--resume", action="store_true", help="Resume agent_id from project-state")
        p.add_argument("--dry-run", action="store_true", help="Mock agent (no API calls)")
        p.add_argument(
            "--no-strict-gates",
            action="store_true",
            help="Do not exit non-zero when required gates fail (live runs only)",
        )
        p.set_defaults(func=cmd_run_loop)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
