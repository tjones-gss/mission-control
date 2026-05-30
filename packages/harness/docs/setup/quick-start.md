# Quick start (harness core)

Get the harness enforcing rules on **this machine** in one step. No SDK, no MCP — just control plane + Cursor + Claude adapters.

## Tell your agent (simplest)

Open this repo in Cursor or Claude Code and paste:

```text
Set up the Adaptive Agentic Engineering Harness on this machine — core control plane only, not the experimental SDK/MCP stack. Follow prompts/setup-workstation.md exactly, run the commands yourself, and give me a short pass/fail report.
```

The agent should run `python tools/harness setup` and report back.

## Or run yourself

```bash
git clone https://github.com/tjones-gss/adaptive-agentic-engineering-harness.git
cd adaptive-agentic-engineering-harness
python -m pip install pyyaml
python tools/harness setup
```

Windows PowerShell: same commands from the repo root.

Then restart your IDE and verify hooks (Claude: `/hooks`; Cursor: trust workspace).

## What `harness setup` does

1. Installs **Cursor hooks** (`.cursor/`, hooks only — no SDK packages)
2. Installs **Claude Code adapter** (`.claude/`, `CLAUDE.md`, executable hooks)
3. Runs **`harness check`** and prints next steps

## What it does not do

| Optional / experimental | Install when you need it |
|-------------------------|---------------------------|
| Cursor SDK + `run-loop` | `pip install -e "sdk/python[cursor,dev]"` — see `docs/setup/cursor-sdk.md` |
| MCP harness server | `sdk/mcp/` |
| Bootstrap an app repo | Copy harness into that repo, then `harness init <mode>` |

## New machine (e.g. at work)

Clone from GitHub — do not copy a zip from another PC. Root `.claude/settings.json` may contain another machine's Git path; `harness setup` regenerates it.

## Next

- Customize harness state: `runs/missions/MISSION-001-example-adapt-harness.md` or `harness init feature-development`
- Full Claude notes: `docs/setup/claude-code.md`
- Full Cursor notes: `docs/setup/cursor-sdk.md` (SDK is optional)
