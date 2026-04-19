r"""Session-spawn performance evaluator.

Static-analysis evaluator for the code paths that spawn the `claude` CLI
on behalf of the dashboard. Measures structural quality indicators that
correlate with time-to-first-response:

  * spawn_env_cache_hot            1 if the "scrub CLAUDECODE + CLAUDE_CODE_*"
                                   env cleanup is hoisted to module scope
                                   (cache once), 0 if it runs on every call.
  * spawn_bin_memoized             1 if the resolved CLI path is fetched via
                                   the lazy `getClaudeBin()` helper (which
                                   memoizes) rather than re-resolving per call.
  * spawn_uses_stream_json         1 if the one-shot `-p` path passes
                                   `--output-format stream-json` anywhere —
                                   a prerequisite for forwarding NDJSON
                                   chunks to the client.
  * spawn_early_ack                1 if the /new route replies with a 2xx
                                   BEFORE `await`-ing the full CLI promise
                                   (i.e., returns as soon as the session is
                                   registered, lets the CLI keep running in
                                   the background).
  * spawn_timeout_explicit         1 if every spawn site in the routes layer
                                   passes an explicit `timeoutMs`.
  * spawn_score                    0..100 rollup. Weighted by the "felt"
                                   perf impact: env_cache 15, bin_memoized
                                   10, stream_json 25, early_ack 40,
                                   timeout 10.

The evaluator is pure static analysis. A dynamic TTFT benchmark against
a fake `claude` shim lives in a follow-on evaluator (not this file) so
this one stays deterministic and CI-safe.

Usage:
  python .oversight/scripts/eval_session_spawn_quality.py
  python .oversight/scripts/eval_session_spawn_quality.py --write-baseline
  python .oversight/scripts/eval_session_spawn_quality.py --root /path
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import OVERSIGHT, REPO_ROOT, now_stamp, write_json  # type: ignore


# ---------------------------------------------------------------------------
# File targets
# ---------------------------------------------------------------------------

CLI_WRAPPER_CANDIDATES = ["server/claude-cli.js", "server/claude-cli.ts"]
ROUTE_CANDIDATES = ["server/routes/sessions.js", "server/routes/sessions.ts"]
PTY_CANDIDATES = ["server/pty-session.js", "server/pty-session.ts"]
BIN_CANDIDATES = ["server/lib/claude-bin.js", "server/lib/claude-bin.ts"]


# ---------------------------------------------------------------------------
# Regexes (named constants so tests can import)
# ---------------------------------------------------------------------------

# Env-cleanup loop: matches the characteristic `CLAUDECODE` + `CLAUDE_CODE_*`
# scrubbing regardless of exact variable names.
RX_ENV_SCRUB = re.compile(
    r"(?:CLAUDECODE.+CLAUDE_CODE_|CLAUDE_CODE_.+CLAUDECODE)",
    re.DOTALL,
)

# "Inside a function" vs "at module scope" — we look for the scrub site
# being preceded by a function keyword within ~600 chars (heuristic window;
# good enough for the two files we target).
RX_FN_BEFORE = re.compile(
    r"(?:function\s+\w+\s*\(|=>\s*\{|export\s+function\s+\w+|^\s*async\s+function)",
    re.MULTILINE,
)

RX_GET_CLAUDE_BIN = re.compile(r"\bgetClaudeBin\s*\(")
RX_DIRECT_RESOLVE_BIN = re.compile(r"\bresolveClaudeBin\s*\(")

RX_STREAM_JSON_FLAG = re.compile(
    r"['\"]--output-format['\"]\s*,\s*['\"]stream-json['\"]"
    r"|stream-json"
)

# POST /new route body: look for an `await runClaude(...)` directly followed
# by the `res.status(...).json(...)` final success reply. If the status is
# SENT BEFORE the await, that's early_ack = 1.
RX_POST_NEW_BLOCK = re.compile(
    r"router\.post\(\s*['\"]\/new['\"][\s\S]*?^\}\s*\)",
    re.MULTILINE,
)
RX_AWAIT_RUN_CLAUDE = re.compile(r"\bawait\s+runClaude\s*\(")
RX_RES_STATUS_SUCCESS = re.compile(r"res\.status\(\s*2\d\d\s*\)")

RX_SPAWN_CALL = re.compile(r"\brunClaude\s*\(")
RX_TIMEOUT_MS = re.compile(r"\btimeoutMs\s*:")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def read_text(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def first_existing(root: Path, candidates: list[str]) -> Path | None:
    for rel in candidates:
        p = root / rel
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------------------
# Signal producers
# ---------------------------------------------------------------------------


def scored_env_cache(cli_path: Path | None) -> int:
    """1 if CLAUDECODE/CLAUDE_CODE_ scrubbing is hoisted to module scope.

    Heuristic: find the scrub site; look at the 600-char window preceding it.
    If the window does NOT contain a function opener (function/=>/async)
    between the top of the file and the scrub site, the scrub is at module
    scope → cache-friendly. If a function opener appears between them, the
    scrub re-runs per call.
    """
    if not cli_path:
        return 0
    text = read_text(cli_path)
    m = RX_ENV_SCRUB.search(text)
    if not m:
        return 0
    head = text[: m.start()]
    # Find the last function opener before the scrub site.
    opener_hits = list(RX_FN_BEFORE.finditer(head))
    if not opener_hits:
        return 1  # scrub at module scope
    last_opener = opener_hits[-1].end()
    window = head[last_opener:]
    # If the opener has an unclosed `{`, the scrub lives inside that fn.
    # Count braces since the opener.
    open_braces = window.count("{")
    close_braces = window.count("}")
    inside_fn = open_braces > close_braces
    return 0 if inside_fn else 1


def scored_bin_memoized(cli_path: Path | None) -> int:
    """1 if the CLI wrapper uses getClaudeBin() (memoized), 0 if it uses
    the un-memoized resolveClaudeBin() directly."""
    if not cli_path:
        return 0
    text = read_text(cli_path)
    if RX_GET_CLAUDE_BIN.search(text):
        return 1
    if RX_DIRECT_RESOLVE_BIN.search(text):
        return 0
    return 0


def scored_stream_json(route_path: Path | None, cli_path: Path | None) -> int:
    """1 if any of the /new or fork paths request `--output-format stream-json`.

    Today the route hard-codes `json`, which buffers the whole response.
    `stream-json` lets the CLI emit NDJSON we can forward via SSE.
    """
    for p in (route_path, cli_path):
        if not p:
            continue
        if RX_STREAM_JSON_FLAG.search(read_text(p)):
            return 1
    return 0


def scored_early_ack(route_path: Path | None) -> int:
    """1 if POST /new replies 2xx BEFORE awaiting runClaude, 0 if it awaits
    the full CLI run before responding."""
    if not route_path:
        return 0
    text = read_text(route_path)
    m = RX_POST_NEW_BLOCK.search(text)
    if not m:
        return 0
    body = m.group(0)
    await_m = RX_AWAIT_RUN_CLAUDE.search(body)
    if not await_m:
        # No await at all → hard to call either way; treat as non-qualifying.
        return 0
    prefix = body[: await_m.start()]
    status_before = RX_RES_STATUS_SUCCESS.search(prefix)
    return 1 if status_before else 0


def scored_timeout_explicit(route_path: Path | None) -> int:
    """1 if every spawn call in the route layer passes a timeoutMs, 0 if any
    call omits it.
    """
    if not route_path:
        return 0
    text = read_text(route_path)
    hits = list(RX_SPAWN_CALL.finditer(text))
    if not hits:
        return 1  # nothing to check
    for m in hits:
        # Look forward ~400 chars — the call should specify timeoutMs in
        # the same options object.
        window = text[m.start() : m.start() + 400]
        if not RX_TIMEOUT_MS.search(window):
            return 0
    return 1


# ---------------------------------------------------------------------------
# Rollup + issue count
# ---------------------------------------------------------------------------


def roll_up_score(signals: dict) -> int:
    score = 0
    score += 15 * int(signals["spawn_env_cache_hot"])
    score += 10 * int(signals["spawn_bin_memoized"])
    score += 25 * int(signals["spawn_uses_stream_json"])
    score += 40 * int(signals["spawn_early_ack"])
    score += 10 * int(signals["spawn_timeout_explicit"])
    return max(0, min(100, score))


def count_issues(signals: dict) -> int:
    return sum(
        1
        for k in (
            "spawn_env_cache_hot",
            "spawn_bin_memoized",
            "spawn_uses_stream_json",
            "spawn_early_ack",
            "spawn_timeout_explicit",
        )
        if not signals[k]
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def evaluate(root: Path) -> dict:
    cli = first_existing(root, CLI_WRAPPER_CANDIDATES)
    route = first_existing(root, ROUTE_CANDIDATES)
    # PTY / bin paths aren't strictly needed for any signal today but we
    # record them so the hits block tells the author where the files live.
    pty = first_existing(root, PTY_CANDIDATES)
    binmod = first_existing(root, BIN_CANDIDATES)

    signals = {
        "spawn_env_cache_hot": scored_env_cache(cli),
        "spawn_bin_memoized": scored_bin_memoized(cli),
        "spawn_uses_stream_json": scored_stream_json(route, cli),
        "spawn_early_ack": scored_early_ack(route),
        "spawn_timeout_explicit": scored_timeout_explicit(route),
    }
    signals["spawn_score"] = roll_up_score(signals)
    signals["spawn_issue_count"] = count_issues(signals)

    hits = {
        "cli_wrapper": str(cli) if cli else None,
        "route": str(route) if route else None,
        "pty": str(pty) if pty else None,
        "bin_module": str(binmod) if binmod else None,
    }
    return {"signals": signals, "hits": hits}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--root", default=None)
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else REPO_ROOT
    result = evaluate(root)
    signals = result["signals"]

    print(f"[eval_session_spawn_quality] root={root}")
    print(f"  score           {signals['spawn_score']:>3} / 100")
    print(f"  open issues     {signals['spawn_issue_count']}")
    print(f"  env cache hot:          {'yes' if signals['spawn_env_cache_hot'] else 'NO'}")
    print(f"  bin memoized:           {'yes' if signals['spawn_bin_memoized'] else 'NO'}")
    print(f"  uses --stream-json:     {'yes' if signals['spawn_uses_stream_json'] else 'NO'}")
    print(f"  early-ack on /new:      {'yes' if signals['spawn_early_ack'] else 'NO'}")
    print(f"  every spawn has timeout:{'yes' if signals['spawn_timeout_explicit'] else 'NO'}")

    payload = {
        "name": "eval_session_spawn_quality",
        "ok": True,
        "exit_code": 0,
        "duration_s": 0,
        "signals": signals,
        "hits": result["hits"],
        "timestamp": now_stamp(),
    }
    out = (
        Path(args.out)
        if args.out
        else OVERSIGHT
        / "state"
        / "scores"
        / f"eval_session_spawn_quality__{payload['timestamp']}.json"
    )
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
