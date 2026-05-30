---
name: harness-check
description: Use to verify the harness is installed and wired correctly. Triggers on "is the harness healthy", "check the harness", "validate harness install", "are the hooks wired up", or whenever the user is troubleshooting why the harness doesn't seem to be enforcing rules. Walks the install checklist, runs hook smoke tests, validates pipeline files, and produces a pass/fail report.
---

# Harness Check

Verify the harness control plane and Claude Code adapter are installed, wired, and functional.

## When to use

- After installing or updating the harness
- When the user suspects the hooks aren't firing ("Claude just edited something without a mission")
- Before relying on the harness for any high-stakes work

## What this verifies

Three layers, top to bottom:

1. **Control plane** — `.harness/` files exist and parse
2. **Claude Code adapter** — `.claude/settings.json` is valid and references real scripts
3. **Functional** — hooks actually do what they claim when fed sample input

## Required inputs

Just the project root. Run from anywhere under it.

## Process

### Layer 1 — Control plane

For each file, check it exists and parses as YAML:

```
.harness/project-state.yml
.harness/pipeline-state.yml
.harness/mission-index.yml
.harness/context-manifest.yml
.harness/quality-gates.yml
.harness/danger-zone.yml
.harness/human-approval-policy.yml
.harness/anti-patterns.yml
.harness/artifact-index.yml
.harness/mvp-checklist.yml
.harness/readiness-score.yml
```

Also check:
- `AGENTS.md` exists
- The active pipeline file referenced by `pipeline-state.yml:pipeline.active` exists in `pipelines/`
- `project-state.yml:project.mode` is not `unset`

### Layer 2 — Claude Code adapter

- `.claude/settings.json` exists and parses as JSON
- `CLAUDE.md` exists at project root
- For every hook referenced in `settings.json`: the script exists and is executable
- For every subagent in `.claude/agents/`: file has valid YAML frontmatter with `name` and `description`
- `jq` is available on PATH (warn if not — hooks degrade gracefully but enforcement is weaker)

### Layer 3 — Functional smoke tests

For each hook, feed it sample stdin and assert the right response:

| Hook | Input | Expected |
|---|---|---|
| `block-danger.sh` | `{"tool_input":{"command":"rm -rf /tmp/x"}}` | JSON with `permissionDecision: "deny"` |
| `block-danger.sh` | `{"tool_input":{"command":"ls"}}` | exit 0, no output |
| `require-mission.sh` | `{"tool_input":{"file_path":"<root>/.harness/x.yml"}}` (CLAUDE_PROJECT_DIR set) | exit 0, no output |
| `require-mission.sh` | `{"tool_input":{"file_path":"<root>/src/x.ts"}}` with no missions | JSON with `permissionDecision: "ask"` |
| `session-start-load-state.sh` | `{}` (CLAUDE_PROJECT_DIR set) | stdout contains `project-state.yml` |
| `stop-session-note-reminder.sh` | `{}` (no recent session notes) | stdout contains "harness reminder" |

### Step 4 — Pipeline validation

For each `pipelines/*.yml`:
- Parses as YAML
- Has top-level `pipeline` and `phases`
- Every phase has `id`, `agent`, `outputs`, `gate.required`
- Every `agent` reference matches a file under `agents/roles/` or `.claude/agents/`

## Output

A report with three sections (Control Plane / Adapter / Functional), each line marked `✓` or `✗`. End with an overall verdict: **HEALTHY** / **DEGRADED** / **BROKEN**. List concrete next steps for any failures.

If the `harness` CLI is installed, prefer running `harness check` which executes this skill's logic in code rather than asking Claude to do it manually.

## Hard rules

- Never fix issues silently. Report them, then let the user choose what to repair.
- Never edit hook scripts during a check. If a script has a bug, report it.
- Never claim "healthy" if any layer fails. Degraded ≠ healthy.
