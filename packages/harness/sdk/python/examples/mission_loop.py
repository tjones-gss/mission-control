#!/usr/bin/env python3
"""Run one next-mission-loop iteration locally."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "sdk/python"))

from harness_orchestrator.cli import main

if __name__ == "__main__":
    sys.exit(main(["run-loop", "--cwd", str(ROOT), "--dry-run"]))
