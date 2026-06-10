"""MCP server tests — the rails as a READ-ONLY vendor-neutral MCP surface.

Drives the JSON-RPC handler directly (handle_message is dict-in/dict-out) plus
one end-to-end serve() pass over an in-memory stdio pair. The read-only
property is asserted explicitly: the server must never grow a decide/approve
tool — agent self-approval is the hole the rails exist to close.
"""

import io
import json
import sys
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from harness_core.mcp_server import TOOLS, handle_message, serve  # noqa: E402
from harness_core.status import status_payload  # noqa: E402

import tempfile  # noqa: E402


def make_root() -> Path:
    """A minimal .harness project fixture."""
    root = Path(tempfile.mkdtemp(prefix="harness-mcp-"))
    h = root / ".harness"
    h.mkdir()
    (h / "project-state.yml").write_text(
        "project:\n  name: demo\n  mode: feature-development\n"
        "stack:\n  language: python\n"
        "next:\n  recommended_agent: implementer\n"
    )
    (h / "pipeline-state.yml").write_text(
        "pipeline:\n  active: feature-development\n  phase: build\n  gate: tests_green\n"
    )
    (h / "danger-zone.yml").write_text(
        "danger_zone:\n  operations:\n    - pattern: 'rm -rf'\n      reason: destructive\n"
    )
    (h / "quality-gates.yml").write_text(
        "quality_gates:\n  before_pr:\n    - tests_green\n"
    )
    return root


def rpc(method, msg_id=1, params=None):
    msg = {"jsonrpc": "2.0", "id": msg_id, "method": method}
    if params is not None:
        msg["params"] = params
    return msg


class TestProtocol(unittest.TestCase):
    def setUp(self):
        self.root = make_root()

    def test_initialize_echoes_client_version_and_advertises_tools(self):
        res = handle_message(
            rpc("initialize", params={"protocolVersion": "2026-01-01"}), self.root
        )
        self.assertEqual(res["result"]["protocolVersion"], "2026-01-01")
        self.assertIn("tools", res["result"]["capabilities"])
        self.assertEqual(res["result"]["serverInfo"]["name"], "harness")

    def test_notifications_get_no_response(self):
        msg = {"jsonrpc": "2.0", "method": "notifications/initialized"}
        self.assertIsNone(handle_message(msg, self.root))

    def test_ping(self):
        res = handle_message(rpc("ping"), self.root)
        self.assertEqual(res["result"], {})

    def test_unknown_method_errors_minus_32601(self):
        res = handle_message(rpc("resources/list"), self.root)
        self.assertEqual(res["error"]["code"], -32601)

    def test_tools_list_names_the_three_read_tools(self):
        res = handle_message(rpc("tools/list"), self.root)
        names = {t["name"] for t in res["result"]["tools"]}
        self.assertEqual(
            names, {"harness_status", "get_policy_context", "get_pending_approvals"}
        )
        for t in res["result"]["tools"]:
            self.assertIn("inputSchema", t)
            self.assertTrue(t["description"])


class TestReadOnlyByDesign(unittest.TestCase):
    def test_no_write_or_decide_tool_is_exposed(self):
        """Agent self-approval is the hole the rails close — the MCP surface
        must never grow approve/decide/write tools."""
        for forbidden in ("approve", "decide", "write", "resolve", "report"):
            for name in TOOLS:
                self.assertNotIn(
                    forbidden,
                    name.lower(),
                    f"MCP tool '{name}' looks like a write surface — the MCP "
                    "server is READ-ONLY by design",
                )


class TestTools(unittest.TestCase):
    def setUp(self):
        self.root = make_root()

    def call(self, name):
        res = handle_message(rpc("tools/call", params={"name": name, "arguments": {}}), self.root)
        self.assertNotIn("error", res)
        content = res["result"]["content"]
        self.assertEqual(content[0]["type"], "text")
        return json.loads(content[0]["text"])

    def test_harness_status_matches_the_cli_payload_exactly(self):
        """The MCP tool and `harness status --json` are the SAME composition
        (harness_core/status.py) — one contract surface, no drift."""
        self.assertEqual(self.call("harness_status"), json.loads(
            json.dumps(status_payload(self.root), default=str)
        ))
        self.assertEqual(self.call("harness_status")["pipeline"]["phase"], "build")

    def test_get_policy_context_returns_danger_zone_gates_and_pipeline(self):
        ctx = self.call("get_policy_context")
        self.assertEqual(ctx["dangerZone"]["operations"][0]["pattern"], "rm -rf")
        self.assertEqual(ctx["qualityGates"]["before_pr"], ["tests_green"])
        self.assertEqual(ctx["pipeline"]["gate"], "tests_green")

    def test_get_pending_approvals_lists_pending_requests(self):
        pending = self.root / ".harness/approvals/pending"
        pending.mkdir(parents=True)
        (pending / "req-1.json").write_text(json.dumps({"id": "req-1", "tool": "Bash"}))
        (pending / "req-2.json").write_text("{corrupt")
        out = self.call("get_pending_approvals")
        self.assertEqual(out["count"], 2)
        self.assertEqual(out["pending"][0]["id"], "req-1")
        self.assertEqual(out["pending"][1]["error"], "unreadable request file")

    def test_get_pending_approvals_empty_when_no_dir(self):
        out = self.call("get_pending_approvals")
        self.assertEqual(out, {"pending": [], "count": 0})

    def test_unknown_tool_errors_minus_32602(self):
        res = handle_message(
            rpc("tools/call", params={"name": "approve_my_own_request", "arguments": {}}),
            self.root,
        )
        self.assertEqual(res["error"]["code"], -32602)


class TestServeLoop(unittest.TestCase):
    def test_serve_speaks_newline_delimited_jsonrpc_and_exits_on_eof(self):
        root = make_root()
        lines = [
            json.dumps(rpc("initialize", 1, {"protocolVersion": "2025-06-18"})),
            json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            json.dumps(rpc("tools/list", 2)),
            "not json at all",
            json.dumps(rpc("tools/call", 3, {"name": "harness_status", "arguments": {}})),
        ]
        stdin = io.StringIO("\n".join(lines) + "\n")
        stdout = io.StringIO()
        code = serve(root, stdin=stdin, stdout=stdout)
        self.assertEqual(code, 0)
        out = [json.loads(l) for l in stdout.getvalue().strip().split("\n")]
        # initialize + tools/list + parse error + tools/call = 4 responses
        # (the notification produces none)
        self.assertEqual(len(out), 4)
        self.assertEqual(out[0]["id"], 1)
        self.assertEqual(out[1]["id"], 2)
        self.assertEqual(out[2]["error"]["code"], -32700)
        self.assertEqual(out[3]["id"], 3)
        body = json.loads(out[3]["result"]["content"][0]["text"])
        self.assertEqual(body["project"]["name"], "demo")


if __name__ == "__main__":
    unittest.main()
