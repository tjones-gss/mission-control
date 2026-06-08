from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path

from harness_core.yaml_utils import load_yaml, save_yaml

logger = logging.getLogger(__name__)

# The spine's per-run cost ledger. Fleet has its OWN USD ledger per fleet run;
# this is the harness loop's run-wide ledger spanning every phase (single and
# fleet), with a hard abort ceiling. It is an ESTIMATE-based backstop, not exact
# accounting: single phases accrue a configured per-phase estimate (the cursor/
# claude drivers don't surface real token cost here), while fleet phases accrue
# the real spentUsd reported by the cockpit Fleet run. The ceiling is a safety
# stop, distinct from a gate HALT.
#
# Persisted to .harness/run-ledger.yml (single-writer = the loop). Config lives
# in .harness/cost-policy.yml (run_ceiling_usd, per_phase_usd); the env var
# HARNESS_RUN_CEILING_USD overrides the file ceiling.


@dataclass
class RunLedger:
    run_id: str
    ceiling_usd: float | None = None
    spent_usd: float = 0.0
    per_phase: list[dict] = field(default_factory=list)


def ledger_path(root: Path) -> Path:
    return root / ".harness/run-ledger.yml"


def _cost_policy(root: Path) -> dict:
    return load_yaml(root / ".harness/cost-policy.yml")


def resolve_ceiling(root: Path) -> float | None:
    """Resolve the run cost ceiling: env HARNESS_RUN_CEILING_USD wins, then
    cost-policy.yml run_ceiling_usd, else None (unbounded — today's behavior).

    A value that is PRESENT but not a valid number is NOT silently ignored: it
    WARNs (the run would otherwise look 'configured' while running unbounded — a
    silent-failure trap) and degrades to no ceiling.
    """
    env = os.environ.get("HARNESS_RUN_CEILING_USD")
    if env not in (None, ""):
        try:
            return float(env)
        except ValueError:
            logger.warning(
                "HARNESS_RUN_CEILING_USD=%r is not a number; ignoring it. The run "
                "is UNBOUNDED unless cost-policy.yml sets run_ceiling_usd.",
                env,
            )
    policy = _cost_policy(root)
    if "run_ceiling_usd" not in policy:
        return None
    val = policy["run_ceiling_usd"]
    if isinstance(val, bool) or not isinstance(val, (int, float)):
        logger.warning(
            "cost-policy.yml run_ceiling_usd=%r is not a number; the run is "
            "UNBOUNDED (no cost ceiling enforced). Fix the value to enable it.",
            val,
        )
        return None
    return float(val)


def per_phase_estimate(root: Path) -> float:
    """Per-phase USD estimate for single-agent phases. 0.0 when unconfigured —
    cost tracking is then inert (opt-in), and the ceiling never trips.

    A present-but-invalid value WARNs rather than silently degrading to 0.0.
    """
    policy = _cost_policy(root)
    if "per_phase_usd" not in policy:
        return 0.0
    val = policy["per_phase_usd"]
    if isinstance(val, bool) or not isinstance(val, (int, float)) or val < 0:
        logger.warning(
            "cost-policy.yml per_phase_usd=%r is invalid (need a non-negative "
            "number); treating per-phase cost as 0.0.",
            val,
        )
        return 0.0
    return float(val)


def new_ledger(root: Path, run_id: str) -> RunLedger:
    return RunLedger(run_id=run_id, ceiling_usd=resolve_ceiling(root))


def accrue(ledger: RunLedger, phase_id: str, usd: float, source: str = "estimate") -> RunLedger:
    """Add a phase's cost to the ledger (negative costs are clamped to 0)."""
    amount = max(0.0, float(usd))
    ledger.spent_usd = round(ledger.spent_usd + amount, 6)
    ledger.per_phase.append({"phase_id": phase_id, "usd": amount, "source": source})
    return ledger


def is_exceeded(ledger: RunLedger) -> bool:
    """True once spend has reached/passed the ceiling (the stop-the-line latch)."""
    return ledger.ceiling_usd is not None and ledger.spent_usd >= ledger.ceiling_usd


def would_exceed(ledger: RunLedger, additional: float) -> bool:
    """True if entering a phase costing `additional` would push past the ceiling.
    Used as a refuse-to-enter projection before dispatching the next phase."""
    if ledger.ceiling_usd is None:
        return False
    return (ledger.spent_usd + max(0.0, float(additional))) > ledger.ceiling_usd


def save_ledger(root: Path, ledger: RunLedger) -> None:
    save_yaml(
        ledger_path(root),
        {
            "run_id": ledger.run_id,
            "ceiling_usd": ledger.ceiling_usd,
            "spent_usd": ledger.spent_usd,
            "per_phase": ledger.per_phase,
        },
    )


def load_ledger(root: Path) -> RunLedger | None:
    data = load_yaml(ledger_path(root))
    if not data:
        return None
    return RunLedger(
        run_id=data.get("run_id", "unknown"),
        ceiling_usd=data.get("ceiling_usd"),
        spent_usd=float(data.get("spent_usd") or 0.0),
        per_phase=list(data.get("per_phase") or []),
    )
