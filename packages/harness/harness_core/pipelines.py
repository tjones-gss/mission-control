from __future__ import annotations

from pathlib import Path

from harness_core.yaml_utils import load_yaml


def load_pipeline(root: Path, name: str) -> dict:
    return load_yaml(root / "pipelines" / f"{name}.yml")


def pipeline_phases(pipeline: dict) -> list[dict]:
    phases = pipeline.get("phases") or []
    return [p for p in phases if isinstance(p, dict)]
