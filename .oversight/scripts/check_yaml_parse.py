"""Verify given YAML/compose/CI files parse with our built-in mini-YAML.

This is NOT a full YAML validator. It catches obvious indentation/bracket
corruption introduced by automated edits, without requiring pyyaml.

Usage:
  python .oversight/scripts/check_yaml_parse.py path1 path2 ...
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _yaml  # type: ignore


def main(argv: list[str]) -> int:
    if not argv:
        print("No paths given.", file=sys.stderr)
        return 2
    bad = 0
    for p in argv:
        path = Path(p)
        if not path.exists():
            print(f"MISS {p}")
            bad += 1
            continue
        try:
            doc = _yaml.load_file(str(path))
            # Very loose sanity: must yield a dict or list at the top level.
            if not isinstance(doc, (dict, list)):
                print(f"WARN {p}: parsed but top level was {type(doc).__name__}")
            else:
                print(f"OK   {p}")
        except Exception as e:  # noqa: BLE001
            print(f"FAIL {p}: {e}")
            bad += 1
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
