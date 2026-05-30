# Cursor SDK Setup

Programmatic harness orchestration via [Cursor SDK](https://cursor.com/docs/sdk/python).

## Prerequisites

- Python 3.10+
- `pip install pyyaml`
- `pip install -e harness_core`
- `pip install -e "sdk/python[cursor]"` for live agents
- `export CURSOR_API_KEY=cursor_...`

## Install Cursor adapter (enforcement)

Use the install script (recommended):

```bash
# macOS / Linux / Git Bash
./tools/install-cursor-adapter.sh

# Windows PowerShell (writes hooks.json with full Git Bash paths)
.\tools\install-cursor-adapter.ps1
```

On Windows, `hooks.json` commands must invoke Git Bash explicitly:

```json
"command": "\"C:\\Program Files\\Git\\bin\\bash.exe\" .cursor/hooks/block-danger.sh"
```

Re-generate after moving Git: `.\tools\write-cursor-hooks-json.ps1`

Manual install (Unix):

```bash
cp -r adapters/cursor/.cursor .cursor
chmod +x .cursor/hooks/*.sh   # Git Bash / macOS / Linux
./tools/harness check --strict
```

## Windows (Win32)

Cursor hooks are **bash scripts**. On Windows:

- Install [Git for Windows](https://git-scm.com/download/win) — Cursor invokes `.cursor/hooks/*.sh` via bash
- `chmod +x` is a no-op on NTFS; the executable bit matters on Linux CI and macOS only
- Run hook smoke tests via Git Bash: `bash tests/check_hooks.sh`
- Use `.\tools\install-cursor-adapter.ps1` instead of the bash install script

## Local mission loop

```bash
# Dry-run (mock agent, no API key)
python -m harness_orchestrator run-loop --cwd . --dry-run

# Live local agent (strict gates: exit 3 if required gates fail)
export CURSOR_API_KEY=...
python -m harness_orchestrator run-loop --cwd . --runtime local

# Debug: allow gate failures without non-zero exit
python -m harness_orchestrator run-loop --cwd . --runtime local --no-strict-gates
```

Live runs require a bootstrapped project — see [cursor-sdk-verification.md](cursor-sdk-verification.md).

## Cloud + auto-PR

```bash
export CURSOR_API_KEY=...
export HARNESS_REPO_URL=https://github.com/org/repo
python -m harness_orchestrator run-loop \
  --cwd . \
  --runtime cloud \
  --repo-url "$HARNESS_REPO_URL" \
  --branch mission/my-feature \
  --auto-pr \
  --skip-reviewer-request
```

## Resume after CI timeout

```bash
python -m harness_orchestrator run-loop --cwd . --resume --runtime local
```

Reads `current.agent_id` from `.harness/project-state.yml`.

## MCP server

Stdio MCP exposing `harness_status`, `harness_next`, `harness_validate`, `list_allowed_files`:

```bash
python sdk/mcp/harness-mcp-server/server.py
```

Pass inline on `Agent.create` per Cursor SDK docs. Re-pass on every `Agent.resume`.

## GitHub Actions

- `harness-check.yml` — hooks + CLI + SDK tests on PR
- `harness-mission.yml` — manual cloud/local mission dispatch (sets `HARNESS_REPO_URL` automatically)

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Loop completed; strict gates satisfied (or dry-run) |
| 1 | Agent startup failed (`CursorAgentError`) |
| 2 | Agent run failed (status error) |
| 3 | Live run completed but required gates failed (`--no-strict-gates` to override) |

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Exit 1 on startup | Check `CURSOR_API_KEY`, network |
| Exit 2 on run | Inspect run ID in logs; `Agent.getRun` |
| Exit 3 on run | Gate artifacts missing; check logs; use `--no-strict-gates` to debug |
| Silent local when cloud intended | Always pass `--runtime cloud` explicitly |
| Hooks not firing | Copy `.cursor/hooks.json`; restart Cursor |
| Preflight fails live | Run `harness init <mode>`; register a ready mission |

See also: [cursor-sdk-verification.md](cursor-sdk-verification.md), [cursor-sdk-roadmap.md](../roadmap/cursor-sdk-roadmap.md), [SPEC-003](../specs/SPEC-003-sdk-state-fields.md).
