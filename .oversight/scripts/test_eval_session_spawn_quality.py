"""Unit tests for eval_session_spawn_quality.

Run:
  python .oversight/scripts/test_eval_session_spawn_quality.py
"""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import eval_session_spawn_quality as essq  # type: ignore


def _write(root: Path, rel: str, body: str) -> Path:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")
    return p


# ---------------------------------------------------------------------------
# env cache hoisting
# ---------------------------------------------------------------------------


class EnvCacheHoist(unittest.TestCase):
    def test_hoisted_env_scores_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(
                tmp,
                "server/claude-cli.js",
                "const CLEAN_ENV = (() => {\n"
                "  const env = { ...process.env }\n"
                "  for (const k of Object.keys(env))\n"
                "    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]\n"
                "  return env\n"
                "})()\n"
                "export function runClaude({ args }) {\n"
                "  return spawn('claude', args, { env: CLEAN_ENV })\n"
                "}\n",
            )
            _write(tmp, "server/routes/sessions.js", "// placeholder\n")
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_env_cache_hot"], 1)

    def test_env_built_per_call_scores_0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(
                tmp,
                "server/claude-cli.js",
                "export function runClaude({ args }) {\n"
                "  const env = { ...process.env }\n"
                "  for (const k of Object.keys(env))\n"
                "    if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k]\n"
                "  return spawn('claude', args, { env })\n"
                "}\n",
            )
            _write(tmp, "server/routes/sessions.js", "// placeholder\n")
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_env_cache_hot"], 0)


# ---------------------------------------------------------------------------
# bin memoization
# ---------------------------------------------------------------------------


class BinMemoization(unittest.TestCase):
    def test_get_claude_bin_scores_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(
                tmp,
                "server/claude-cli.js",
                "import { getClaudeBin } from './lib/claude-bin.js'\n"
                "export function runClaude() { const bin = getClaudeBin() }\n",
            )
            _write(tmp, "server/routes/sessions.js", "// placeholder\n")
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_bin_memoized"], 1)

    def test_direct_resolve_scores_0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(
                tmp,
                "server/claude-cli.js",
                "import { resolveClaudeBin } from './lib/claude-bin.js'\n"
                "export function runClaude() { const bin = resolveClaudeBin() }\n",
            )
            _write(tmp, "server/routes/sessions.js", "// placeholder\n")
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_bin_memoized"], 0)


# ---------------------------------------------------------------------------
# stream-json
# ---------------------------------------------------------------------------


class StreamJson(unittest.TestCase):
    def test_detected_in_route(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(
                tmp,
                "server/claude-cli.js",
                "export function runClaude() {}\n",
            )
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  const args = ['-p', 'hi', '--output-format', 'stream-json']\n"
                "  await runClaude({ args, timeoutMs: 1000 })\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_uses_stream_json"], 1)

    def test_json_only_scores_0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  const args = ['-p', 'hi', '--output-format', 'json']\n"
                "  await runClaude({ args, timeoutMs: 1000 })\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_uses_stream_json"], 0)


# ---------------------------------------------------------------------------
# early ack on /new
# ---------------------------------------------------------------------------


class EarlyAck(unittest.TestCase):
    def test_status_before_await_scores_1(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  res.status(202).json({ ok: true })\n"
                "  await runClaude({ args: [], timeoutMs: 1000 })\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_early_ack"], 1)

    def test_status_after_await_scores_0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  const { stdout } = await runClaude({ args: [], timeoutMs: 1000 })\n"
                "  res.status(201).json({ ok: true, stdout })\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_early_ack"], 0)


# ---------------------------------------------------------------------------
# timeout explicit
# ---------------------------------------------------------------------------


class TimeoutExplicit(unittest.TestCase):
    def test_every_call_has_timeout(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  await runClaude({ args: [], cwd: '/tmp', timeoutMs: 300000 })\n"
                "})\n"
                "router.post('/fork', async (req, res) => {\n"
                "  await runClaude({ args: [], timeoutMs: 120000 })\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_timeout_explicit"], 1)

    def test_missing_timeout_on_any_call_scores_0(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(
                tmp,
                "server/routes/sessions.js",
                "router.post('/new', async (req, res) => {\n"
                "  await runClaude({ args: [] })  // no timeout, bad\n"
                "})\n",
            )
            result = essq.evaluate(tmp)
            self.assertEqual(result["signals"]["spawn_timeout_explicit"], 0)


# ---------------------------------------------------------------------------
# rollup
# ---------------------------------------------------------------------------


class Rollup(unittest.TestCase):
    def test_all_green_maxes_100(self) -> None:
        signals = {
            "spawn_env_cache_hot": 1,
            "spawn_bin_memoized": 1,
            "spawn_uses_stream_json": 1,
            "spawn_early_ack": 1,
            "spawn_timeout_explicit": 1,
        }
        self.assertEqual(essq.roll_up_score(signals), 100)

    def test_all_red_is_0(self) -> None:
        signals = {
            "spawn_env_cache_hot": 0,
            "spawn_bin_memoized": 0,
            "spawn_uses_stream_json": 0,
            "spawn_early_ack": 0,
            "spawn_timeout_explicit": 0,
        }
        self.assertEqual(essq.roll_up_score(signals), 0)

    def test_weights_sum_to_100(self) -> None:
        # Sanity: weights are 15 + 10 + 25 + 40 + 10 = 100.
        full = essq.roll_up_score(
            {
                "spawn_env_cache_hot": 1,
                "spawn_bin_memoized": 0,
                "spawn_uses_stream_json": 0,
                "spawn_early_ack": 0,
                "spawn_timeout_explicit": 0,
            }
        )
        self.assertEqual(full, 15)

    def test_issue_count_counts_zeros(self) -> None:
        signals = {
            "spawn_env_cache_hot": 0,
            "spawn_bin_memoized": 1,
            "spawn_uses_stream_json": 0,
            "spawn_early_ack": 0,
            "spawn_timeout_explicit": 1,
        }
        self.assertEqual(essq.count_issues(signals), 3)


# ---------------------------------------------------------------------------
# CLI smoke
# ---------------------------------------------------------------------------


class CliSmoke(unittest.TestCase):
    def test_cli_writes_payload(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            _write(tmp, "server/claude-cli.js", "export function runClaude() {}\n")
            _write(tmp, "server/routes/sessions.js", "// empty\n")
            out = tmp / "out.json"
            script = Path(essq.__file__)
            proc = subprocess.run(
                [sys.executable, str(script), "--root", str(tmp), "--out", str(out)],
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            payload = json.loads(out.read_text(encoding="utf-8"))
            self.assertEqual(payload["name"], "eval_session_spawn_quality")
            self.assertIn("spawn_score", payload["signals"])


if __name__ == "__main__":
    unittest.main()
