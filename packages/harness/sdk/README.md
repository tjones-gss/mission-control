# Harness Cursor SDK

Programmatic orchestration for the Adaptive Agentic Engineering Harness using [Cursor SDK](https://cursor.com/docs/sdk/python).

## Quickstart

```bash
pip install -e harness_core
pip install -e "sdk/python[cursor,dev]"

export CURSOR_API_KEY=cursor_...   # optional for --dry-run

python -m harness_orchestrator preflight --cwd .
python -m harness_orchestrator run-loop --cwd . --dry-run
python -m harness_orchestrator run-loop --cwd . --runtime local
```

## Commands

| Command | Description |
|---------|-------------|
| `preflight` | `harness check --strict` |
| `status [--json]` | Wrapper around `harness status` |
| `run-loop` | One `next-mission-loop` iteration |
| `run-mission` | Alias for `run-loop` |

### Flags

- `--runtime local|cloud` — **always set explicitly**
- `--repo-url`, `--branch` — cloud clone target
- `--auto-pr` — cloud `autoCreatePR`
- `--skip-reviewer-request` — CI noise reduction
- `--resume` — `Agent.resume` using `current.agent_id`
- `--dry-run` — mock agent (no API calls)
- `--no-strict-gates` — live runs: do not exit 3 on gate failures (debug only)

Live runs exit **3** when required gates fail (default). Dry-run always exits 0.

## Layout

```
sdk/
├── README.md
├── python/harness_orchestrator/   # Orchestrator package
├── python/examples/
├── typescript/examples/           # CI thin wrapper
└── mcp/harness-mcp-server/      # MCP tools for agents
```

## Auth

User or team service-account key from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations).

## Docs

- [docs/setup/cursor-sdk.md](../docs/setup/cursor-sdk.md)
- [docs/setup/cursor-sdk-verification.md](../docs/setup/cursor-sdk-verification.md)
- [docs/roadmap/cursor-sdk-roadmap.md](../docs/roadmap/cursor-sdk-roadmap.md)
- [docs/specs/SPEC-003-sdk-state-fields.md](../docs/specs/SPEC-003-sdk-state-fields.md)
