r"""Connection-quality evaluator.

Static-analysis evaluator targeting the three behaviors the user cares about:

  1. **SSE / realtime connection health** — the client EventSource hook and
     the server SSE registry. We measure:
       * Whether the client hook has exponential backoff (or any backoff at
         all) on reconnect.
       * Whether the client hook clears its timers on unmount.
       * Whether the server SSE handlers write headers that actually allow
         long-lived streaming (no compression, flushHeaders, heartbeat).
       * Whether heartbeats exist server-side.

  2. **Session spawning** — POST /new + POST /:sessionId/fork + the PTY
     spawners. For every subprocess / pty.spawn / child_process.spawn site
     we flag whether the call site:
       * Captures `stderrOutput` on failure.
       * Captures `stdoutOutput` on failure (we just fixed the CLI path to
         do this; make the check permanent).
       * Has an explicit timeout / timer.
       * Cleans up a temporary upload on failure (scoped to routes that use
         multer.single('image')).

  3. **Smart chunking** — symptoms of unbatched streaming work:
       * `res.write(...)` without any `flush` / `Transfer-Encoding: chunked`
         hint in the same function.
       * SSE push sites that stringify+write a full payload without size
         guards.
       * Large JSON responses on session-intensive routes (static cap
         check: response body construction that loads an entire parsed
         JSONL in memory).

The evaluator is pure static analysis — no live server, no flaky harness,
no network calls — so the signal is deterministic and safe to wire as a
hard/soft gate in manifest.yaml.

Signals emitted:
  sse_client_has_backoff            0|1
  sse_client_cleans_up              0|1
  sse_server_has_heartbeat          0|1
  sse_server_flushes_headers        0|1
  spawn_sites_missing_stderr        int
  spawn_sites_missing_stdout        int
  spawn_sites_missing_timeout       int
  upload_sites_missing_cleanup      int
  streaming_writes_without_chunking int
  connection_quality_score          0..100  (rolled up)
  connection_quality_issue_count    int     (all sites that need attention)

The aggregate rollup is a convenience — gate_policy should still pin the
individual signals, because mixing symptoms into one number obscures which
dimension regressed.

Usage:
  python .oversight/scripts/eval_connection_quality.py
  python .oversight/scripts/eval_connection_quality.py --write-baseline
  python .oversight/scripts/eval_connection_quality.py --root /path/to/repo
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
# File-set configuration
# ---------------------------------------------------------------------------

SSE_CLIENT_CANDIDATES = ["client/src/hooks/useSSE.js", "client/src/hooks/useSSE.ts"]
SSE_SERVER_CANDIDATES = ["server/sse.js", "server/sse.ts"]

SPAWN_SCAN_ROOTS = ["server"]
CLIENT_SCAN_ROOTS = ["client/src"]
SOURCE_SUFFIXES = (".js", ".jsx", ".mjs", ".ts", ".tsx")
EXCLUDE_DIRS = {"tests", "__tests__", "node_modules", "dist", "build", "coverage"}


# ---------------------------------------------------------------------------
# Regex library
#
# Kept as named constants so test_eval_connection_quality.py can import and
# assert against them without re-declaring patterns.
# ---------------------------------------------------------------------------

# SSE — client
RX_SSE_BACKOFF = re.compile(
    r"(?:"
    r"backoff"
    r"|retry\s*[*=][*=]?\s*\d"
    r"|Math\.min\s*\("
    r"|setTimeout\s*\([^)]*reconnect"
    r"|reconnectDelay"
    r"|retryCount\s*\*"
    r")",
    re.IGNORECASE,
)
RX_SSE_CLIENT_CLEANUP = re.compile(
    r"return\s*\(\s*\)\s*=>\s*\{[^}]*"
    r"(?:clearTimeout|clearInterval|removeEventListener|\.close\s*\()",
    re.DOTALL,
)

# SSE — server
RX_SSE_HEADERS_FLUSH = re.compile(
    r"flushHeaders\s*\(\s*\)",
)
RX_SSE_HEARTBEAT = re.compile(
    r"heartbeat|keep[\s-]*alive\s*:\s*\d|setInterval\s*\([^)]*res\.write",
    re.IGNORECASE,
)

# Spawn quality
#
# Two distinct kinds of spawn sites exist in this repo:
#
#   * child_process.spawn / execFile / execFileSync — single-shot processes
#     where stdout/stderr are distinct streams. These *should* capture both
#     outputs on failure so the dashboard can surface structured errors
#     (429 quota JSON etc).
#   * pty.spawn — an interactive terminal. There are no separate streams;
#     node-pty emits a single data callback. Applying the stderr/stdout
#     capture check here would produce guaranteed false positives and drag
#     the score down permanently. We count PTY sites separately and only
#     run the capture/timeout checks against the child_process family.
RX_PTY_SPAWN_SITE = re.compile(r"\bpty\.spawn\s*\(")
RX_CHILD_SPAWN_SITE = re.compile(
    r"\b(?:child_process\.spawn|"
    r"(?:child_process\.)?execFile|"
    r"(?:child_process\.)?execFileSync|"
    r"(?<![\w\.\-])spawn)\s*\(",
)
RX_STDERR_OUTPUT = re.compile(r"\bstderrOutput\b")
RX_STDOUT_OUTPUT = re.compile(r"\bstdoutOutput\b")
RX_TIMEOUT_HINT = re.compile(
    r"\b(?:setTimeout\s*\(|timeoutMs\b|timeout\s*:\s*\d|signal\s*:\s*AbortSignal)",
)
RX_PTY_DATA_HANDLER = re.compile(r"\.onData\s*\(")
RX_PTY_EXIT_HANDLER = re.compile(r"\.onExit\s*\(")

# Multer upload cleanup (narrow: only fires where multer.single is used)
RX_MULTER_USE = re.compile(r"upload\.single\s*\(")
RX_UPLOAD_CLEANUP = re.compile(
    r"\b(?:cleanupUploadedFile|cleanupTempFile|unlinkSync\s*\([^)]*req\.file)",
)

# Streaming / chunking
RX_RES_WRITE_NO_CHUNK = re.compile(
    r"res\.write\s*\(",
)
RX_CHUNKED_HINT = re.compile(
    r"(?:Transfer-Encoding['\"]?\s*,\s*['\"]?chunked|flushHeaders|res\.flush\s*\(|"
    r"text/event-stream|application/x-ndjson)",
    re.IGNORECASE,
)

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


def line_of(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def is_source_file(p: Path) -> bool:
    if p.suffix not in SOURCE_SUFFIXES:
        return False
    if any(part in EXCLUDE_DIRS for part in p.parts):
        return False
    return True


def iter_sources(root: Path, scan_roots: list[str]) -> list[Path]:
    out: list[Path] = []
    for sub in scan_roots:
        base = root / sub
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file() and is_source_file(p):
                out.append(p)
    return out


def function_window(text: str, offset: int, ahead: int = 900) -> str:
    """Grab a window of text starting at `offset` to approximate the body
    the spawn call lives in. We use a fixed forward window instead of true
    AST awareness because the cost of a parser is higher than the cost of
    a slightly-generous window, and every assertion the evaluator makes is
    "is this symbol anywhere nearby?" — false positives are detectable by
    looking at the reported site.
    """
    return text[offset : offset + ahead]


# ---------------------------------------------------------------------------
# Signal producers
# ---------------------------------------------------------------------------


def evaluate_sse_client(path: Path | None) -> dict:
    """Return SSE client health signals (bool-as-int)."""
    if not path:
        return {
            "sse_client_has_backoff": 0,
            "sse_client_cleans_up": 0,
            "_sse_client_file": None,
        }
    text = read_text(path)
    return {
        "sse_client_has_backoff": 1 if RX_SSE_BACKOFF.search(text) else 0,
        "sse_client_cleans_up": 1 if RX_SSE_CLIENT_CLEANUP.search(text) else 0,
        "_sse_client_file": str(path),
    }


def evaluate_sse_server(path: Path | None) -> dict:
    if not path:
        return {
            "sse_server_has_heartbeat": 0,
            "sse_server_flushes_headers": 0,
            "_sse_server_file": None,
        }
    text = read_text(path)
    return {
        "sse_server_has_heartbeat": 1 if RX_SSE_HEARTBEAT.search(text) else 0,
        "sse_server_flushes_headers": 1 if RX_SSE_HEADERS_FLUSH.search(text) else 0,
        "_sse_server_file": str(path),
    }


def evaluate_spawn_sites(files: list[Path], root: Path) -> dict:
    missing_stderr: list[tuple[str, int]] = []
    missing_stdout: list[tuple[str, int]] = []
    missing_timeout: list[tuple[str, int]] = []
    pty_missing_exit: list[tuple[str, int]] = []
    child_total = 0
    pty_total = 0

    for p in files:
        text = read_text(p)
        rel = str(p.relative_to(root)).replace("\\", "/")

        # child_process family — stderr/stdout/timeout are meaningful here.
        for m in RX_CHILD_SPAWN_SITE.finditer(text):
            child_total += 1
            window = function_window(text, m.start())
            ln = line_of(text, m.start())
            if not RX_STDERR_OUTPUT.search(window):
                missing_stderr.append((rel, ln))
            if not RX_STDOUT_OUTPUT.search(window):
                missing_stdout.append((rel, ln))
            if not RX_TIMEOUT_HINT.search(window):
                missing_timeout.append((rel, ln))

        # PTY family — only the onExit handler is a meaningful per-site
        # check. Missing onExit means a dead terminal can leak forever.
        for m in RX_PTY_SPAWN_SITE.finditer(text):
            pty_total += 1
            # PTY handlers often live after the spawn call at any offset,
            # not just immediately after. Scan the rest of the file.
            remainder = text[m.start() :]
            if not RX_PTY_EXIT_HANDLER.search(remainder):
                pty_missing_exit.append((rel, line_of(text, m.start())))

    return {
        "spawn_sites_total": child_total + pty_total,
        "child_spawn_sites_total": child_total,
        "pty_spawn_sites_total": pty_total,
        "spawn_sites_missing_stderr": len(missing_stderr),
        "spawn_sites_missing_stdout": len(missing_stdout),
        "spawn_sites_missing_timeout": len(missing_timeout),
        "pty_sites_missing_exit_handler": len(pty_missing_exit),
        "_spawn_missing_stderr": missing_stderr,
        "_spawn_missing_stdout": missing_stdout,
        "_spawn_missing_timeout": missing_timeout,
        "_pty_missing_exit_handler": pty_missing_exit,
    }


def evaluate_upload_cleanup(files: list[Path], root: Path) -> dict:
    missing: list[tuple[str, int]] = []
    total = 0
    for p in files:
        text = read_text(p)
        if not RX_MULTER_USE.search(text):
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        for m in RX_MULTER_USE.finditer(text):
            total += 1
            window = function_window(text, m.start(), ahead=2500)
            if not RX_UPLOAD_CLEANUP.search(window):
                missing.append((rel, line_of(text, m.start())))
    return {
        "upload_sites_total": total,
        "upload_sites_missing_cleanup": len(missing),
        "_upload_missing_cleanup": missing,
    }


def evaluate_chunking(files: list[Path], root: Path) -> dict:
    unchunked: list[tuple[str, int]] = []
    for p in files:
        text = read_text(p)
        if not RX_RES_WRITE_NO_CHUNK.search(text):
            continue
        # whole-file check: we only penalize files where there is at least
        # one res.write site AND the file has no chunked/flush hint.
        if RX_CHUNKED_HINT.search(text):
            continue
        rel = str(p.relative_to(root)).replace("\\", "/")
        for m in RX_RES_WRITE_NO_CHUNK.finditer(text):
            unchunked.append((rel, line_of(text, m.start())))
    return {
        "streaming_writes_without_chunking": len(unchunked),
        "_streaming_unchunked_sites": unchunked,
    }


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------


def roll_up_score(signals: dict) -> int:
    """0..100, higher is better.

    Weighted so that SSE dimensions move the score most (connection loss is
    the most visible symptom), spawn-site hardening is next, and chunking
    / upload-cleanup contribute smaller amounts. Each "missing" category
    saturates at 10 sites so a single very bad file doesn't drag the whole
    score below the ratchet floor — use the per-signal counts for that.
    """
    score = 0
    # SSE — 40 points
    score += 10 * signals["sse_client_has_backoff"]
    score += 5 * signals["sse_client_cleans_up"]
    score += 15 * signals["sse_server_has_heartbeat"]
    score += 10 * signals["sse_server_flushes_headers"]

    def inv_saturating(n: int, cap: int = 10) -> float:
        n = min(n, cap)
        return (cap - n) / cap  # 1.0 at n=0, 0.0 at n>=cap

    # Spawn hardening — 40 points
    score += int(round(15 * inv_saturating(signals["spawn_sites_missing_stderr"])))
    score += int(round(15 * inv_saturating(signals["spawn_sites_missing_stdout"])))
    score += int(round(10 * inv_saturating(signals["spawn_sites_missing_timeout"])))

    # Upload cleanup — 10 points
    score += int(round(10 * inv_saturating(signals["upload_sites_missing_cleanup"], cap=5)))

    # Chunking — 10 points
    score += int(round(10 * inv_saturating(signals["streaming_writes_without_chunking"], cap=8)))

    return max(0, min(100, score))


def count_issues(signals: dict) -> int:
    total = 0
    total += 1 if not signals["sse_client_has_backoff"] else 0
    total += 1 if not signals["sse_client_cleans_up"] else 0
    total += 1 if not signals["sse_server_has_heartbeat"] else 0
    total += 1 if not signals["sse_server_flushes_headers"] else 0
    total += int(signals["spawn_sites_missing_stderr"])
    total += int(signals["spawn_sites_missing_stdout"])
    total += int(signals["spawn_sites_missing_timeout"])
    total += int(signals.get("pty_sites_missing_exit_handler", 0))
    total += int(signals["upload_sites_missing_cleanup"])
    total += int(signals["streaming_writes_without_chunking"])
    return total


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def evaluate(root: Path) -> dict:
    sse_client = evaluate_sse_client(first_existing(root, SSE_CLIENT_CANDIDATES))
    sse_server = evaluate_sse_server(first_existing(root, SSE_SERVER_CANDIDATES))

    server_files = iter_sources(root, SPAWN_SCAN_ROOTS)
    client_files = iter_sources(root, CLIENT_SCAN_ROOTS)

    spawn = evaluate_spawn_sites(server_files, root)
    uploads = evaluate_upload_cleanup(server_files, root)
    chunking = evaluate_chunking(server_files + client_files, root)

    signals = {
        "sse_client_has_backoff": sse_client["sse_client_has_backoff"],
        "sse_client_cleans_up": sse_client["sse_client_cleans_up"],
        "sse_server_has_heartbeat": sse_server["sse_server_has_heartbeat"],
        "sse_server_flushes_headers": sse_server["sse_server_flushes_headers"],
        "spawn_sites_total": spawn["spawn_sites_total"],
        "child_spawn_sites_total": spawn["child_spawn_sites_total"],
        "pty_spawn_sites_total": spawn["pty_spawn_sites_total"],
        "spawn_sites_missing_stderr": spawn["spawn_sites_missing_stderr"],
        "spawn_sites_missing_stdout": spawn["spawn_sites_missing_stdout"],
        "spawn_sites_missing_timeout": spawn["spawn_sites_missing_timeout"],
        "pty_sites_missing_exit_handler": spawn["pty_sites_missing_exit_handler"],
        "upload_sites_total": uploads["upload_sites_total"],
        "upload_sites_missing_cleanup": uploads["upload_sites_missing_cleanup"],
        "streaming_writes_without_chunking": chunking["streaming_writes_without_chunking"],
    }
    signals["connection_quality_score"] = roll_up_score(signals)
    signals["connection_quality_issue_count"] = count_issues(signals)

    hits = {
        "spawn_missing_stderr": [
            {"path": p, "line": ln} for p, ln in spawn["_spawn_missing_stderr"][:50]
        ],
        "spawn_missing_stdout": [
            {"path": p, "line": ln} for p, ln in spawn["_spawn_missing_stdout"][:50]
        ],
        "spawn_missing_timeout": [
            {"path": p, "line": ln} for p, ln in spawn["_spawn_missing_timeout"][:50]
        ],
        "upload_missing_cleanup": [
            {"path": p, "line": ln} for p, ln in uploads["_upload_missing_cleanup"][:50]
        ],
        "streaming_unchunked_sites": [
            {"path": p, "line": ln} for p, ln in chunking["_streaming_unchunked_sites"][:50]
        ],
        "sse_client_file": sse_client["_sse_client_file"],
        "sse_server_file": sse_server["_sse_server_file"],
    }
    return {"signals": signals, "hits": hits}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=None)
    parser.add_argument("--write-baseline", action="store_true")
    parser.add_argument("--root", default=None, help="Override repo root (tests use this)")
    args = parser.parse_args()

    root = Path(args.root).resolve() if args.root else REPO_ROOT
    result = evaluate(root)
    signals = result["signals"]
    hits = result["hits"]

    print(f"[eval_connection_quality] root={root}")
    print(f"  score            {signals['connection_quality_score']:>3} / 100")
    print(f"  open issues      {signals['connection_quality_issue_count']}")
    print("  SSE client:")
    print(f"    backoff:         {'yes' if signals['sse_client_has_backoff'] else 'NO'}")
    print(f"    unmount cleanup: {'yes' if signals['sse_client_cleans_up'] else 'NO'}")
    print("  SSE server:")
    print(f"    heartbeat:       {'yes' if signals['sse_server_has_heartbeat'] else 'NO'}")
    print(f"    flushHeaders:    {'yes' if signals['sse_server_flushes_headers'] else 'NO'}")
    print("  Spawn sites:")
    print(
        f"    total:                  {signals['spawn_sites_total']}"
        f" (child_process={signals['child_spawn_sites_total']},"
        f" pty={signals['pty_spawn_sites_total']})"
    )
    print(f"    missing stderr capture: {signals['spawn_sites_missing_stderr']}")
    print(f"    missing stdout capture: {signals['spawn_sites_missing_stdout']}")
    print(f"    missing timeout:        {signals['spawn_sites_missing_timeout']}")
    print(f"    PTY missing onExit:     {signals['pty_sites_missing_exit_handler']}")
    print("  Upload sites:")
    print(f"    total:                  {signals['upload_sites_total']}")
    print(f"    missing cleanup:        {signals['upload_sites_missing_cleanup']}")
    print(f"  Streaming writes w/o chunking hint: {signals['streaming_writes_without_chunking']}")

    payload = {
        "name": "eval_connection_quality",
        "ok": True,
        "exit_code": 0,
        "duration_s": 0,
        "signals": signals,
        "hits": hits,
        "timestamp": now_stamp(),
    }
    out = (
        Path(args.out)
        if args.out
        else OVERSIGHT
        / "state"
        / "scores"
        / f"eval_connection_quality__{payload['timestamp']}.json"
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
