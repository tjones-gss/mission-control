# Cursor SDK Verification Runbook

Staged proof that the Cursor SDK integration works end-to-end — from adapter install through live local loop and cloud auto-PR.

**Status:** Code is complete; operational proof requires real API keys and (for M2) GitHub secrets.

See [cursor-sdk-roadmap.md](../roadmap/cursor-sdk-roadmap.md) for milestone tracking.

---

## Prerequisites

- Python 3.10+
- Git for Windows (Win32 hook smoke tests and bash hooks)
- `CURSOR_API_KEY` from [Cursor Dashboard → Integrations](https://cursor.com/dashboard/integrations)
- For M2: repo on GitHub with `CURSOR_API_KEY` in repo secrets

---

## Phase 0 — Bootstrap project

Live `run-loop` calls `harness check --strict` at preflight. Uninitialized projects fail with warnings.

### Install adapter + packages

```powershell
# Windows
.\tools\install-cursor-adapter.ps1
```

```bash
# macOS / Linux / Git Bash
./tools/install-cursor-adapter.sh
```

**Pass:** Root `.cursor/hooks.json` exists; `python tools/harness check --strict` exits 0.

Restart Cursor IDE after installing or updating hooks so the IDE reloads `hooks.json`.

### Initialize harness mode

```bash
python tools/harness init feature-development
```

**Pass:** `.harness/project-state.yml` shows `project.mode: feature-development`.

### Register smoke mission

Add to `.harness/mission-index.yml` under `missions:`:

```yaml
MISSION-001-example-adapt-harness:
  status: ready
  priority: high
  file: runs/missions/MISSION-001-example-adapt-harness.md
```

This mission scopes edits to `.harness/**`, `docs/**`, and adapter files only — no application source.

**Preflight gate:**

```bash
python tools/harness check --strict    # exit 0
python tools/harness next --json       # shows MISSION-001-example-adapt-harness
```

---

## Phase 1 — M0: Cursor parity (local IDE)

| Step | Command | Pass criteria |
|------|---------|---------------|
| Install adapter | `.\tools\install-cursor-adapter.ps1` | Root `.cursor/` exists |
| Strict check | `python tools/harness check --strict` | Exit 0 |
| Hook smoke (Win32) | `bash tests/check_hooks.sh` | All Cursor tests pass |
| IDE proof | Restart Cursor, start agent session | Session loads `.harness/` state |

---

## Phase 2 — M1: Live local SDK loop

### Lighter probe (optional)

```bash
export CURSOR_API_KEY=cursor_...
python sdk/python/examples/one_shot_status.py
```

**Pass:** Output includes agent result text (not "CURSOR_API_KEY not set").

### Full mission loop

```bash
export CURSOR_API_KEY=cursor_...
python -m harness_orchestrator run-loop --cwd . --runtime local
```

**Pass criteria:**

- Exit 0 (gates satisfied) or exit 3 with actionable gate failure logs
- `.harness/project-state.yml` `current.agent_id` is **not** `mock-local-agent`
- `current.last_run_id` is a real run ID (not `mock-run-N`)

**Automated live test** (skipped unless `CURSOR_API_KEY` is set):

```bash
PYTHONPATH=harness_core:sdk/python python -m unittest sdk.python.tests.test_sdk.TestLiveSdk -v
```

---

## Phase 3 — M2: Cloud + auto-PR

### GitHub secrets

| Secret | Value |
|--------|-------|
| `CURSOR_API_KEY` | Cursor service account key |

### Manual dispatch

1. GitHub → Actions → **Harness Cloud Mission**
2. `runtime`: **cloud**
3. Run workflow

The workflow sets `HARNESS_REPO_URL` to `${{ github.server_url }}/${{ github.repository }}` automatically.

**Pass criteria:**

- Workflow completes exit 0
- Cloud agent creates branch + PR (check run logs or GitHub PRs)
- `project-state.yml` updated with cloud `runtime` and real `agent_id`

### Resume path

Re-dispatch with `resume: true` after a timeout; reads `current.agent_id` from project-state.

---

## Phase 4 — M3: Shared core regression

After any changes, re-run:

```bash
python tests/test_cli.py
PYTHONPATH=harness_core:sdk/python python -m unittest discover sdk/python/tests -v
python -m harness_orchestrator run-loop --cwd . --dry-run
```

---

## Definition of done (100% verified)

- [ ] Root `.cursor/` installed; `harness check --strict` exit 0
- [ ] `harness init feature-development`; smoke mission registered
- [ ] Live local `run-loop` with real `agent_id` / `run_id`
- [ ] Cloud `workflow_dispatch` succeeds; PR created
- [ ] Live loop exits 3 on gate failure (strict mode default)
- [ ] Win32 hook smoke documented and run via Git Bash

---

## Strict gates behavior

Live runs (non-dry-run) exit **3** when any required phase gate fails. Dry-run always exits 0 (warn-only). Override with `--no-strict-gates` for debugging.

Gate failures are expected until the agent produces:

- `runs/test-reports/<mission-id>.md` (validate phase)
- `runs/reviews/<mission-id>-review.md` (review phase)
- `runs/session-notes/*.md` (session-memory phase, when implementation occurred)

This is correct production behavior.
