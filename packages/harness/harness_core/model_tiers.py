from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import load_yaml


def _load_tiers(root: Path) -> tuple[dict, str | None]:
    """Return (tier_alias -> model_string, default_tier) from model-tiers.yml.

    Missing or malformed file degrades to ({}, None) so the loop keeps working
    on installs that predate this feature.
    """
    cfg = load_yaml(root / ".harness/model-tiers.yml")
    tiers = cfg.get("tiers")
    if not isinstance(tiers, dict):
        tiers = {}
    return tiers, cfg.get("default_tier")


def _role_tier(root: Path, agent: str | None) -> str | None:
    """Return the tier alias declared for an agent role in agent-registry.yml."""
    if not agent:
        return None
    registry = load_yaml(root / ".harness/agent-registry.yml")
    role_tiers = registry.get("role_tiers")
    if not isinstance(role_tiers, dict):
        return None
    return role_tiers.get(agent)


def resolve_model(
    root: Path,
    phase: dict,
    *,
    agent: str | None = None,
    cfg_default: str | None = None,
) -> str | None:
    """Resolve the model for one pipeline phase.

    Precedence (highest first): phase `model` -> role default (`role_tiers`) ->
    `default_tier` -> `cfg_default` -> None. A candidate that matches a defined
    tier alias is mapped to its concrete model string; anything else is treated
    as a literal model string and returned as-is.

    Returning None means "no opinion": the caller keeps its own default model,
    which preserves today's single-model behavior when nothing is configured.
    """
    tiers, default_tier = _load_tiers(root)

    candidate = phase.get("model") if isinstance(phase, dict) else None
    if candidate is None:
        candidate = _role_tier(root, agent)
    if candidate is None:
        candidate = default_tier

    if candidate is None:
        return cfg_default
    # alias -> concrete model string, else literal passthrough
    return tiers.get(candidate, candidate)
