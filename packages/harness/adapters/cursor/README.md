# Cursor Adapter

Install `.cursor/` into the project root:

```bash
# Recommended
./tools/install-cursor-adapter.sh        # macOS / Linux / Git Bash
.\tools\install-cursor-adapter.ps1       # Windows (Git Bash paths in hooks.json)
.\tools\write-cursor-hooks-json.ps1        # Windows only: refresh hooks.json bash paths
```

Manual install:

```bash
cp -r adapters/cursor/.cursor .
chmod +x .cursor/hooks/*.sh
```

## What ships

| Component | Purpose |
|-----------|---------|
| `.cursor/rules/*.mdc` | Soft policy (missions, tests, security) |
| `.cursor/hooks.json` | Hard enforcement at tool boundary |
| `.cursor/hooks/*.sh` | Mission scope, danger zone, session notes |

## Hooks

| Hook | Event | Behavior |
|------|-------|----------|
| `session-start-load-state.sh` | sessionStart | Preload `.harness/` YAML |
| `block-danger.sh` | beforeShellExecution | Deny dangerous commands |
| `require-mission.sh` | preToolUse (Write/Edit) | Enforce Allowed/Forbidden files |
| `stop-session-note-reminder.sh` | stop | Require session note for active mission |

Set `HARNESS_ENFORCE_SESSION_NOTE=1` for blocking stop behavior.

## Windows (Win32)

Hooks are bash scripts. On Windows:

- Install **Git for Windows** — Cursor runs `.cursor/hooks/*.sh` via bash
- `chmod +x` does not apply on NTFS; use Git Bash on macOS/Linux CI for executable checks
- Hook smoke test: `bash tests/check_hooks.sh` (from Git Bash)

## Verify

```bash
./tools/harness check --strict
bash tests/check_hooks.sh
```

End-to-end verification: [docs/setup/cursor-sdk-verification.md](../../docs/setup/cursor-sdk-verification.md)

## SDK orchestrator

See [sdk/README.md](../../sdk/README.md) and [docs/setup/cursor-sdk.md](../../docs/setup/cursor-sdk.md).

Roadmap: [docs/roadmap/cursor-sdk-roadmap.md](../../docs/roadmap/cursor-sdk-roadmap.md)
