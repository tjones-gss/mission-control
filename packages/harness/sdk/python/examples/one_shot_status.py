#!/usr/bin/env python3
"""One-shot: inject harness status into Agent.prompt."""
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def main() -> None:
    out = subprocess.check_output(
        [sys.executable, str(ROOT / "tools/harness"), "status", "--json"],
        cwd=str(ROOT),
        text=True,
    )
    prompt = f"Summarize this harness status and recommend one next action:\n\n{out}"
    if not os.environ.get("CURSOR_API_KEY"):
        print("CURSOR_API_KEY not set — prompt preview:\n")
        print(prompt[:500])
        return
    from cursor_sdk import Agent, AgentOptions, LocalAgentOptions

    result = Agent.prompt(
        prompt,
        AgentOptions(
            api_key=os.environ["CURSOR_API_KEY"],
            model="composer-2.5",
            local=LocalAgentOptions(cwd=str(ROOT)),
        ),
    )
    print(result.status, result.result)


if __name__ == "__main__":
    main()
