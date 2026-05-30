---
roadmap:
  name: cursor-sdk-integration
  version: 1
  last_updated: 2026-05-26
phases:
  phase0_foundation:
    status: complete
    completed: 2026-05-26
  phase1_local_sdk:
    status: complete
    completed: 2026-05-26
  phase2_cloud_mcp:
    status: complete
    completed: 2026-05-26
  phase3_core_refactor:
    status: complete
    completed: 2026-05-26
---

# Cursor SDK Integration Roadmap

Canonical phasing plan for programmatic harness orchestration via Cursor SDK.

## Milestones

Phases are **code-complete**. Live verification is tracked separately — see [cursor-sdk-verification.md](../setup/cursor-sdk-verification.md).

| Milestone | Code | Verified live | User can… |
|-----------|------|---------------|-----------|
| **M0: Cursor parity** | complete | pending | Install Cursor adapter with hooks equal to Claude |
| **M1: Local loop** | complete | pending | Run one mission loop via SDK (dry-run or live) |
| **M2: Cloud PR** | complete | pending | Trigger cloud mission workflow (GitHub Actions) |
| **M3: Shared core** | complete | yes | Share YAML/mission/gate logic via `harness_core` |

## Verification checklist

Mark complete only after live proof on your machine — not when code ships.

- [ ] **M0** — Root `.cursor/` installed; hooks fire in Cursor IDE; `bash tests/check_hooks.sh` passes
- [ ] **M1** — Live `run-loop --runtime local` with real `agent_id` (not `mock-local-agent`)
- [ ] **M2** — `harness-mission.yml` workflow_dispatch creates a PR
- [ ] **M3** — `test_cli.py` + `test_sdk.py` pass (already proven in CI)
- [ ] **Strict gates** — Live run exits 3 when gates fail; dry-run exits 0
- [ ] **Win32** — Hook smoke via Git Bash documented and executed

Runbook: [docs/setup/cursor-sdk-verification.md](../setup/cursor-sdk-verification.md)

## Phase 0 — Foundation (complete)

- Cursor hooks in `adapters/cursor/.cursor/hooks/`
- `hooks.json` wired for sessionStart, beforeShellExecution, preToolUse, stop
- `harness check` validates Cursor adapter
- `tests/check_hooks.sh` covers Cursor JSON format
- CI: `.github/workflows/harness-check.yml`
- Install scripts: `tools/install-cursor-adapter.sh`, `tools/install-cursor-adapter.ps1`
- SPEC-003 SDK state fields

## Phase 1 — Local SDK (complete)

- `sdk/python/harness_orchestrator/` package
- `cursor_driver.py`, `loop.py`, `cli.py`, `state.py`, `roles.py`
- Strict gates in live mode (exit 3); `--no-strict-gates` override
- Examples: `one_shot_status.py`, `mission_loop.py`
- `sdk/README.md`

## Phase 2 — Cloud + MCP (complete)

- Cloud flags: `--runtime cloud --auto-pr --skip-reviewer-request`
- `Agent.resume` via `--resume`
- Gate evaluators in `harness_core/gates.py`
- MCP server: `sdk/mcp/harness-mcp-server/server.py`
- TypeScript example: `sdk/typescript/examples/mission-loop.ts`
- Cloud workflow: `.github/workflows/harness-mission.yml` (installs `harness_core` + `[cursor]`)
- Setup: `docs/setup/cursor-sdk.md`

## Phase 3 — harness_core (complete)

- `harness_core/` package shared by CLI and SDK
- ADR-002 documents extraction
- `tools/harness` imports from `harness_core`

## Future (not scheduled)

- PyPI publish (`harness-sdk`, `harness-core`)
- Full pipeline drivers for all seven pipelines
- Dashboard live run integration with `Agent.getRun`
