"""Route / test parity evaluator.

Reads every `server/routes/*.js` and extracts `router.<verb>('<path>', ...)`
declarations. Builds the full mounted URL using the `app.use('/api/x',
xRouter)` declarations in `server/index.js`. Then scans
`server/tests/routes/*.test.js` and `e2e/**/*.spec.js` for any mention of
the mounted path, and reports how many routes have zero test coverage.

Emits signals:
  route_total       — number of routes discovered
  uncovered_routes  — routes with no mention in any test file
  covered_routes    — routes mentioned in at least one test
  coverage_pct      — covered_routes / route_total * 100

Usage:
  python .oversight/scripts/eval_route_parity.py [--write-baseline] [--out file.json]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, write_json  # type: ignore

ROUTER_RX = re.compile(
    r"router\.(get|post|put|patch|delete)\s*\(\s*['\"]([^'\"]+)['\"]",
    re.IGNORECASE,
)
MOUNT_RX = re.compile(
    r"app\.use\s*\(\s*['\"](/[^'\"]+)['\"]\s*,\s*([A-Za-z_][A-Za-z0-9_]*)"
)
IMPORT_RX = re.compile(
    r"import\s+([A-Za-z_][A-Za-z0-9_]*)\s+from\s+['\"]\.\/routes\/([A-Za-z0-9_\-]+)(?:\.js)?['\"]"
)


def _load_mount_table(server_index: Path) -> dict[str, str]:
    """Return import_name -> mount_path from server/index.js."""
    if not server_index.exists():
        return {}
    text = server_index.read_text(encoding="utf-8", errors="replace")

    imports: dict[str, str] = {}
    for m in IMPORT_RX.finditer(text):
        imports[m.group(1)] = m.group(2)

    mounts: dict[str, str] = {}
    for m in MOUNT_RX.finditer(text):
        mount_path = m.group(1)
        var = m.group(2)
        route_file = imports.get(var)
        if route_file:
            mounts[route_file] = mount_path
    return mounts


def _normalize_path(mount: str, sub: str) -> str:
    if not sub.startswith("/"):
        sub = "/" + sub
    if sub == "/":
        sub = ""
    return (mount + sub).rstrip("/") or "/"


def _collect_routes() -> list[dict]:
    mounts = _load_mount_table(REPO_ROOT / "server" / "index.js")
    routes: list[dict] = []
    for p in sorted((REPO_ROOT / "server" / "routes").glob("*.js")):
        file_stem = p.stem
        mount = mounts.get(file_stem, f"/api/{file_stem}")
        text = p.read_text(encoding="utf-8", errors="replace")
        for m in ROUTER_RX.finditer(text):
            verb = m.group(1).upper()
            sub = m.group(2)
            full = _normalize_path(mount, sub)
            routes.append({
                "file": str(p.relative_to(REPO_ROOT)).replace("\\", "/"),
                "verb": verb,
                "mount": mount,
                "sub": sub,
                "full": full,
            })
    return routes


def _collect_test_text() -> str:
    parts: list[str] = []
    for d in ["server/tests/routes", "server/tests", "e2e"]:
        base = REPO_ROOT / d
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if p.suffix not in (".js", ".jsx", ".mjs", ".ts", ".tsx"):
                continue
            if "node_modules" in p.parts:
                continue
            try:
                parts.append(p.read_text(encoding="utf-8", errors="replace"))
            except OSError:
                continue
    return "\n".join(parts)


def _route_mentioned(route: dict, haystack: str) -> bool:
    """A route counts as 'covered' if either:
    - The full path (with placeholders stripped to '.*') appears verbatim, or
    - The combination of mount + sub (with params) appears in any test text.
    """
    # Strip :param placeholders to a looser match
    full = route["full"]
    # Treat /foo/:id  →  /foo/  prefix test
    base = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "", full).rstrip("/")
    if base and base in haystack:
        return True
    # Also allow the sub path alone (common in test files that mount their own router)
    sub = route["sub"]
    if sub and sub != "/" and sub in haystack:
        # avoid trivial matches on "/"
        stripped = re.sub(r":[A-Za-z_][A-Za-z0-9_]*", "", sub).rstrip("/")
        if stripped and stripped in haystack:
            return True
    if full in haystack:
        return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    args = parser.parse_args()

    routes = _collect_routes()
    haystack = _collect_test_text()

    covered = []
    uncovered = []
    for r in routes:
        if _route_mentioned(r, haystack):
            covered.append(r)
        else:
            uncovered.append(r)

    total = len(routes)
    signals = {
        "route_total": total,
        "covered_routes": len(covered),
        "uncovered_routes": len(uncovered),
        "route_coverage_pct": round((len(covered) / total) * 100, 2) if total else 0.0,
    }

    print(f"[eval_route_parity] {total} routes, {len(covered)} covered, {len(uncovered)} uncovered")
    if uncovered[:20]:
        print("  Uncovered (first 20):")
        for r in uncovered[:20]:
            print(f"    {r['verb']:<6} {r['full']:<40}  ({r['file']})")

    payload = {
        "name": "eval_route_parity",
        "ok": True,
        "exit_code": 0,
        "duration_s": 0,
        "signals": signals,
        "routes": routes,
        "uncovered": uncovered,
        "timestamp": now_stamp(),
    }
    out = Path(args.out) if args.out else OVERSIGHT / "state" / "scores" / f"eval_route_parity__{payload['timestamp']}.json"
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

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
