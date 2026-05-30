from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import get, load_yaml


def load_role_prompt(root: Path, agent_name: str) -> str:
    role_path = root / "agents/roles" / f"{agent_name}.md"
    if role_path.exists():
        return role_path.read_text()
    return f"# Role: {agent_name}\n\nFollow AGENTS.md and harness policies.\n"


def materialize_context(root: Path, mode: str | None = None) -> str:
    manifest = load_yaml(root / ".harness/context-manifest.yml")
    paths: list[str] = list(manifest.get("always_read") or [])
    if mode:
        by_mode = manifest.get("by_mode") or {}
        paths.extend(by_mode.get(mode) or [])

    chunks: list[str] = ["# Harness context (materialized from context-manifest.yml)\n"]
    seen: set[str] = set()
    for rel in paths:
        if rel in seen or rel.startswith("active "):
            continue
        seen.add(rel)
        p = root / rel
        if p.is_file():
            chunks.append(f"\n## {rel}\n\n{p.read_text()}\n")
    return "\n".join(chunks)


def build_phase_prompt(
    root: Path,
    agent_name: str,
    phase: dict,
    *,
    status_json: dict | None = None,
    mission_body: str | None = None,
) -> str:
    parts = [
        load_role_prompt(root, agent_name),
        materialize_context(root, get(load_yaml(root / ".harness/project-state.yml"), "project", "mode")),
    ]
    desc = phase.get("description")
    if desc:
        parts.append(f"\n## Phase\n\n{desc}\n")
    if status_json:
        parts.append(f"\n## Harness status (JSON)\n\n```json\n{status_json}\n```\n")
    if mission_body:
        parts.append(f"\n## Active mission\n\n{mission_body}\n")
    parts.append(
        "\n## Stop condition\n\nComplete this phase only. "
        "Update harness state files as required. Do not start the next phase.\n"
    )
    return "\n".join(parts)
