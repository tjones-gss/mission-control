"""Unit tests for eval_connection_quality.

Uses stdlib unittest + temp directories. Each test case builds a minimal
fake repo layout and runs the evaluator against it so we can assert on
every signal independently without depending on the real repo.

Run:
  python .oversight/scripts/test_eval_connection_quality.py
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import eval_connection_quality as ecq  # type: ignore


# ---------------------------------------------------------------------------
# Fixture builder
# ---------------------------------------------------------------------------


def _write(root: Path, rel: str, body: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")
    return p


def _build_min_repo(tmp: Path, *, sse_client: str = "", sse_server: str = "") -> None:
    """Create just enough skeleton for the evaluator to find something."""
    if sse_client:
        _write(tmp, "client/src/hooks/useSSE.js", sse_client)
    if sse_server:
        _write(tmp, "server/sse.js", sse_server)
    # Stub a source file so iter_sources has something to walk even in empty
    # scenarios — keeps iteration deterministic.
    _write(tmp, "server/index.js", "// placeholder\n")


# ---------------------------------------------------------------------------
# SSE client signals
# ---------------------------------------------------------------------------


class SseClientSignals(unittest.TestCase):
    def test_backoff_detected_via_math_min(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_client=(
                    "export function useSSE() {\n"
                    "  let retryCount = 0\n"
                    "  const delay = Math.min(1000 * 2 ** retryCount, 30000)\n"
                    "  return () => { es.close() }\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_client_has_backoff"], 1)

    def test_no_backoff_on_bare_reconnect(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_client=(
                    "export function useSSE() {\n"
                    "  es.onerror = () => { es = new EventSource('/stream') }\n"
                    "  return () => { es.close() }\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_client_has_backoff"], 0)

    def test_cleanup_detected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_client=(
                    "export function useSSE() {\n"
                    "  const id = setTimeout(fn, 1000)\n"
                    "  return () => { clearTimeout(id); es.close() }\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_client_cleans_up"], 1)

    def test_missing_cleanup_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_client=(
                    "export function useSSE() {\n"
                    "  const es = new EventSource('/stream')\n"
                    "  es.onmessage = (m) => console.log(m)\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_client_cleans_up"], 0)

    def test_missing_sse_client_file(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)  # no sse_client
            result = ecq.evaluate(tmp)
            # Both signals should be 0 (defensively treat missing as worst case)
            self.assertEqual(result["signals"]["sse_client_has_backoff"], 0)
            self.assertEqual(result["signals"]["sse_client_cleans_up"], 0)


# ---------------------------------------------------------------------------
# SSE server signals
# ---------------------------------------------------------------------------


class SseServerSignals(unittest.TestCase):
    def test_heartbeat_and_flush_detected(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_server=(
                    "export function streamHandler(req, res) {\n"
                    "  res.writeHead(200, { 'Content-Type': 'text/event-stream' })\n"
                    "  res.flushHeaders()\n"
                    "  const heartbeat = setInterval(() => res.write(': keep-alive\\n\\n'), 15000)\n"
                    "  req.on('close', () => clearInterval(heartbeat))\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_server_has_heartbeat"], 1)
            self.assertEqual(result["signals"]["sse_server_flushes_headers"], 1)

    def test_no_heartbeat_no_flush(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(
                tmp,
                sse_server=(
                    "export function streamHandler(req, res) {\n"
                    "  res.writeHead(200, { 'Content-Type': 'text/event-stream' })\n"
                    "  res.write('data: {}\\n\\n')\n"
                    "}\n"
                ),
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["sse_server_has_heartbeat"], 0)
            self.assertEqual(result["signals"]["sse_server_flushes_headers"], 0)


# ---------------------------------------------------------------------------
# Spawn site classification
# ---------------------------------------------------------------------------


class SpawnClassification(unittest.TestCase):
    def test_child_process_spawn_with_full_capture(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/cli.js",
                "import { spawn } from 'child_process'\n"
                "export function run() {\n"
                "  const child = spawn('claude', [], { timeout: 120_000 })\n"
                "  let stderr = ''; let stdout = ''\n"
                "  child.stderr.on('data', (c) => { stderr += c })\n"
                "  child.stdout.on('data', (c) => { stdout += c })\n"
                "  child.on('close', (code) => {\n"
                "    const err = new Error('boom')\n"
                "    err.stderrOutput = stderr\n"
                "    err.stdoutOutput = stdout\n"
                "    throw err\n"
                "  })\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            sig = result["signals"]
            self.assertEqual(sig["child_spawn_sites_total"], 1)
            self.assertEqual(sig["spawn_sites_missing_stderr"], 0)
            self.assertEqual(sig["spawn_sites_missing_stdout"], 0)
            self.assertEqual(sig["spawn_sites_missing_timeout"], 0)

    def test_child_process_spawn_missing_everything(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/bad.js",
                "import { spawn } from 'child_process'\n"
                "export function run() {\n"
                "  const child = spawn('some-cli', [])\n"
                "  child.on('close', () => {})\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            sig = result["signals"]
            self.assertEqual(sig["child_spawn_sites_total"], 1)
            self.assertEqual(sig["spawn_sites_missing_stderr"], 1)
            self.assertEqual(sig["spawn_sites_missing_stdout"], 1)
            self.assertEqual(sig["spawn_sites_missing_timeout"], 1)

    def test_pty_spawn_does_not_trigger_stderr_checks(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/pty-session.js",
                "import * as pty from 'node-pty'\n"
                "export function start() {\n"
                "  const term = pty.spawn('claude', [], { cols: 200, rows: 50 })\n"
                "  term.onData((data) => handleOutput(data))\n"
                "  term.onExit(({ exitCode }) => handleExit(exitCode))\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            sig = result["signals"]
            # PTY site counted separately, not on the stderr/stdout checks.
            self.assertEqual(sig["child_spawn_sites_total"], 0)
            self.assertEqual(sig["pty_spawn_sites_total"], 1)
            self.assertEqual(sig["spawn_sites_missing_stderr"], 0)
            self.assertEqual(sig["spawn_sites_missing_stdout"], 0)
            self.assertEqual(sig["spawn_sites_missing_timeout"], 0)
            self.assertEqual(sig["pty_sites_missing_exit_handler"], 0)

    def test_pty_spawn_missing_onexit_is_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/pty-session.js",
                "import * as pty from 'node-pty'\n"
                "export function start() {\n"
                "  const term = pty.spawn('claude', [])\n"
                "  term.onData((data) => handleOutput(data))\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            sig = result["signals"]
            self.assertEqual(sig["pty_sites_missing_exit_handler"], 1)


# ---------------------------------------------------------------------------
# Upload cleanup
# ---------------------------------------------------------------------------


class UploadCleanup(unittest.TestCase):
    def test_upload_with_cleanup_not_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/routes/upload.js",
                "router.post('/msg', upload.single('image'), (req, res) => {\n"
                "  try { doWork() } catch (e) { cleanupUploadedFile(req); res.status(500).end() }\n"
                "})\n",
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["upload_sites_total"], 1)
            self.assertEqual(result["signals"]["upload_sites_missing_cleanup"], 0)

    def test_upload_without_cleanup_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/routes/upload.js",
                "router.post('/msg', upload.single('image'), (req, res) => {\n"
                "  doWork(); res.status(202).json({ ok: true })\n"
                "})\n",
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["upload_sites_total"], 1)
            self.assertEqual(result["signals"]["upload_sites_missing_cleanup"], 1)


# ---------------------------------------------------------------------------
# Chunking / streaming
# ---------------------------------------------------------------------------


class Chunking(unittest.TestCase):
    def test_sse_handler_with_chunked_hint_not_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/sse.js",
                "export function stream(req, res) {\n"
                "  res.writeHead(200, { 'Content-Type': 'text/event-stream' })\n"
                "  res.flushHeaders()\n"
                "  res.write('data: {}\\n\\n')\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            self.assertEqual(result["signals"]["streaming_writes_without_chunking"], 0)

    def test_res_write_without_chunk_hint_flagged(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp)
            _write(
                tmp,
                "server/routes/bulk.js",
                "export function bulk(req, res) {\n"
                "  const payload = JSON.stringify(hugeArray)\n"
                "  res.write(payload)\n"
                "  res.end()\n"
                "}\n",
            )
            result = ecq.evaluate(tmp)
            self.assertGreaterEqual(result["signals"]["streaming_writes_without_chunking"], 1)


# ---------------------------------------------------------------------------
# Aggregate score
# ---------------------------------------------------------------------------


class AggregateScore(unittest.TestCase):
    def test_all_green_scores_100(self) -> None:
        signals = {
            "sse_client_has_backoff": 1,
            "sse_client_cleans_up": 1,
            "sse_server_has_heartbeat": 1,
            "sse_server_flushes_headers": 1,
            "spawn_sites_missing_stderr": 0,
            "spawn_sites_missing_stdout": 0,
            "spawn_sites_missing_timeout": 0,
            "upload_sites_missing_cleanup": 0,
            "streaming_writes_without_chunking": 0,
        }
        self.assertEqual(ecq.roll_up_score(signals), 100)

    def test_all_red_scores_zero(self) -> None:
        signals = {
            "sse_client_has_backoff": 0,
            "sse_client_cleans_up": 0,
            "sse_server_has_heartbeat": 0,
            "sse_server_flushes_headers": 0,
            "spawn_sites_missing_stderr": 20,
            "spawn_sites_missing_stdout": 20,
            "spawn_sites_missing_timeout": 20,
            "upload_sites_missing_cleanup": 20,
            "streaming_writes_without_chunking": 20,
        }
        self.assertEqual(ecq.roll_up_score(signals), 0)

    def test_symmetric_improvement_raises_score(self) -> None:
        base = {
            "sse_client_has_backoff": 0,
            "sse_client_cleans_up": 1,
            "sse_server_has_heartbeat": 0,
            "sse_server_flushes_headers": 0,
            "spawn_sites_missing_stderr": 3,
            "spawn_sites_missing_stdout": 3,
            "spawn_sites_missing_timeout": 3,
            "upload_sites_missing_cleanup": 0,
            "streaming_writes_without_chunking": 0,
        }
        improved = dict(base)
        improved["sse_client_has_backoff"] = 1
        improved["sse_server_has_heartbeat"] = 1
        self.assertGreater(ecq.roll_up_score(improved), ecq.roll_up_score(base))


# ---------------------------------------------------------------------------
# Issue counter + CLI smoke
# ---------------------------------------------------------------------------


class IssueCountAndCli(unittest.TestCase):
    def test_issue_counter_sums_correctly(self) -> None:
        signals = {
            "sse_client_has_backoff": 0,
            "sse_client_cleans_up": 1,
            "sse_server_has_heartbeat": 0,
            "sse_server_flushes_headers": 0,
            "spawn_sites_missing_stderr": 2,
            "spawn_sites_missing_stdout": 2,
            "spawn_sites_missing_timeout": 1,
            "pty_sites_missing_exit_handler": 0,
            "upload_sites_missing_cleanup": 0,
            "streaming_writes_without_chunking": 1,
        }
        # SSE dims: 3 not-green (backoff, heartbeat, flushHeaders)
        # counts: 2 + 2 + 1 + 0 + 0 + 1 = 6
        # total: 3 + 6 = 9
        self.assertEqual(ecq.count_issues(signals), 9)

    def test_cli_writes_structured_output(self) -> None:
        """End-to-end: running main() produces a valid JSON result file."""
        import subprocess

        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _build_min_repo(tmp, sse_server="res.flushHeaders()\nres.write('hb')\n")
            out = tmp / "score.json"
            script = Path(ecq.__file__)
            proc = subprocess.run(
                [sys.executable, str(script), "--root", str(tmp), "--out", str(out)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertTrue(out.exists())
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["name"], "eval_connection_quality")
            self.assertTrue(payload["ok"])
            self.assertIn("connection_quality_score", payload["signals"])


if __name__ == "__main__":
    unittest.main()
