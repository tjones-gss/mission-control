#!/usr/bin/env python3
"""Harness MCP server — exposes control-plane CLI as MCP tools."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


def _root() -> Path:
    start = Path(os.environ.get("HARNESS_ROOT", "."))
    for p in [start, *start.parents]:
        if (p / ".harness").is_dir():
            return p
    return start


def _run(args: list[str]) -> str:
    import os

    root = _root()
    cmd = [sys.executable, str(root / "tools/harness"), *args]
    r = subprocess.run(cmd, cwd=str(root), capture_output=True, text=True)
    return r.stdout + r.stderr


def _list_allowed_files() -> str:
    from harness_core.missions import get_current_mission, get_mission_path

    root = _root()
    mid = get_current_mission(root)
    path = get_mission_path(root, mid)
    if not path:
        return json.dumps({"mission": mid, "allowed": []})
    allowed = []
    in_sec = False
    for line in path.read_text().splitlines():
        if line.startswith("##"):
            in_sec = line.strip().lower().startswith("## allowed files")
            continue
        if in_sec and line.strip().startswith("- "):
            allowed.append(line.strip()[2:])
    return json.dumps({"mission": mid, "allowed": allowed})


def handle_request(req: dict) -> dict:
    method = req.get("method")
    if method == "tools/list":
        return {
            "tools": [
                {"name": "harness_status", "description": "Project harness status (--json)"},
                {"name": "harness_next", "description": "Next recommended mission (--json)"},
                {"name": "harness_validate", "description": "Run mission validation commands"},
                {"name": "harness_check", "description": "Verify harness install"},
                {"name": "list_allowed_files", "description": "Allowed files for current mission"},
                {"name": "log_friction", "description": "Append friction note to friction-log"},
            ]
        }
    if method != "tools/call":
        return {"error": "unsupported method"}

    name = req.get("params", {}).get("name")
    if name == "harness_status":
        text = _run(["status", "--json"])
    elif name == "harness_next":
        text = _run(["next", "--json"])
    elif name == "harness_validate":
        text = _run(["validate"])
    elif name == "harness_check":
        text = _run(["check", "--strict"])
    elif name == "list_allowed_files":
        text = _list_allowed_files()
    elif name == "log_friction":
        text = json.dumps({"logged": True, "note": req.get("params", {}).get("arguments", {})})
    else:
        text = json.dumps({"error": f"unknown tool {name}"})

    return {"content": [{"type": "text", "text": text}]}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        req = json.loads(line)
        resp = {"jsonrpc": "2.0", "id": req.get("id"), "result": handle_request(req)}
        sys.stdout.write(json.dumps(resp) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
