from __future__ import annotations

import re
from pathlib import Path

from harness_core.yaml_utils import get, load_yaml


def _section_bullets(mission_path: Path, section_prefix: str) -> list[str]:
    """Return bullet entries under a `## <Section>` heading in a mission markdown.

    Generalizes the strip logic that previously lived (duplicated) in
    tools/harness::_allowed_patterns and the require-mission.sh hook, so the
    scope_adherence gate, the CLI lint, and the hook all see the same patterns.
    Tolerant: returns [] on read errors. `section_prefix` is matched
    case-insensitively against the heading text (e.g. "allowed files").
    """
    patterns: list[str] = []
    in_sec = False
    try:
        for line in mission_path.read_text().splitlines():
            if line.startswith("##"):
                in_sec = line.strip().lower().startswith(f"## {section_prefix}")
                continue
            if in_sec:
                m = re.match(r"^\s*-\s+(.+?)\s*$", line)
                if m:
                    p = m.group(1).strip()
                    # Strip a single layer of surrounding ", ', or `
                    if len(p) >= 2 and p[0] in "\"'`" and p[-1] == p[0]:
                        p = p[1:-1]
                    if p:
                        patterns.append(p)
    except OSError:
        pass
    return patterns


def allowed_patterns(mission_path: Path) -> list[str]:
    """Glob entries under `## Allowed Files` in a mission markdown."""
    return _section_bullets(mission_path, "allowed files")


def forbidden_patterns(mission_path: Path) -> list[str]:
    """Glob entries under `## Forbidden Files` in a mission markdown."""
    return _section_bullets(mission_path, "forbidden files")


def glob_to_regex(pattern: str) -> str:
    """Translate a path glob to an anchored regex with gitignore-ish `**`.

    - `**`  matches across path separators (any number of dirs, including zero
            when followed by `/`).
    - `*`   matches within a single path segment (not across `/`).
    - `?`   matches a single non-separator char.
    Everything else is matched literally. Backslashes are normalized to `/` so
    Windows-style touched paths match POSIX-style mission globs.
    """
    pattern = pattern.replace("\\", "/")
    out: list[str] = []
    i = 0
    n = len(pattern)
    while i < n:
        c = pattern[i]
        if c == "*":
            if pattern[i + 1 : i + 2] == "*":
                out.append(".*")
                i += 2
                # Swallow a following `/` so `**/` matches zero or more dirs.
                if pattern[i : i + 1] == "/":
                    i += 1
            else:
                out.append("[^/]*")
                i += 1
        elif c == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(c))
            i += 1
    return "^" + "".join(out) + "$"


def path_matches_any(path: str, patterns: list[str]) -> bool:
    """True if the (normalized) path matches any of the glob patterns."""
    norm = path.replace("\\", "/")
    for pat in patterns:
        if re.match(glob_to_regex(pat), norm):
            return True
    return False


def list_ready_missions(root: Path) -> list[tuple[str, dict]]:
    missions = load_yaml(root / ".harness/mission-index.yml")
    do_not_select = set(missions.get("do_not_select") or [])
    mission_dict = missions.get("missions") or {}
    if not isinstance(mission_dict, dict):
        return []

    ready: list[tuple[str, dict]] = []
    for mid, data in mission_dict.items():
        if not isinstance(data, dict):
            continue
        status = data.get("status", "")
        if status == "ready" and status not in do_not_select:
            ready.append((mid, data))

    priority_order = {"high": 0, "medium": 1, "low": 2}
    ready.sort(key=lambda kv: priority_order.get(kv[1].get("priority", "medium"), 1))
    return ready


def select_next_mission(root: Path) -> str | None:
    ready = list_ready_missions(root)
    return ready[0][0] if ready else None


def get_mission_path(root: Path, mission_id: str | None) -> Path | None:
    if not mission_id:
        return None
    missions = load_yaml(root / ".harness/mission-index.yml")
    entry = (missions.get("missions") or {}).get(mission_id)
    if isinstance(entry, dict) and entry.get("file"):
        p = root / entry["file"]
        if p.exists():
            return p
    for cand in (root / "runs/missions").glob(f"{mission_id}*.md"):
        return cand
    return None


def get_current_mission(root: Path) -> str | None:
    project = load_yaml(root / ".harness/project-state.yml")
    mid = get(project, "current", "mission")
    if mid in (None, "", "null", "unset"):
        return None
    return str(mid)
