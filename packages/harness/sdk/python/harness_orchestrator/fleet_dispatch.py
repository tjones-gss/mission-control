from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

# Fleet is a PHASE STRATEGY, and Fleet is cockpit-owned (Node). So a
# `strategy: fleet` phase means the Python spine calls OUT to the cockpit's
# /api/fleet over HTTP, waits for the run to settle, then writes the outcome
# back via the harness CLI single-writer (never editing YAML directly). The
# spine is the caller; Fleet stays the cockpit's. This is the existing process
# seam (ADR-0006), not a re-implementation of Fleet in Python.

DEFAULT_COCKPIT_URL = "http://127.0.0.1:3001"

# Run-level terminal statuses emitted by the Fleet runner.
TERMINAL_STATUSES = frozenset(
    {"succeeded", "partial", "failed", "cancelled", "budget_exceeded", "orphaned", "rejected"}
)
SUCCESS_STATUSES = frozenset({"succeeded", "partial"})


class FleetDispatchError(RuntimeError):
    """Raised when the cockpit Fleet is unreachable or a run can't settle.

    A fleet-strategy phase fails CLOSED on this — the spine never silently
    falls back to single-agent execution when the requested strategy was fleet.
    """


def cockpit_base() -> str:
    return os.environ.get("HARNESS_COCKPIT_URL", DEFAULT_COCKPIT_URL).rstrip("/")


def _post_json(url: str, body: dict, timeout: float = 30.0) -> dict:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url, data=data, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def _get_json(url: str, timeout: float = 30.0) -> dict:
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8") or "{}")


def build_request(root: Path, phase: dict, *, budget_remaining: float | None = None) -> dict:
    """Build the /api/fleet request body from a canonical fleet phase.

    A phase may carry an optional `fleet:` block ({children, policy}); otherwise
    a single child runs the phase goal in the harness root. The verify policy
    defaults to the locked opt-in ceiling (1 authorship-blind verifier, 1 round);
    the budget is set from the spine ledger's remaining headroom when bounded.
    """
    goal = phase.get("goal") or phase.get("description") or phase.get("id") or "fleet phase"
    fleet_cfg = phase.get("fleet") if isinstance(phase.get("fleet"), dict) else {}

    children = fleet_cfg.get("children")
    if not children:
        children = [{"cwd": str(root), "prompt": goal, "quarantine": bool(phase.get("quarantine"))}]
    else:
        # Default each child's cwd to the harness root if unset.
        children = [{"cwd": str(root), **dict(c)} for c in children]

    policy = dict(fleet_cfg.get("policy") or {})
    # Locked decision: verification is opt-in and, when on, defaults to a single
    # authorship-blind verifier and one round (cheaper tier). We set the bounded
    # default explicitly so a fleet phase gets real (not theater) verification.
    policy.setdefault("verify", {"minApprovals": 1, "maxRounds": 1})
    if budget_remaining is not None and "budgetUsd" not in policy:
        policy["budgetUsd"] = budget_remaining

    return {"goal": goal, "children": children, "policy": policy}


def run_fleet_phase(
    root: Path,
    phase: dict,
    *,
    budget_remaining: float | None = None,
    poll_interval: float = 2.0,
    timeout: float = 1800.0,
    sleep=time.sleep,
) -> dict:
    """Dispatch a fleet phase to the cockpit, poll to terminal, return the state.

    Raises FleetDispatchError if the cockpit is unreachable, rejects the request,
    or the run does not settle within `timeout`. `sleep` is injectable for tests.
    """
    base = cockpit_base()
    body = build_request(root, phase, budget_remaining=budget_remaining)

    try:
        started = _post_json(f"{base}/api/fleet", body)
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise FleetDispatchError(f"cockpit Fleet unreachable at {base}: {exc}") from exc

    run_id = started.get("id")
    if not run_id:
        raise FleetDispatchError(f"Fleet did not return a run id (got {started!r})")

    elapsed = 0.0
    while True:
        try:
            state = _get_json(f"{base}/api/fleet/{run_id}")
        except (urllib.error.URLError, OSError, ValueError) as exc:
            raise FleetDispatchError(f"failed to poll Fleet run {run_id}: {exc}") from exc
        status = state.get("status")
        if status in TERMINAL_STATUSES:
            return state
        if elapsed >= timeout:
            raise FleetDispatchError(
                f"Fleet run {run_id} did not settle within {timeout}s (last status {status!r})"
            )
        sleep(poll_interval)
        elapsed += poll_interval
