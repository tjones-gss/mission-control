"""Shared helpers for .oversight scripts."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
OVERSIGHT = HERE.parent
REPO_ROOT = OVERSIGHT.parent

sys.path.insert(0, str(HERE))
import _yaml  # noqa: E402


def load_manifest() -> dict[str, Any]:
    return _yaml.load_file(str(OVERSIGHT / "manifest.yaml"))


def load_domain(name: str) -> dict[str, Any]:
    path = OVERSIGHT / "domains" / f"{name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Unknown domain: {name} (expected {path})")
    return _yaml.load_file(str(path))


def list_domain_names() -> list[str]:
    d = OVERSIGHT / "domains"
    return sorted(p.stem for p in d.glob("*.yaml"))


def load_job(job_path: Path) -> dict[str, Any]:
    return _yaml.load_file(str(job_path))


def list_jobs(bucket: str = "active") -> list[Path]:
    assert bucket in ("active", "backlog", "templates")
    d = OVERSIGHT / "jobs" / bucket
    if not d.exists():
        return []
    return sorted(p for p in d.glob("*.yaml") if p.is_file())


def run(cmd: str, cwd: Path | None = None, timeout: int = 600) -> dict[str, Any]:
    """Run a shell command, capture output, return structured result."""
    start = time.time()
    cwd = cwd or REPO_ROOT
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return {
            "cmd": cmd,
            "cwd": str(cwd),
            "exit_code": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "duration_s": round(time.time() - start, 3),
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "cmd": cmd,
            "cwd": str(cwd),
            "exit_code": 124,
            "stdout": (e.stdout or "") if isinstance(e.stdout, str) else "",
            "stderr": (e.stderr or "") if isinstance(e.stderr, str) else "",
            "duration_s": round(time.time() - start, 3),
            "timed_out": True,
        }


def count_vitest_failures(text: str) -> int:
    """Heuristic parser for Vitest summary output."""
    if not text:
        return 0
    # e.g. "Tests  3 failed | 57 passed (60)"
    m = re.search(r"Tests\s+(?:.*?)(\d+)\s+failed", text)
    if m:
        return int(m.group(1))
    # Newer vitest sometimes prints "Failed Tests  N"
    m = re.search(r"Failed Tests\s+(\d+)", text)
    if m:
        return int(m.group(1))
    return 0


def count_playwright_failures(text: str) -> int:
    if not text:
        return 0
    m = re.search(r"(\d+)\s+failed", text)
    if m:
        return int(m.group(1))
    return 0


def count_prettier_failures(text: str) -> int:
    """Prettier --check prints 'Code style issues found in N files' or lists files."""
    if not text:
        return 0
    m = re.search(r"Code style issues found in (\d+) files", text)
    if m:
        return int(m.group(1))
    # fallback: count [warn] lines which typically tag one file each
    return len(re.findall(r"^\[warn\]\s+\S", text, re.M))


def path_matches_glob(path: str, pattern: str) -> bool:
    """Match a path against a simple glob supporting ** and *."""
    import fnmatch

    p = path.replace("\\", "/")
    pat = pattern.replace("\\", "/")
    if pat.endswith("/"):
        pat = pat + "**"
    # fnmatch doesn't handle ** well; expand
    pat_regex = re.escape(pat)
    pat_regex = pat_regex.replace(r"\*\*", ".*").replace(r"\*", "[^/]*")
    pat_regex = "^" + pat_regex + "$"
    if re.match(pat_regex, p):
        return True
    # also try plain fnmatch as a looser fallback
    return fnmatch.fnmatch(p, pattern)


def is_forbidden(path: str, forbidden: list[str]) -> bool:
    for pat in forbidden:
        if path_matches_glob(path, pat):
            return True
    return False


def git_changed_files(cwd: Path | None = None) -> list[str]:
    r = run("git status --porcelain -uall", cwd=cwd, timeout=30)
    if r["exit_code"] != 0:
        return []
    files: list[str] = []
    for line in r["stdout"].splitlines():
        if len(line) < 4:
            continue
        # XY path  (rename: "R  old -> new")
        path = line[3:]
        if " -> " in path:
            path = path.split(" -> ", 1)[1]
        files.append(path.strip().strip('"'))
    return files


def is_git_work_tree(path: Path) -> bool:
    """True if `path` looks like a git checkout (file or dir `.git`).

    Worktrees use a `.git` *file* pointing at the main repo; bare repos are not supported.
    """
    try:
        return (path.resolve() / ".git").exists()
    except OSError:
        return False


def ensure_dir(p: Path) -> Path:
    p.mkdir(parents=True, exist_ok=True)
    return p


def write_json(path: Path, data: Any) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return default


def now_stamp() -> str:
    return time.strftime("%Y%m%dT%H%M%S")


def load_baselines() -> dict[str, Any]:
    """Load .oversight/state/baselines.json (empty dict if missing)."""
    path = OVERSIGHT / "state" / "baselines.json"
    return read_json(path, {}) or {}


def extract_signals(doc: dict) -> dict[str, Any]:
    """Pull a flat signal dictionary out of any eval result shape.

    Handles:
      - Standalone eval_*.py docs (top-level `signals`)
      - run_eval.py docs (top-level `aggregate` + per-result `signals`)
    """
    out: dict[str, Any] = {}
    if isinstance(doc, dict):
        top = doc.get("signals")
        if isinstance(top, dict):
            for k, v in top.items():
                out[k] = v
        agg = doc.get("aggregate")
        if isinstance(agg, dict):
            for k, v in agg.items():
                out.setdefault(k, v)
        results = doc.get("results")
        if isinstance(results, list):
            for r in results:
                sigs = r.get("signals") if isinstance(r, dict) else None
                if isinstance(sigs, dict):
                    for k, v in sigs.items():
                        if k in ("vitest_failures", "playwright_failures", "prettier_failures"):
                            out[k + "_total"] = out.get(k + "_total", 0) + (v or 0)
                        else:
                            out.setdefault(k, v)
    return out


def load_gate_policy() -> dict[str, str]:
    """Return the manifest's gate_policy map: signal_name -> 'hard'|'soft'|'advisory'."""
    m = load_manifest()
    raw = m.get("gate_policy") or {}
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v).lower() for k, v in raw.items()}
