---
name: workstation-setup
description: Use when the user wants the harness working on this machine right away. Triggers on "set up the harness", "setup this machine", "get harness working", "wire up cursor and claude", or after cloning the harness repo. Runs harness setup (core adapters and hooks only), verifies with harness check, and reports pass/fail. Does NOT install SDK, MCP, or orchestrator run-loop unless explicitly requested.
---

# Workstation Setup (harness core)

Wire this machine to run the Adaptive Agentic Engineering Harness control plane.

## Read first

`prompts/setup-workstation.md` — full checklist and in/out of scope.

## Process

1. Run `python tools/harness setup` from the project root (or `python tools/harness setup --skip-claude` / `--skip-cursor` if the user uses only one IDE).
2. If PyYAML is missing, run `python -m pip install pyyaml` and retry.
3. Run `python tools/harness check` and summarize which layers passed.
4. Tell the user to restart their IDE and verify `/hooks` (Claude) or trust workspace (Cursor).
5. Run `python tools/harness status` and state the recommended next action.

## Hard rules

- Do not install `sdk/python`, MCP, or `harness_orchestrator` unless the user explicitly asks for the experimental SDK stack.
- Do not edit application code or weaken safety files.
- On Windows, mention Git Bash + PATH if functional smoke tests fail.

## Output

Short report: what ran, what passed, what the user should do next (one command or one mission).
