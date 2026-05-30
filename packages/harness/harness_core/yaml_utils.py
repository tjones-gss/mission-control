from __future__ import annotations

from pathlib import Path

try:
    import yaml
except ImportError as exc:
    raise ImportError("PyYAML required: pip install pyyaml") from exc


def find_harness_root(start: Path | None = None) -> Path | None:
    p = (start or Path.cwd()).resolve()
    for parent in [p, *p.parents]:
        if (parent / ".harness").is_dir():
            return parent
    return None


def load_yaml(path: Path) -> dict:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text()) or {}
    return data if isinstance(data, dict) else {}


def save_yaml(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, sort_keys=False, default_flow_style=False))


def get(d: dict, *keys, default=None):
    cur = d
    for k in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
        if cur is None:
            return default
    return cur
