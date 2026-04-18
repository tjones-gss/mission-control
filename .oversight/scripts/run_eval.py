"""Run the evaluator commands for a domain or job and emit a JSON score.

Usage:
  python .oversight/scripts/run_eval.py --domain frontend [--layer fast|medium|full]
  python .oversight/scripts/run_eval.py --job .oversight/jobs/active/<file>.yaml
  python .oversight/scripts/run_eval.py --shared fast|medium|full

Exit codes:
  0 = all evaluators succeeded
  1 = one or more evaluators failed
  2 = invalid invocation
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from _common import (  # type: ignore
    OVERSIGHT,
    REPO_ROOT,
    count_playwright_failures,
    count_prettier_failures,
    count_vitest_failures,
    load_domain,
    load_job,
    load_manifest,
    now_stamp,
    run,
    write_json,
)


def _score_output(name: str, res: dict) -> dict:
    """Extract numeric signals from known commands."""
    combined = (res.get("stdout", "") or "") + "\n" + (res.get("stderr", "") or "")
    signals: dict = {"exit_code": res["exit_code"], "duration_s": res["duration_s"]}
    if "vitest" in res["cmd"] or "test:server" in res["cmd"] or "test:client" in res["cmd"]:
        signals["vitest_failures"] = count_vitest_failures(combined)
    if "playwright" in res["cmd"] or "test:e2e" in res["cmd"]:
        signals["playwright_failures"] = count_playwright_failures(combined)
    if "prettier" in res["cmd"] or "lint" in res["cmd"]:
        signals["prettier_failures"] = count_prettier_failures(combined)
    return signals


def _collect_commands(
    domain: dict | None,
    layer: str,
    shared: dict,
) -> list[tuple[str, str]]:
    cmds: list[tuple[str, str]] = []
    if domain is not None:
        if layer in ("fast", "all"):
            for k, v in (domain.get("local_evaluators") or {}).items():
                cmds.append((f"{domain['name']}.local.{k}", v))
        if layer in ("medium", "all"):
            for k, v in (domain.get("cross_checks") or {}).items():
                cmds.append((f"{domain['name']}.cross.{k}", v))
        if layer == "full":
            for k, v in (domain.get("full_evaluators") or {}).items():
                cmds.append((f"{domain['name']}.full.{k}", v))
    else:
        # Shared-only (no domain): use manifest.shared_validation[layer]
        for k, v in (shared.get(layer, {}) or {}).items():
            cmds.append((f"shared.{layer}.{k}", v))
    return cmds


def main() -> int:
    parser = argparse.ArgumentParser()
    g = parser.add_mutually_exclusive_group(required=True)
    g.add_argument("--domain")
    g.add_argument("--job")
    g.add_argument("--shared", choices=["fast", "medium", "full"])
    parser.add_argument("--layer", default="fast", choices=["fast", "medium", "full", "all"])
    parser.add_argument("--out", default=None, help="Write full result JSON to this path.")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest()
    shared = manifest.get("shared_validation", {}) or {}

    domain_obj: dict | None = None
    label = ""
    if args.domain:
        domain_obj = load_domain(args.domain)
        label = f"domain:{args.domain}:{args.layer}"
        cmds = _collect_commands(domain_obj, args.layer, shared)
    elif args.job:
        job = load_job(Path(args.job))
        label = f"job:{job.get('id', Path(args.job).stem)}"
        # A job may specify explicit commands, or fall back to its domain.
        explicit = job.get("evaluators") or {}
        if explicit:
            cmds = [(f"job.{k}", v) for k, v in explicit.items()]
        else:
            dom_name = job.get("domain")
            if not dom_name:
                print("Job has neither 'evaluators' nor 'domain'.", file=sys.stderr)
                return 2
            domain_obj = load_domain(dom_name)
            cmds = _collect_commands(domain_obj, args.layer, shared)
    else:
        label = f"shared:{args.shared}"
        cmds = _collect_commands(None, args.shared, shared)

    results = []
    overall_ok = True
    for name, cmd in cmds:
        if not args.quiet:
            print(f"[eval] {name}  $ {cmd}")
        res = run(cmd, cwd=REPO_ROOT, timeout=1800)
        signals = _score_output(name, res)
        if res["exit_code"] != 0:
            overall_ok = False
        if not args.quiet:
            print(
                f"       exit={res['exit_code']} duration={res['duration_s']}s "
                f"signals={signals}"
            )
        results.append(
            {
                "name": name,
                "cmd": cmd,
                "exit_code": res["exit_code"],
                "duration_s": res["duration_s"],
                "timed_out": res["timed_out"],
                "signals": signals,
                "stdout_tail": (res["stdout"] or "")[-2000:],
                "stderr_tail": (res["stderr"] or "")[-2000:],
            }
        )

    payload = {
        "label": label,
        "timestamp": now_stamp(),
        "ok": overall_ok,
        "results": results,
        "aggregate": {
            "failed_commands": sum(1 for r in results if r["exit_code"] != 0),
            "total_commands": len(results),
            "vitest_failures_total": sum(
                r["signals"].get("vitest_failures", 0) for r in results
            ),
            "playwright_failures_total": sum(
                r["signals"].get("playwright_failures", 0) for r in results
            ),
            "prettier_failures_total": sum(
                r["signals"].get("prettier_failures", 0) for r in results
            ),
        },
    }

    out_path: Path
    if args.out:
        out_path = Path(args.out)
    else:
        out_path = OVERSIGHT / "state" / "scores" / f"{label.replace(':', '_')}__{payload['timestamp']}.json"
    write_json(out_path, payload)
    if not args.quiet:
        print()
        print(f"Wrote: {out_path}")
        print(f"Summary: {payload['aggregate']}")

    return 0 if overall_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
