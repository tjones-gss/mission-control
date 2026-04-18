"""Starter docs evaluator.

Checks:
  1. All referenced npm scripts in README.md exist in the matching package.json.
  2. All Markdown files parse as UTF-8 without errors.
  3. No broken relative links that point inside the repo but don't exist.

This is intentionally conservative. If you extend docs logic, add checks here.

Exit code 0 on success, 1 on any failure.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import REPO_ROOT  # type: ignore


def _npm_scripts_from(pkg: Path) -> set[str]:
    try:
        return set(json.loads(pkg.read_text(encoding="utf-8")).get("scripts", {}).keys())
    except (OSError, json.JSONDecodeError):
        return set()


def main() -> int:
    failures: list[str] = []

    readme = REPO_ROOT / "README.md"
    if readme.exists():
        text = readme.read_text(encoding="utf-8", errors="replace")
        root_scripts = _npm_scripts_from(REPO_ROOT / "package.json")
        for m in re.finditer(r"npm run ([a-zA-Z0-9:_-]+)", text):
            name = m.group(1)
            if name not in root_scripts:
                failures.append(f"README references `npm run {name}` but it is not in package.json")

    for md in REPO_ROOT.glob("docs/**/*.md"):
        try:
            md.read_text(encoding="utf-8")
        except UnicodeDecodeError as e:
            failures.append(f"{md.relative_to(REPO_ROOT)}: not valid UTF-8 ({e})")

    for md in list(REPO_ROOT.glob("docs/**/*.md")) + ([readme] if readme.exists() else []):
        text = md.read_text(encoding="utf-8", errors="replace")
        for m in re.finditer(r"\]\(([^)\s#]+)(?:\s+\"[^\"]*\")?\)", text):
            link = m.group(1)
            if link.startswith(("http://", "https://", "mailto:", "#")):
                continue
            target = (md.parent / link).resolve()
            try:
                target.relative_to(REPO_ROOT)
            except ValueError:
                continue
            if not target.exists():
                failures.append(f"{md.relative_to(REPO_ROOT)}: broken link -> {link}")

    if failures:
        print("Docs sanity FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1
    print("Docs sanity OK.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
