"""harness MCP server — the rails as a vendor-neutral MCP surface.

Exposes the harness control plane to ANY MCP-compatible agent (Claude Code,
Cursor, Copilot, ...) over stdio, so a tool that has never seen the cockpit can
still consult the rails before acting. This is the ADR-0005 cross-vendor
strategy made concrete: cross-vendor reach lives in the rails + the contract,
and MCP is the consumption path.

READ-ONLY BY DESIGN. There is deliberately NO approve/decide tool here: an
agent that can query its own gates must never be able to RESOLVE them — agent
self-approval is the exact hole the rails exist to close. Human decisions go
through the existing write paths (the `harness approve` CLI / the cockpit);
this server only tells an agent what the rails require.

Protocol: MCP over stdio — newline-delimited JSON-RPC 2.0. Implemented with
the stdlib only (the harness adds no SDK dependency for this; the message
surface used — initialize / tools/list / tools/call / ping — is small and
stable). `handle_message` is a pure dict-in/dict-out function so tests drive
the protocol without a subprocess.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from harness_core.status import status_payload
from harness_core.yaml_utils import load_yaml

# The newest MCP protocol revision this server knows; echoed back when the
# client requests something newer.
PROTOCOL_VERSION = "2025-06-18"
SERVER_NAME = "harness"


# ---------- tool implementations (read-only) ----------


def _tool_harness_status(root: Path) -> dict:
    return status_payload(root)


def _tool_get_policy_context(root: Path) -> dict:
    """Everything an agent must know BEFORE acting in this repo: the
    danger-zone operations that will require a human, the quality gates that
    must pass, and where the pipeline currently stands."""
    danger = load_yaml(root / ".harness/danger-zone.yml")
    gates = load_yaml(root / ".harness/quality-gates.yml")
    pipeline = load_yaml(root / ".harness/pipeline-state.yml")
    return {
        "dangerZone": danger.get("danger_zone", danger) or {},
        "qualityGates": gates.get("quality_gates", gates) or {},
        "pipeline": pipeline.get("pipeline", {}) or {},
    }


def _tool_get_pending_approvals(root: Path) -> dict:
    """List the danger-zone approval requests currently awaiting a HUMAN
    decision. The agent can see what it is blocked on — it cannot decide."""
    pending_dir = root / ".harness/approvals/pending"
    pending = []
    if pending_dir.is_dir():
        for f in sorted(pending_dir.glob("*.json")):
            try:
                pending.append(json.loads(f.read_text()))
            except (OSError, json.JSONDecodeError):
                # A corrupt request must not blind the listing.
                pending.append({"id": f.stem, "error": "unreadable request file"})
    return {"pending": pending, "count": len(pending)}


TOOLS = {
    "harness_status": {
        "description": (
            "Project / pipeline / mission / readiness state — the same versioned "
            "vendor-neutral payload as `harness status --json`."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": _tool_harness_status,
    },
    "get_policy_context": {
        "description": (
            "The guardrails in force for this repo: danger-zone operations that "
            "require human approval, quality gates that must pass, and the current "
            "pipeline phase/gate. Consult BEFORE acting."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": _tool_get_policy_context,
    },
    "get_pending_approvals": {
        "description": (
            "Danger-zone approval requests awaiting a HUMAN decision. Read-only: "
            "agents can see what they are blocked on, never resolve it."
        ),
        "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False},
        "handler": _tool_get_pending_approvals,
    },
}


# ---------- JSON-RPC plumbing ----------


def _result(msg_id, result: dict) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "result": result}


def _error(msg_id, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": msg_id, "error": {"code": code, "message": message}}


def handle_message(msg: dict, root: Path) -> dict | None:
    """Handle one JSON-RPC message; returns the response dict, or None for
    notifications (no id) and for malformed input we cannot answer."""
    if not isinstance(msg, dict):
        return None
    method = msg.get("method")
    msg_id = msg.get("id")

    # Notifications (no id) get no response.
    if msg_id is None:
        return None

    if method == "initialize":
        client_version = (msg.get("params") or {}).get("protocolVersion")
        version = client_version if isinstance(client_version, str) else PROTOCOL_VERSION
        return _result(
            msg_id,
            {
                "protocolVersion": version,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": _server_version()},
            },
        )

    if method == "ping":
        return _result(msg_id, {})

    if method == "tools/list":
        tools = [
            {"name": name, "description": t["description"], "inputSchema": t["inputSchema"]}
            for name, t in TOOLS.items()
        ]
        return _result(msg_id, {"tools": tools})

    if method == "tools/call":
        params = msg.get("params") or {}
        name = params.get("name")
        tool = TOOLS.get(name)
        if not tool:
            return _error(msg_id, -32602, f"unknown tool: {name}")
        try:
            payload = tool["handler"](root)
        except Exception as exc:  # a tool failure is a tool-result error, not a crash
            return _result(
                msg_id,
                {"content": [{"type": "text", "text": f"tool failed: {exc}"}], "isError": True},
            )
        return _result(
            msg_id,
            {"content": [{"type": "text", "text": json.dumps(payload, default=str)}]},
        )

    return _error(msg_id, -32601, f"method not found: {method}")


def _server_version() -> str:
    # The harness package version travels with the lockstep semver; reading the
    # sidecar-adjacent pyproject is overkill here — a stable constant suffices
    # for serverInfo, bumped with the package.
    return "0.5.0"


def serve(root: Path, stdin=None, stdout=None) -> int:
    """Newline-delimited JSON-RPC loop over stdio. Exits 0 on EOF."""
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            stdout.write(json.dumps(_error(None, -32700, "parse error")) + "\n")
            stdout.flush()
            continue
        response = handle_message(msg, root)
        if response is not None:
            stdout.write(json.dumps(response, default=str) + "\n")
            stdout.flush()
    return 0
