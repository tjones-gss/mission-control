#!/usr/bin/env python3
"""Cloud retrospective via SDK (requires CURSOR_API_KEY + HARNESS_REPO_URL)."""
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "sdk/python"))

from harness_orchestrator.cli import main

if __name__ == "__main__":
    repo = os.environ.get("HARNESS_REPO_URL", "")
    sys.exit(
        main(
            [
                "run-loop",
                "--cwd",
                str(ROOT),
                "--runtime",
                "cloud",
                "--repo-url",
                repo,
                "--auto-pr",
                "--skip-reviewer-request",
            ]
        )
    )
