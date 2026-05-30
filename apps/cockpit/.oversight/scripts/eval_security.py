"""Security evaluator.

Runs three checks:

  1. secret_scan — invokes `.oversight/scripts/_secretscan.mjs` which
     imports `server/utils/secretScanner.js` and runs it over every
     git-tracked file. Reports `secret_findings` (count of rule hits).
  2. env_leak — number of git-tracked paths matching `.env*`
     (excluding `.env.example` and `.env.sample`). Derived from the same
     Node bridge.
  3. dangerous_api_count — counted by eval_code_health, but we re-report
     the count here by running a lightweight scan so security can
     act as a self-contained hard gate.

Exit code:
  0 if all three signals are zero.
  1 otherwise (any finding is treated as a hard failure).

Usage:
  python .oversight/scripts/eval_security.py [--write-baseline] [--out file.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import HERE, OVERSIGHT, REPO_ROOT, now_stamp, run, write_json  # type: ignore

DANGEROUS_RX = re.compile(
    r"\beval\s*\(|"
    r"\bnew\s+Function\s*\(|"
    r"dangerouslySetInnerHTML|"
    r"\binnerHTML\s*=|"
    r"\bdocument\.write\s*\("
)

SCAN_SUFFIXES = (".js", ".jsx", ".mjs", ".ts", ".tsx")


def _dangerous_scan() -> tuple[int, list[dict]]:
    hits: list[dict] = []
    roots = [REPO_ROOT / "server", REPO_ROOT / "client" / "src"]
    for root in roots:
        if not root.exists():
            continue
        for p in root.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix not in SCAN_SUFFIXES:
                continue
            if "node_modules" in p.parts:
                continue
            if any(part in {"tests", "__tests__"} for part in p.parts):
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            for m in DANGEROUS_RX.finditer(text):
                ln = text.count("\n", 0, m.start()) + 1
                snippet = text.splitlines()[ln - 1][:120] if ln - 1 < len(text.splitlines()) else ""
                hits.append({
                    "path": str(p.relative_to(REPO_ROOT)).replace("\\", "/"),
                    "line": ln,
                    "snippet": snippet,
                })
    return len(hits), hits


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()

    bridge = HERE / "_secretscan.mjs"
    if not bridge.exists():
        print(f"Missing Node bridge: {bridge}", file=sys.stderr)
        return 2

    print(f"[eval_security] running Node bridge: {bridge.relative_to(REPO_ROOT)}")
    res = run(f'node "{bridge}"', cwd=REPO_ROOT, timeout=300)

    bridge_payload: dict = {}
    if res["exit_code"] == 0 and res["stdout"]:
        try:
            bridge_payload = json.loads(res["stdout"])
        except json.JSONDecodeError as e:
            print(f"  WARN: bridge stdout was not JSON: {e}", file=sys.stderr)

    findings = bridge_payload.get("findings", [])
    env_leaks = bridge_payload.get("env_files_tracked", [])
    files_scanned = bridge_payload.get("files_scanned", 0)

    dangerous_count, dangerous_hits = _dangerous_scan()

    signals = {
        "secret_findings": len(findings),
        "env_leak_count": len(env_leaks),
        "dangerous_api_count": dangerous_count,
        "files_scanned_for_secrets": files_scanned,
    }

    ok = (
        signals["secret_findings"] == 0
        and signals["env_leak_count"] == 0
        and signals["dangerous_api_count"] == 0
    )

    print(f"  files_scanned_for_secrets : {files_scanned}")
    print(f"  secret_findings           : {signals['secret_findings']}  (hard: 0)")
    print(f"  env_leak_count            : {signals['env_leak_count']}  (hard: 0)")
    print(f"  dangerous_api_count       : {signals['dangerous_api_count']}  (hard: must not grow)")
    if findings[:5]:
        print("  secret finding samples:")
        for f in findings[:5]:
            print(f"    {f.get('path')}:{f.get('lineNumber')}  {f.get('ruleId')}")
    if env_leaks:
        print("  env files tracked:")
        for e in env_leaks:
            print(f"    {e}")
    if dangerous_hits[:5]:
        print("  dangerous api samples:")
        for d in dangerous_hits[:5]:
            print(f"    {d['path']}:{d['line']}  {d['snippet']}")

    payload = {
        "name": "eval_security",
        "ok": ok,
        "exit_code": 0 if ok else 1,
        "duration_s": res["duration_s"],
        "signals": signals,
        "findings": findings[:500],
        "env_files_tracked": env_leaks,
        "dangerous_api_hits": dangerous_hits[:200],
        "bridge_exit_code": res["exit_code"],
        "bridge_stderr_tail": (res["stderr"] or "")[-1000:],
        "timestamp": now_stamp(),
    }

    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_security__{payload['timestamp']}.json"
    write_json(out, payload)
    print(f"Wrote: {out}")

    if args.write_baseline:
        baselines_path = OVERSIGHT / "state" / "baselines.json"
        baselines = {}
        if baselines_path.exists():
            try:
                baselines = json.loads(baselines_path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                baselines = {}
        for k, v in signals.items():
            baselines[k] = v
        write_json(baselines_path, baselines)
        print(f"Updated baselines: {baselines_path}")

    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
